"""Central registry for approved LangGraph tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import BaseModel, ValidationError

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

    def register(self, tool: BaseTool) -> None:
        name = tool.name
        if not name:
            raise ToolRegistryError("Tool must have a non-empty name")
        if name in self._tools:
            raise ToolRegistryError(f"Tool already registered: {name}")
        self._tools[name] = tool

    def get(self, name: str) -> BaseTool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolNotRegisteredError(name) from exc

    def has(self, name: str) -> bool:
        return name in self._tools

    def list(self) -> list[ToolMetadata]:
        return [self._metadata(tool) for tool in self._tools.values()]

    def get_langchain_tools(self) -> list[BaseTool]:
        return list(self._tools.values())

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

    async def aexecute(self, name: str, args: dict[str, Any]) -> Any:
        """Execute a registered tool; map validation failures to ToolValidationError."""
        tool = self.get(name)
        try:
            return await tool.ainvoke(args)
        except ValidationError as exc:
            raise ToolValidationError(str(exc)) from exc
        except Exception as exc:
            # LangChain often wraps pydantic errors; re-check message/type.
            if isinstance(exc, ValidationError) or exc.__class__.__name__ == "ValidationError":
                raise ToolValidationError(str(exc)) from exc
            # Some tool paths raise ValueError for bad args
            if "validation" in str(exc).lower() or "args" in str(exc).lower():
                # Prefer not to misclassify runtime bugs; only wrap explicit ValidationError above.
                pass
            raise
