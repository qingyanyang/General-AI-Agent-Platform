"""Discover and call tools on approved Streamable HTTP MCP servers.

Legacy HTTP+SSE (``sse_client``) is not used. Streamable HTTP may still receive
SSE response bodies. Authenticated MCP servers are out of scope: the allowlist
has no tokens, headers, or OAuth settings.

Timeouts follow MCP Python SDK 1.30: ``ClientSession`` and ``call_tool`` take
``datetime.timedelta`` (not a bare float).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

import anyio
import httpx
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError
from langchain_core.tools import BaseTool
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, ListToolsResult, Tool
from pydantic import ValidationError
from referencing import Registry
from referencing.exceptions import Unresolvable

from app.agents.tools.errors import (
    ToolConnectionError,
    ToolExecutionError,
    ToolValidationError,
)
from app.core.config import Settings, get_settings
from app.core.mcp_allowlist import (
    ApprovedMcpServer,
    registry_name_for,
    url_is_approved_target,
)

logger = logging.getLogger(__name__)

_CATALOG: tuple[McpToolSpec, ...] = ()
_HTTP_CLIENT_FACTORY: ContextVar[McpHttpClientFactory | None] = ContextVar(
    "mcp_http_client_factory",
    default=None,
)
# Strong references: the event loop keeps only weak references to tasks.
_SESSION_TASKS: set[asyncio.Task[None]] = set()


@dataclass(frozen=True, slots=True)
class McpToolSpec:
    """One discovered tool. ``remote_name`` is what ``call_tool`` sends."""

    server_name: str
    server_url: str
    remote_name: str
    registry_name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None


class McpHttpClientFactory(Protocol):
    def __call__(self, server: ApprovedMcpServer, timeout_seconds: float) -> httpx.AsyncClient: ...


class ApprovedUrlClient(httpx.AsyncClient):
    """httpx client that refuses any request outside the approved endpoint.

    The MCP SDK follows some same-origin redirects itself and ignores
    ``follow_redirects``. This check runs on every ``send``, including those
    redirect hops, and allows only the approved URL or a trailing-slash variant.
    """

    def __init__(self, approved_url: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._approved_url = approved_url

    async def send(self, request: httpx.Request, **kwargs: Any) -> httpx.Response:
        if not url_is_approved_target(self._approved_url, request.url):
            raise httpx.RequestError(
                "MCP request URL is not an approved endpoint",
                request=request,
            )
        return await super().send(request, **kwargs)


def build_approved_http_client(
    server: ApprovedMcpServer,
    timeout_seconds: float,
) -> httpx.AsyncClient:
    return ApprovedUrlClient(
        approved_url=server.url,
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,
    )


def set_mcp_http_client_factory(factory: McpHttpClientFactory | None) -> None:
    """Replace the HTTP client factory for the current context. Tests use this."""
    _HTTP_CLIENT_FACTORY.set(factory)


def get_mcp_catalog() -> tuple[McpToolSpec, ...]:
    return _CATALOG


def replace_mcp_catalog(specs: tuple[McpToolSpec, ...]) -> None:
    global _CATALOG
    _CATALOG = specs


def clear_mcp_catalog() -> None:
    replace_mcp_catalog(())


def mcp_tools_from_catalog() -> list[McpTool]:
    return [McpTool.from_spec(spec) for spec in get_mcp_catalog()]


class McpTool(BaseTool):
    """LangChain tool that calls one approved MCP tool after local schema checks."""

    remote_name: str
    server_name: str
    server_url: str
    mcp_input_schema: dict[str, Any]
    mcp_output_schema: dict[str, Any] | None = None

    @classmethod
    def from_spec(cls, spec: McpToolSpec) -> McpTool:
        return cls(
            name=spec.registry_name,
            description=spec.description or spec.registry_name,
            args_schema=spec.input_schema,
            remote_name=spec.remote_name,
            server_name=spec.server_name,
            server_url=spec.server_url,
            mcp_input_schema=spec.input_schema,
            mcp_output_schema=spec.output_schema,
        )

    def _run(self, *args: Any, **kwargs: Any) -> str:
        raise ToolExecutionError(self.name)

    async def _arun(self, *args: Any, **kwargs: Any) -> str:
        arguments = dict(kwargs)
        validate_instance(self.mcp_input_schema, arguments, message="invalid tool arguments")
        spec = McpToolSpec(
            server_name=self.server_name,
            server_url=self.server_url,
            remote_name=self.remote_name,
            registry_name=self.name,
            description=self.description,
            input_schema=self.mcp_input_schema,
            output_schema=self.mcp_output_schema,
        )
        return await call_remote_tool(spec, arguments)

    async def ainvoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        if not isinstance(input, dict):
            raise ToolValidationError("invalid tool arguments")
        try:
            validate_instance(self.mcp_input_schema, input, message="invalid tool arguments")
        except ToolValidationError:
            raise
        try:
            return await super().ainvoke(input, config=config, **kwargs)
        except ValidationError as exc:
            raise ToolValidationError("invalid tool arguments") from exc


def validate_instance(schema: dict[str, Any], instance: object, *, message: str) -> None:
    """Validate JSON data. External ``$ref`` URLs are not fetched."""
    if not isinstance(schema, dict) or schema_has_external_ref(schema):
        raise ToolValidationError(message)
    try:
        Draft202012Validator(schema, registry=Registry()).validate(instance)
    except (JsonSchemaValidationError, SchemaError, Unresolvable) as exc:
        raise ToolValidationError(message) from exc


def schema_has_external_ref(schema: object) -> bool:
    if isinstance(schema, dict):
        ref = schema.get("$ref")
        if isinstance(ref, str) and not ref.startswith("#"):
            return True
        return any(schema_has_external_ref(value) for value in schema.values())
    if isinstance(schema, list):
        return any(schema_has_external_ref(item) for item in schema)
    return False


def render_tool_result(
    registry_name: str,
    result: CallToolResult,
    output_schema: dict[str, Any] | None,
) -> str:
    """Turn a successful MCP result into model text. ``isError`` is not success."""
    if result.isError:
        raise ToolExecutionError(registry_name)
    if output_schema is not None:
        validate_instance(
            output_schema,
            result.structuredContent,
            message="invalid tool output",
        )
    texts: list[str] = []
    omitted: list[str] = []
    for block in result.content:
        block_type = getattr(block, "type", None)
        if block_type == "text":
            texts.append(str(getattr(block, "text", "")))
        else:
            omitted.append(str(block_type or "unknown"))
    if texts:
        body = "\n".join(texts)
        if omitted:
            body = f"{body}\nUnsupported content omitted: {', '.join(dict.fromkeys(omitted))}"
        return body
    if omitted:
        raise ToolExecutionError(registry_name)
    if result.structuredContent is not None:
        try:
            return json.dumps(result.structuredContent, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError) as exc:
            raise ToolExecutionError(registry_name) from exc
    return ""


def select_tool_specs(
    server: ApprovedMcpServer,
    tools: list[Tool],
    reserved: set[str],
) -> list[McpToolSpec]:
    """Keep tools with a unique, provider-safe registry name. Never overwrite ``reserved``."""
    selected: list[McpToolSpec] = []
    for tool in tools:
        remote_name = tool.name
        registry_name = registry_name_for(server.name, remote_name)
        if registry_name is None or registry_name in reserved:
            logger.info(
                "Skipping MCP tool server=%s remote=%s reason=%s",
                server.name,
                remote_name,
                "duplicate" if registry_name in reserved else "unsupported_name",
            )
            continue
        input_schema = tool.inputSchema if isinstance(tool.inputSchema, dict) else None
        output_schema = tool.outputSchema if isinstance(tool.outputSchema, dict) else None
        if input_schema is None or schema_has_external_ref(input_schema):
            logger.info(
                "Skipping MCP tool server=%s remote=%s reason=input_schema",
                server.name,
                remote_name,
            )
            continue
        if output_schema is not None and schema_has_external_ref(output_schema):
            logger.info(
                "Skipping MCP tool server=%s remote=%s reason=output_schema",
                server.name,
                remote_name,
            )
            continue
        reserved.add(registry_name)
        selected.append(
            McpToolSpec(
                server_name=server.name,
                server_url=server.url,
                remote_name=remote_name,
                registry_name=registry_name,
                description=tool.description or "",
                input_schema=input_schema,
                output_schema=output_schema,
            )
        )
    return selected


async def discover_server_tools(
    server: ApprovedMcpServer,
    session: ClientSession,
    reserved: set[str],
) -> list[McpToolSpec]:
    """Follow ``list_tools`` cursors, then apply the registry name rules."""
    tools: list[Tool] = []
    cursor: str | None = None
    seen_cursors: set[str | None] = set()
    while cursor not in seen_cursors:
        seen_cursors.add(cursor)
        page: ListToolsResult = await session.list_tools(cursor=cursor)
        tools.extend(page.tools)
        cursor = page.nextCursor
        if not cursor:
            break
    return select_tool_specs(server, tools, reserved)


async def discover_approved_mcp_tools(settings: Settings | None = None) -> None:
    """Replace the process catalog from the allowlist. One failed server is skipped."""
    resolved = settings if settings is not None else get_settings()
    reserved = {"add", "multiply", "echo"}
    collected: list[McpToolSpec] = []
    for server in resolved.approved_mcp_server_list():
        try:
            specs = await _discover_one(server, resolved, reserved)
        except Exception as exc:
            if _task_is_cancelling():
                raise
            logger.warning(
                "MCP discovery failed server=%s error_type=%s",
                server.name,
                type(exc).__name__,
            )
            continue
        collected.extend(specs)
    replace_mcp_catalog(tuple(collected))


async def call_remote_tool(spec: McpToolSpec, arguments: dict[str, Any]) -> str:
    settings = get_settings()
    server = _approved_server_for_spec(spec, settings)

    async def _call(session: ClientSession) -> str:
        result = await session.call_tool(
            spec.remote_name,
            arguments,
            read_timeout_seconds=timedelta(seconds=settings.mcp_timeout_seconds),
        )
        return render_tool_result(spec.registry_name, result, spec.output_schema)

    return await _run_session_operation(server, settings, _call)


async def _discover_one(
    server: ApprovedMcpServer,
    settings: Settings,
    reserved: set[str],
) -> list[McpToolSpec]:
    async def _list(session: ClientSession) -> list[McpToolSpec]:
        return await discover_server_tools(server, session, reserved)

    return await _run_session_operation(server, settings, _list)


async def _run_session_operation(
    server: ApprovedMcpServer,
    settings: Settings,
    operation: Callable[[ClientSession], Awaitable[Any]],
) -> Any:
    """Run one MCP session on a child task so its cleanup stays on that task.

    The child sets ``outcome`` as soon as the operation finishes, before session
    and transport teardown. ``mcp_timeout_seconds`` bounds only the operation.
    Teardown gets ``mcp_cleanup_timeout_seconds`` and never replaces a captured
    outcome. A child still closing after that is cancelled and left to finish
    in the background. Caller cancellation runs the bounded close, then propagates.
    """
    factory = _HTTP_CLIENT_FACTORY.get() or build_approved_http_client
    client = factory(server, settings.mcp_timeout_seconds)
    outcome: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
    outcome.add_done_callback(_mark_retrieved)
    task = asyncio.create_task(
        _mcp_session_task(server, settings, operation, client, outcome),
        name=f"mcp-{server.name}",
    )
    _SESSION_TASKS.add(task)
    task.add_done_callback(_retire_session_task)
    try:
        await asyncio.wait(
            {outcome, task},
            timeout=settings.mcp_timeout_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        await _await_task_shutdown(
            task,
            settings.mcp_cleanup_timeout_seconds,
            cancel_first=not outcome.done(),
        )
    if _task_is_cancelling():
        raise asyncio.CancelledError
    if outcome.done():
        return outcome.result()
    raise ToolConnectionError(server.name)


async def _mcp_session_task(
    server: ApprovedMcpServer,
    settings: Settings,
    operation: Callable[[ClientSession], Awaitable[Any]],
    client: httpx.AsyncClient,
    outcome: asyncio.Future[Any],
) -> None:
    read_timeout = timedelta(seconds=settings.mcp_timeout_seconds)
    try:
        async with streamable_http_client(server.url, http_client=client) as (
            read_stream,
            write_stream,
            _,
        ):
            async with ClientSession(
                read_stream,
                write_stream,
                read_timeout_seconds=read_timeout,
            ) as session:
                await session.initialize()
                try:
                    result = await operation(session)
                except (ToolValidationError, ToolExecutionError) as exc:
                    outcome.set_exception(exc)
                else:
                    outcome.set_result(result)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if outcome.done():
            logger.warning(
                "MCP session teardown failed server=%s error_type=%s",
                server.name,
                type(exc).__name__,
            )
            return
        raise ToolConnectionError(server.name) from exc
    finally:
        await _close_client(client)


async def _await_task_shutdown(
    task: asyncio.Task[None],
    cleanup_timeout_seconds: float,
    *,
    cancel_first: bool,
) -> None:
    if task.done():
        return
    if cancel_first:
        task.cancel()
    with anyio.CancelScope(shield=True):
        with anyio.move_on_after(cleanup_timeout_seconds):
            await asyncio.wait({task})
    if not task.done():
        task.cancel()


def _mark_retrieved(future: asyncio.Future[Any]) -> None:
    if not future.cancelled():
        future.exception()


def _retire_session_task(task: asyncio.Task[None]) -> None:
    _SESSION_TASKS.discard(task)
    _mark_retrieved(task)


def _approved_server_for_spec(spec: McpToolSpec, settings: Settings) -> ApprovedMcpServer:
    for server in settings.approved_mcp_server_list():
        if server.name == spec.server_name and server.url == spec.server_url:
            return server
    raise ToolConnectionError(spec.registry_name)


def _task_is_cancelling() -> bool:
    task = asyncio.current_task()
    return task is not None and task.cancelling() > 0


async def _close_client(client: httpx.AsyncClient) -> None:
    try:
        await client.aclose()
    except Exception as exc:
        logger.warning("MCP client close failed error_type=%s", type(exc).__name__)
