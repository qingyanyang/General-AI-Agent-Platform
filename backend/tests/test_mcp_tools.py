"""MCP allowlist, discovery rules, schema handling, and LangGraph error mapping."""

from __future__ import annotations

import asyncio
import urllib.request

import httpx
import pytest
from app.agents.runtime import run_agent
from app.agents.tool_policy import ToolAuthorizationError
from app.agents.tools import create_default_registry
from app.agents.tools.errors import (
    ToolConnectionError,
    ToolExecutionError,
    ToolValidationError,
)
from app.agents.tools.mcp import (
    ApprovedUrlClient,
    McpTool,
    McpToolSpec,
    call_remote_tool,
    clear_mcp_catalog,
    discover_approved_mcp_tools,
    discover_server_tools,
    render_tool_result,
    replace_mcp_catalog,
    select_tool_specs,
    set_mcp_http_client_factory,
    validate_instance,
)
from app.agents.tools.registry import ToolRegistry
from app.core.config import Settings
from app.core.mcp_allowlist import ApprovedMcpServer, parse_approved_mcp_servers
from app.core.permissions import PERM_AGENTS_EXECUTE
from app.models.agent import Agent
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from mcp.types import CallToolResult, ImageContent, ListToolsResult, TextContent, Tool
from pydantic import ValidationError
from sqlalchemy.orm import Session

from tests.chat_helpers import (
    create_session,
    default_execution_config,
    default_tool_auth,
    headers,
    with_saver,
)
from tests.fakes import ScriptedChatModel

_SERVER = ApprovedMcpServer(name="calc", url="http://approved.example/mcp")
_OBJECT_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"q": {"type": "string"}},
    "required": ["q"],
    "additionalProperties": False,
}


def _tool(name: str, *, schema: dict | None = None, output: dict | None = None) -> Tool:
    return Tool(
        name=name,
        description=f"tool {name}",
        inputSchema=schema or _OBJECT_SCHEMA,
        outputSchema=output,
    )


def _spec() -> McpToolSpec:
    return McpToolSpec(
        server_name="calc",
        server_url="http://approved.example/mcp",
        remote_name="ping",
        registry_name="calc__ping",
        description="ping",
        input_schema=dict(_OBJECT_SCHEMA),
        output_schema=None,
    )


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        approved_mcp_servers=[{"name": "calc", "url": "http://approved.example/mcp"}],
        mcp_timeout_seconds=1,
        mcp_cleanup_timeout_seconds=0.2,
        llm_api_key="test-key",
    )


def test_allowlist_rejects_non_http_duplicate_and_separator_names() -> None:
    assert parse_approved_mcp_servers("") == ()
    with pytest.raises(ValueError, match="http or https"):
        parse_approved_mcp_servers([{"name": "calc", "url": "file:///tmp/mcp"}])
    with pytest.raises(ValueError, match="credentials"):
        parse_approved_mcp_servers([{"name": "calc", "url": "https://user:pw@example.com/mcp"}])
    with pytest.raises(ValueError, match="duplicate"):
        parse_approved_mcp_servers(
            [
                {"name": "calc", "url": "https://example.com/a"},
                {"name": "calc", "url": "https://example.com/b"},
            ],
        )
    with pytest.raises(ValueError, match="__"):
        parse_approved_mcp_servers([{"name": "cal__c", "url": "https://example.com/mcp"}])
    with pytest.raises(ValidationError, match="greater than 0"):
        Settings(_env_file=None, mcp_timeout_seconds=0)


def test_names_skip_separator_length_and_duplicates() -> None:
    reserved = {"add", "multiply", "echo", "calc__kept"}
    specs = select_tool_specs(
        _SERVER,
        [
            _tool("a__b"),
            _tool("kept"),
            _tool("kept"),
            _tool("space name"),
            _tool("n" * 80),
            _tool("ok"),
        ],
        reserved,
    )
    assert [item.registry_name for item in specs] == ["calc__ok"]
    assert [item.remote_name for item in specs] == ["ok"]
    assert "calc__kept" in reserved


def test_external_ref_is_not_fetched_and_schema_is_exposed() -> None:
    def _refuse(url: object, *args: object, **kwargs: object) -> object:
        raise AssertionError(f"schema validation fetched {url}")

    original = urllib.request.urlopen
    urllib.request.urlopen = _refuse  # type: ignore[assignment]
    try:
        with pytest.raises(ToolValidationError, match="invalid tool arguments"):
            validate_instance(
                {"$ref": "https://evil.example/schema.json"},
                {},
                message="invalid tool arguments",
            )
    finally:
        urllib.request.urlopen = original  # type: ignore[assignment]

    skipped = select_tool_specs(
        _SERVER,
        [_tool("ref", schema={"$ref": "https://evil.example/schema.json"})],
        set(),
    )
    assert skipped == []

    tool = McpTool.from_spec(_spec())
    assert tool.args_schema == _spec().input_schema
    registry = ToolRegistry()
    registry.register(tool, required_permissions=frozenset({PERM_AGENTS_EXECUTE}))
    metadata = registry.list()[0]
    assert metadata.args_schema["properties"]["q"]["type"] == "string"


