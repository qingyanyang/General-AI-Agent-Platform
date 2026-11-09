# Backend

FastAPI foundation for the Enterprise AI Agent Platform (issues #7–#11).

## Layout

```text
app/
  api/           # HTTP routers (health, agents, sessions) + deps
  agents/        # LangGraph runtime (state, tools registry, graph, invoke)
  core/          # Config, logging, errors, database helpers
  models/        # SQLAlchemy ORM (schema-qualified)
  schemas/       # Pydantic request/response models
  services/      # Domain services (chat sessions, …)
alembic/         # Migrations (POSTGRES_SCHEMA bootstrapped in env.py)
tests/
```

## Local setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
# set DATABASE_URL for migrations / session APIs
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Health: `GET http://localhost:8000/health`

### Identity stub (development only)

Protected session routes require header:

```http
X-User-Id: <opaque-non-empty-id>
```

Max length 128. Missing, blank, or oversized values return **422**.

This is a temporary stand-in until **OIDC/JWT (#15)** replaces `get_current_user_id` in `app/api/deps.py` with a validated identity while keeping the same dependency signature.

### Chat sessions (#11)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/sessions` | Body `{ "agent_id", "title"? }` → 201 |
| `GET` | `/sessions` | Cursor list: `limit` (1–100, default 20), `cursor?` |
| `GET` | `/sessions/{id}` | Own non-archived session or 404 |
| `DELETE` | `/sessions/{id}` | Soft-archive; owner repeat → 204; other user → 404 |

List response: `{ "items": [...], "next_cursor": string | null }`. Ordering is `last_activity_at DESC, id DESC`. This is a **live list** — later activity updates can move sessions between pages (not snapshot-stable). Malformed `cursor` → **422**.

Example:

```bash
curl -s http://localhost:8000/sessions \
  -H 'X-User-Id: demo-user-1' \
  -H 'content-type: application/json' \
  -d '{"agent_id":"default"}'
```

Tables live in PostgreSQL schema `POSTGRES_SCHEMA` (default `agent_platform`), schema-qualified in SQLAlchemy/Alembic (no engine `search_path`).

### Migrations

Alembic creates the schema **before** the version table (`alembic/env.py`), then applies revisions:

```bash
alembic upgrade head
alembic revision --autogenerate -m "message"   # after model changes
```

SQLite unit tests use `schema_translate_map` and do **not** replace running migrations against Postgres.

### Agent invoke

```bash
curl -s http://localhost:8000/agents/run \
  -H 'content-type: application/json' \
  -d '{"message":"What is 2 + 3?"}'
```

Without `LLM_API_KEY`, `POST /agents/run` returns **503**.

`DATABASE_URL` is optional for `/health` but required for session APIs and Alembic.

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
| `POSTGRES_SCHEMA` | `agent_platform` | Schema for ORM tables / Alembic version table |

`POST /agents/run` returns `execution_id`. That id is the LangSmith root run id. Metadata on the trace is only `execution_id`, `agent_id`, and `environment`.

### Tool registry

Approved tools live in a central `ToolRegistry` (`app.agents.tools`). Built-ins: `add`, `multiply`, `echo`.

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

Container App env vars are owned by Bicep (`ENVIRONMENT`, `DATABASE_URL`, `POSTGRES_SCHEMA`, `CORS_ALLOWED_ORIGINS`, optional `LLM_API_KEY` / LangSmith). Run `alembic upgrade head` against Supabase before relying on session APIs in demo. `backend-cd` builds/pushes GHCR and updates the Container App image only.
