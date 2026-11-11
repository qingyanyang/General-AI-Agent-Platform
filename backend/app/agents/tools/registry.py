"""Central registry for approved LangGraph tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import BaseModel, ValidationError

from app.agents.tool_policy import (
    ToolAuthContext,
    ToolAuthorizationError,
    authorize_tool_call,
)
from app.agents.tools.errors import (
    ToolNotRegisteredError,
    ToolRegistryError,
    ToolValidationError,
)


@dataclass(frozen=True)
class ToolMetadata:
    """Public metadata for a registered tool."""

    name: str
    description: str
    args_schema: dict[str, Any]


class ToolRegistry:
    """Register, discover, and execute approved tools only."""

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}
        self._required_permissions: dict[str, frozenset[str]] = {}

    def register(
        self,
        tool: BaseTool,
        *,
        required_permissions: frozenset[str],
    ) -> None:
        name = tool.name
        if not name:
            raise ToolRegistryError("Tool must have a non-empty name")
        perms = frozenset(required_permissions)
        if not perms:
            raise ToolRegistryError(
                "Tool must declare a non-empty required_permissions set",
            )
        if name in self._tools:
            raise ToolRegistryError(f"Tool already registered: {name}")
        self._tools[name] = tool
        self._required_permissions[name] = perms

    def get(self, name: str) -> BaseTool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolNotRegisteredError(name) from exc

    def has(self, name: str) -> bool:
        return name in self._tools

    def required_permissions_for(self, name: str) -> frozenset[str]:
        """Return required permissions for a registered tool."""
        if name not in self._required_permissions:
            raise ToolNotRegisteredError(name)
        return self._required_permissions[name]

    def list(self) -> list[ToolMetadata]:
        return [self._metadata(tool) for tool in self._tools.values()]

    def get_langchain_tools(
        self,
        names: frozenset[str] | None = None,
    ) -> list[BaseTool]:
        tools = list(self._tools.values())
        if names is None:
            return tools
        return [tool for tool in tools if tool.name in names]

    def _metadata(self, tool: BaseTool) -> ToolMetadata:
        schema: dict[str, Any]
        args_schema = tool.args_schema
        if isinstance(args_schema, type) and issubclass(args_schema, BaseModel):
            schema = args_schema.model_json_schema()
        elif isinstance(args_schema, dict):
            schema = args_schema
        else:
            schema = tool.tool_call_schema.model_json_schema()
        return ToolMetadata(
            name=tool.name,
            description=tool.description or "",
            args_schema=schema,
        )

    async def aexecute(
        self,
        name: str,
        args: dict[str, Any],
        *,
        context: ToolAuthContext | None = None,
    ) -> Any:
        """Authorize then execute a registered tool.

        Omitted or ``None`` ``context`` raises ``ToolAuthorizationError``
        (never ``TypeError``). Authorization failures do not invoke the tool.
        """
        # Auth boundary first so missing context never becomes a TypeError.
        if context is None:
            raise ToolAuthorizationError(name, "not authorized (missing context)")

        tool = self.get(name)
        authorize_tool_call(name=name, registry=self, context=context)
        try:
            return await tool.ainvoke(args)
        except ValidationError as exc:
            raise ToolValidationError(str(exc)) from exc