def test_result_rendering_checks_is_error_before_output_schema() -> None:
    secret = "SECRET_REMOTE_FAILURE"
    with pytest.raises(ToolExecutionError, match="calc__ping") as execution:
        render_tool_result(
            "calc__ping",
            CallToolResult(
                content=[TextContent(type="text", text=secret)],
                structuredContent={"n": "nope"},
                isError=True,
            ),
            {"type": "object", "required": ["n"], "properties": {"n": {"type": "number"}}},
        )
    assert secret not in str(execution.value)

    with pytest.raises(ToolValidationError, match="invalid tool output") as invalid:
        render_tool_result(
            "calc__ping",
            CallToolResult(
                content=[TextContent(type="text", text="ok")],
                structuredContent={},
                isError=False,
            ),
            {"type": "object", "required": ["n"], "properties": {"n": {"type": "number"}}},
        )
    assert "structuredContent" not in str(invalid.value)

    joined = render_tool_result(
        "calc__ping",
        CallToolResult(
            content=[
                TextContent(type="text", text="one"),
                TextContent(type="text", text="two"),
                ImageContent(type="image", data="AAAASECRET", mimeType="image/png"),
            ],
            isError=False,
        ),
        None,
    )
    assert joined == "one\ntwo\nUnsupported content omitted: image"
    assert "AAAASECRET" not in joined

    image_only = CallToolResult(
        content=[ImageContent(type="image", data="AAAASECRET", mimeType="image/png")],
        isError=False,
    )
    with pytest.raises(ToolExecutionError, match="calc__ping") as image_error:
        render_tool_result("calc__ping", image_only, None)
    assert "AAAASECRET" not in str(image_error.value)

    structured = render_tool_result(
        "calc__ping",
        CallToolResult(content=[], structuredContent={"b": 1, "a": 2}, isError=False),
        None,
    )
    assert structured == '{"a":2,"b":1}'


class _PageSession:
    def __init__(self) -> None:
        self.cursors: list[str | None] = []

    async def list_tools(self, cursor: str | None = None) -> ListToolsResult:
        self.cursors.append(cursor)
        if cursor is None:
            return ListToolsResult(tools=[_tool("one")], nextCursor="page-2")
        return ListToolsResult(tools=[_tool("two")], nextCursor=None)


def test_discovery_follows_list_tools_pages() -> None:
    session = _PageSession()
    specs = asyncio.run(discover_server_tools(_SERVER, session, set()))  # type: ignore[arg-type]
    assert session.cursors == [None, "page-2"]
    assert [item.remote_name for item in specs] == ["one", "two"]
    assert [item.registry_name for item in specs] == ["calc__one", "calc__two"]


def test_call_tool_uses_remote_name(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    class _Session:
        async def call_tool(
            self,
            name: str,
            arguments: dict,
            read_timeout_seconds: object = None,
        ) -> CallToolResult:
            captured["name"] = name
            captured["q"] = arguments["q"]
            return CallToolResult(content=[TextContent(type="text", text="pong")], isError=False)

    async def _run(server: ApprovedMcpServer, settings: Settings, operation: object) -> str:
        del server, settings
        return await operation(_Session())  # type: ignore[operator]

    monkeypatch.setattr("app.agents.tools.mcp.get_settings", _settings)
    monkeypatch.setattr("app.agents.tools.mcp._run_session_operation", _run)
    result = asyncio.run(call_remote_tool(_spec(), {"q": "hi"}))
    assert result == "pong"
    assert captured == {"name": "ping", "q": "hi"}


def test_aexecute_does_not_connect_when_unauthorized(monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    async def _forbid(spec: McpToolSpec, arguments: dict) -> str:
        nonlocal called
        called = True
        raise AssertionError("connected")

    monkeypatch.setattr("app.agents.tools.mcp.call_remote_tool", _forbid)
    registry = ToolRegistry()
    registry.register(
        McpTool.from_spec(_spec()),
        required_permissions=frozenset({PERM_AGENTS_EXECUTE}),
    )
    with pytest.raises(ToolAuthorizationError, match="missing context"):
        asyncio.run(registry.aexecute("calc__ping", {"q": "hi"}))
    auth = default_tool_auth(allowed_tools=frozenset({"echo"}))
    with pytest.raises(ToolAuthorizationError, match="not authorized for this agent"):
        asyncio.run(registry.aexecute("calc__ping", {"q": "hi"}, context=auth))
    assert called is False


def test_invalid_arguments_do_not_call_the_server(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _forbid(spec: McpToolSpec, arguments: dict) -> str:
        raise AssertionError("called")

    monkeypatch.setattr("app.agents.tools.mcp.call_remote_tool", _forbid)
    registry = ToolRegistry()
    registry.register(
        McpTool.from_spec(_spec()),
        required_permissions=frozenset({PERM_AGENTS_EXECUTE}),
    )
    auth = default_tool_auth(allowed_tools=frozenset({"calc__ping"}))
    with pytest.raises(ToolValidationError, match="invalid tool arguments"):
        asyncio.run(registry.aexecute("calc__ping", {"q": 1}, context=auth))


def test_empty_catalog_registry_is_builtins_only() -> None:
    clear_mcp_catalog()
    assert {tool.name for tool in create_default_registry().get_langchain_tools()} == {
        "add",
        "multiply",
        "echo",
        "load_skill",
    }


def _run_scripted(tool_name: str, secret: str) -> str:
    llm = ScriptedChatModel(
        script=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": tool_name,
                        "args": {"q": "hi"},
                        "id": "call_mcp_1",
                        "type": "tool_call",
                    }
                ],
            ),
            AIMessage(content="done"),
        ]
    )
    result = asyncio.run(
        run_agent(
            "use the tool",
            tool_auth=default_tool_auth(allowed_tools=frozenset({tool_name})),
            execution_config=default_execution_config(tool_names=(tool_name,)),
            llm=llm,
        ),
    )
    tool_msg = next(item for item in result.messages if item.role == "tool")
    assert secret not in tool_msg.content
    assert result.reply == "done"
    return tool_msg.content


