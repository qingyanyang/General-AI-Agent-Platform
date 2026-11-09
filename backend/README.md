# Backend

FastAPI foundation for the Enterprise AI Agent Platform (issues #7–#10).

## Layout

```text
app/
  api/           # HTTP routers (health, agents)
  agents/        # LangGraph runtime (state, tools registry, graph, invoke)
  core/          # Config, logging, errors, optional DB helpers
  services/      # Domain services (future)
tests/
```

## Local setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Health: `GET http://localhost:8000/health`

Agent invoke (requires `LLM_API_KEY`):

```bash
curl -s http://localhost:8000/agents/run \
  -H 'content-type: application/json' \
  -d '{"message":"What is 2 + 3?"}'
```

Without `LLM_API_KEY`, `POST /agents/run` returns **503**.

`DATABASE_URL` is optional for `/health`. Importing `app.core.database` helpers requires it.

`POSTGRES_SCHEMA` is accepted via env / Settings for Container App parity, but is **not** applied to the SQLAlchemy engine yet (no `search_path` / connect options). Treat it as reserved until Alembic and models are added.

### Agent / LLM env

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | `openai` or `deepseek` (OpenAI-compatible API) |
| `LLM_API_KEY` | unset | Primary key for live `POST /agents/run` |
| `DEEPSEEK_API_KEY` | unset | Optional DeepSeek key if `LLM_API_KEY` is unset |
| `LLM_MODEL` | `gpt-4o-mini` | Model id; DeepSeek default becomes `deepseek-flash` when still on the OpenAI default |
| `LLM_BASE_URL` | unset | OpenAI-compatible base URL; DeepSeek defaults to `https://api.deepseek.com` |
| `AGENT_RECURSION_LIMIT` | `10` | LangGraph recursion limit (tool-loop guard) |
| `AGENT_ID` | `default` | Id stored on each trace (`metadata.agent_id`) |
| `LANGSMITH_TRACING` | `false` | Turn on LangSmith tracing for agent runs |
| `LANGSMITH_API_KEY` | unset | Required when tracing is on; tracing stays off if it is missing |
| `LANGSMITH_ENDPOINT` | LangSmith default | Optional API base URL (use APAC if your org is on that data plane) |

`POST /agents/run` returns `execution_id`. That id is the LangSmith root run id, so a trace can be matched to the API response. A failed run returns the same id in the 502 `detail`, next to `message`. Metadata on the trace is only `execution_id`, `agent_id`, and `environment`. API keys and the database URL are not copied into metadata. The user message and tool inputs are sent to LangSmith only while tracing is enabled.

If LangSmith is disabled, the key is missing, or the LangSmith client raises, the agent run still completes. Each run sets `LANGSMITH_TRACING` / `LANGSMITH_TRACING_V2` from these settings and restores the previous process environment afterward.

DeepSeek uses the same `ChatOpenAI` client ([docs](https://api-docs.deepseek.com/)): base URL `https://api.deepseek.com`, models `deepseek-flash` / `deepseek-v4-pro`, with OpenAI-style tool calling. Do not commit real keys — use local `.env` only.

### Tool registry

Approved tools live in a central `ToolRegistry` (`app.agents.tools`). Built-ins: `add`, `multiply`, `echo`. The LangGraph tools node executes **only** registered tools; unknown names and validation/runtime failures return `ToolMessage` errors so the agent loop can continue safely.

## Quality

```bash
ruff check app tests
ruff format --check app tests
pytest
```

## Docker

```bash
docker build -t agent-platform-api:local .
docker run --rm -p 8000:8000 -e ENVIRONMENT=demo agent-platform-api:local
```

## Azure

Container App env vars are owned by Bicep (`ENVIRONMENT`, `DATABASE_URL`, `POSTGRES_SCHEMA`, `CORS_ALLOWED_ORIGINS`, optional `LLM_API_KEY`). App-only agent settings (`LLM_MODEL`, `LLM_BASE_URL`, `AGENT_RECURSION_LIMIT`) can be added to the Container App when needed. `backend-cd` builds/pushes GHCR and updates the Container App image only.
