"""In-process Streamable HTTP MCP server: discovery, deadlines, and cancellation."""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest
from app.agents.runtime import run_agent
from app.agents.tools import create_default_registry
from app.agents.tools.errors import ToolConnectionError
from app.agents.tools.mcp import (
    ApprovedUrlClient,
    call_remote_tool,
    clear_mcp_catalog,
    discover_approved_mcp_tools,
    get_mcp_catalog,
    set_mcp_http_client_factory,
)
from app.core.config import Settings
from app.core.mcp_allowlist import ApprovedMcpServer
from langchain_core.messages import AIMessage
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from tests.chat_helpers import default_execution_config, default_tool_auth
from tests.fakes import ScriptedChatModel

_URL = "http://testserver/mcp"


class _TrackingClient(ApprovedUrlClient):
    def __init__(self, closed: list[bool], **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self._closed = closed

    async def aclose(self) -> None:
        self._closed.append(True)
        await super().aclose()


class _HangingCloseClient(_TrackingClient):
    """Hangs on the session DELETE or on ``aclose`` once ``armed`` is set."""

    def __init__(self, closed: list[bool], hang: str, armed: asyncio.Event, **kwargs: object):
        super().__init__(closed, **kwargs)
        self._hang = hang
        self._armed = armed

    async def send(self, request: httpx.Request, **kwargs: object) -> httpx.Response:
        if self._armed.is_set() and self._hang == "delete" and request.method == "DELETE":
            await asyncio.Event().wait()
        return await super().send(request, **kwargs)  # type: ignore[arg-type]

    async def aclose(self) -> None:
        if self._armed.is_set() and self._hang == "aclose":
            self._closed.append(True)
            await asyncio.Event().wait()
        await super().aclose()


def _settings(*, timeout: float) -> Settings:
    return Settings(
        _env_file=None,
        approved_mcp_servers=[{"name": "calc", "url": _URL}],
        mcp_timeout_seconds=timeout,
        mcp_cleanup_timeout_seconds=0.5,
        llm_api_key="test-key",
    )


def _server() -> FastMCP:
    return FastMCP(
        "test",
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )


def _install_factory(app: object, closed: list[bool], settings: Settings) -> None:
    def factory(server: ApprovedMcpServer, timeout_seconds: float) -> httpx.AsyncClient:
        del server, timeout_seconds
        return _TrackingClient(
            closed,
            approved_url=settings.approved_mcp_server_list()[0].url,
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            timeout=httpx.Timeout(settings.mcp_timeout_seconds),
            follow_redirects=False,
        )

    set_mcp_http_client_factory(factory)


def test_in_process_server_discovery_and_langgraph_call(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _scenario() -> None:
        server = _server()

        @server.tool()
        def ping(q: str) -> str:
            """Return the text."""
            return f"pong:{q}"

        app = server.streamable_http_app()
        settings = _settings(timeout=5)
        closed: list[bool] = []
        monkeypatch.setattr("app.agents.tools.mcp.get_settings", lambda: settings)
        async with app.router.lifespan_context(app):
            _install_factory(app, closed, settings)
            await discover_approved_mcp_tools(settings)
            names = {tool.name for tool in create_default_registry().get_langchain_tools()}
            assert "calc__ping" in names
            llm = ScriptedChatModel(
                script=[
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "calc__ping",
                                "args": {"q": "ada"},
                                "id": "call_ping",
                                "type": "tool_call",
                            }
                        ],
                    ),
                    AIMessage(content="finished"),
                ]
            )
            result = await run_agent(
                "ping",
                tool_auth=default_tool_auth(allowed_tools=frozenset({"calc__ping"})),
                execution_config=default_execution_config(tool_names=("calc__ping",)),
                llm=llm,
            )
        tool_msg = next(item for item in result.messages if item.role == "tool")
        assert tool_msg.content == "pong:ada"
        assert result.reply == "finished"
        assert closed

    asyncio.run(_scenario())
    clear_mcp_catalog()


def test_hung_tool_hits_deadline_and_closes_client(monkeypatch: pytest.MonkeyPatch) -> None:
    started = asyncio.Event()

    async def _scenario() -> None:
        server = _server()

        @server.tool()
        async def hang() -> str:
            """Never return."""
            started.set()
            await asyncio.Event().wait()
            return "no"

        app = server.streamable_http_app()
        settings = _settings(timeout=1)
        closed: list[bool] = []
        monkeypatch.setattr("app.agents.tools.mcp.get_settings", lambda: settings)
        async with app.router.lifespan_context(app):
            _install_factory(app, closed, settings)
            await discover_approved_mcp_tools(settings)
            spec = next(item for item in get_mcp_catalog() if item.remote_name == "hang")

            async def _call() -> str:
                return await call_remote_tool(spec, {})

            task = asyncio.create_task(_call())
            await asyncio.wait_for(started.wait(), timeout=3)
            with pytest.raises(ToolConnectionError, match="calc"):
                await task
        assert closed

    asyncio.run(_scenario())
    clear_mcp_catalog()


@pytest.mark.parametrize("hang", ["delete", "aclose"])
def test_completed_call_survives_hung_teardown(
    monkeypatch: pytest.MonkeyPatch,
    hang: str,
) -> None:
    async def _scenario() -> tuple[str, float]:
        server = _server()

        @server.tool()
        def ping(q: str) -> str:
            """Return the text."""
            return f"pong:{q}"

        app = server.streamable_http_app()
        settings = _settings(timeout=5)
        closed: list[bool] = []
        armed = asyncio.Event()
        monkeypatch.setattr("app.agents.tools.mcp.get_settings", lambda: settings)

        def factory(server_entry: ApprovedMcpServer, timeout_seconds: float) -> httpx.AsyncClient:
            del server_entry, timeout_seconds
            return _HangingCloseClient(
                closed,
                hang,
                armed,
                approved_url=_URL,
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
                timeout=httpx.Timeout(settings.mcp_timeout_seconds),
                follow_redirects=False,
            )

        async with app.router.lifespan_context(app):
            set_mcp_http_client_factory(factory)
            await discover_approved_mcp_tools(settings)
            spec = next(item for item in get_mcp_catalog() if item.remote_name == "ping")
            armed.set()
            started = time.monotonic()
            text = await call_remote_tool(spec, {"q": "ada"})
            return text, time.monotonic() - started

    text, elapsed = asyncio.run(_scenario())
    assert text == "pong:ada"
    assert elapsed < 2
    clear_mcp_catalog()


def test_caller_cancel_closes_resources_and_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()

    async def _scenario() -> None:
        server = _server()

        @server.tool()
        async def hang() -> str:
            """Wait until the caller cancels."""
            started.set()
            await asyncio.Event().wait()
            return "no"

        app = server.streamable_http_app()
        settings = _settings(timeout=30)
        closed: list[bool] = []
        monkeypatch.setattr("app.agents.tools.mcp.get_settings", lambda: settings)
        async with app.router.lifespan_context(app):
            _install_factory(app, closed, settings)
            await discover_approved_mcp_tools(settings)
            spec = next(item for item in get_mcp_catalog() if item.remote_name == "hang")
            task = asyncio.create_task(call_remote_tool(spec, {}))
            await asyncio.wait_for(started.wait(), timeout=3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert closed

    asyncio.run(_scenario())
    clear_mcp_catalog()