def test_langgraph_maps_mcp_success_and_controlled_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    replace_mcp_catalog((_spec(),))
    mode = {"value": "ok"}

    async def _call(spec: McpToolSpec, arguments: dict) -> str:
        if mode["value"] == "ok":
            return "pong"
        if mode["value"] == "connect":
            raise ToolConnectionError(spec.registry_name) from RuntimeError("SECRET_CONNECT")
        raise ToolExecutionError(spec.registry_name) from RuntimeError("SECRET_EXEC")

    monkeypatch.setattr("app.agents.tools.mcp.call_remote_tool", _call)
    assert _run_scripted("calc__ping", "SECRET") == "pong"
    mode["value"] = "connect"
    assert _run_scripted("calc__ping", "SECRET_CONNECT") == "Tool connection error for 'calc__ping'"
    mode["value"] = "exec"
    assert _run_scripted("calc__ping", "SECRET_EXEC") == "Tool execution error for 'calc__ping'"


def test_redirect_to_another_host_or_path_is_not_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host != "approved.example":
            raise AssertionError(f"requested {request.url}")
        if request.url.path != "/mcp":
            raise AssertionError(f"requested {request.url}")
        location = "http://evil.example/mcp" if len(seen) == 1 else "http://approved.example/stolen"
        return httpx.Response(307, headers={"location": location})

    def factory(server: ApprovedMcpServer, timeout_seconds: float) -> httpx.AsyncClient:
        return ApprovedUrlClient(
            approved_url=server.url,
            transport=httpx.MockTransport(handler),
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
        )

    set_mcp_http_client_factory(factory)
    monkeypatch.setattr("app.agents.tools.mcp.get_settings", _settings)
    asyncio.run(discover_approved_mcp_tools(_settings()))
    assert seen == ["http://approved.example/mcp"]
    names = {tool.name for tool in create_default_registry().get_langchain_tools()}
    assert "calc__ping" not in names

    seen.clear()

    def same_origin(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(307, headers={"location": "http://approved.example/stolen"})

    def factory_same(server: ApprovedMcpServer, timeout_seconds: float) -> httpx.AsyncClient:
        return ApprovedUrlClient(
            approved_url=server.url,
            transport=httpx.MockTransport(same_origin),
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
        )

    set_mcp_http_client_factory(factory_same)
    asyncio.run(discover_approved_mcp_tools(_settings()))
    assert seen == ["http://approved.example/mcp"]
    assert all("/stolen" not in url for url in seen)


def test_missing_catalog_tool_preflight_is_503_and_keeps_assignment(
    api_client: TestClient,
    db_session: Session,
) -> None:
    created = create_session(api_client, db_session, tool_names=["missing_mcp_tool"])
    with_saver(api_client)
    message = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert message.status_code == 503
    assert "not registered" in message.json()["detail"]

    stream = api_client.post(
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    )
    assert stream.status_code == 503
    assert stream.headers.get("content-type", "").startswith("application/json")
    assert "not registered" in stream.json()["detail"]

    agent = db_session.get(Agent, "default")
    assert agent is not None
    assert agent.tool_names == ["missing_mcp_tool"]
