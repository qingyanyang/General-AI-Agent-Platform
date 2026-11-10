# Backend

FastAPI foundation for the Enterprise AI Agent Platform (issues #7–#13).

## Layout

```text
app/
  api/           # HTTP routers (health, agents, sessions) + deps
  agents/        # LangGraph runtime (state, tools, checkpointer, graph, invoke)
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

Tables live in PostgreSQL schema `POSTGRES_SCHEMA` (default `agent_platform` from `DEFAULT_POSTGRES_SCHEMA`), schema-qualified in SQLAlchemy/Alembic (no engine `search_path`). Migrations and runtime must use the same schema name — do not change `POSTGRES_SCHEMA` without aligning Alembic revisions.

### Chat messages (#13)

Canonical multi-turn chat API. History is read from the LangGraph **checkpoint** (not a separate messages table).

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/sessions/{id}/messages` | Body `{ "content" }` → `{ "execution_id", "message": { "role", "content" } }` |
| `GET` | `/sessions/{id}/messages` | `{ "items": [ { "role", "content" }, ... ] }` (empty list if none) |

**Validation:** `content` max **32_000** characters; whitespace-only rejected (**422**); leading/trailing trim only — internal newlines/spaces preserved.

**Error precedence** (FastAPI `Depends` may return **422** for headers/body first):

1. Saver unavailable → **503** (POST and GET)
2. Unknown / archived / other-user session → **404**
3. LLM not configured → **503** (**POST only**; GET never checks LLM)
4. Agent execution failure → **502** (POST only)

**Failed runs:** A **502** does not mean nothing was saved. The checkpoint may already contain the new user message (and tool turns). Retrying the same POST may **duplicate** the user message in history.

**Activity:** After a successful POST, `last_activity_at` is updated on the request-scoped DB session. Checkpoint writes and that ORM update are not atomic. If the timestamp update fails, the API rolls back the ORM transaction, logs the metadata failure, and still returns **200** with the assistant reply.

```bash
curl -s http://localhost:8000/sessions/<session-uuid>/messages \
  -H 'X-User-Id: demo-user-1' \
  -H 'content-type: application/json' \
  -d '{"content":"What is 2 + 3?"}'
```

### SSE streaming (#14)

`POST /sessions/{id}/messages/stream` uses the same body, `X-User-Id` check, and ownership rules as `POST /sessions/{id}/messages`. The response is `text/event-stream`. Each frame has an `event` name and one JSON `data` line whose `type` matches that name.

Pre-stream HTTP errors, in order:

1. Validation (header or body) → **422**
2. Checkpointer unavailable → **503**
3. Unknown, archived, or another user's session → **404**
4. LLM not configured → **503**

Once the stream has started, graph and model failures are `error` events. Disconnecting cancels the run and does not emit `error`. There is no replay.

| Event | Meaning |
| --- | --- |
| `message.delta` | Assistant text emitted during the run, including text before a tool request. Concatenated deltas are not the final reply. |
| `tool.start` | The model requested a tool (`tool_call_id`, `name`). The tool may still be rejected. |
| `tool.end` | One tool result (`tool_call_id`, `name`, `content`). Validation and execution errors stay in `content`. |
| `done` | Authoritative final assistant message: `{ "role": "assistant", "content" }`. |
| `error` | Recursion limit or unexpected execution failure (`message`). No `done` follows. |

`last_activity_at` is updated after the graph succeeds and before `done`, in its own database session. A timestamp failure is rolled back and logged; `done` is still sent. A cancelled run does not update activity. If the model had already requested a tool, each unfinished call is recorded as `Tool execution cancelled` so the next turn stays valid. Other checkpoint rows already written are left as they are.

```bash
curl -N http://localhost:8000/sessions/<session-uuid>/messages/stream \
  -H 'X-User-Id: demo-user-1' \
  -H 'content-type: application/json' \
  -d '{"content":"What is 2 + 3?"}'
```

`POST /agents/run` remains available for ad-hoc/stateless invokes (and optional `session_id` from #12).

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

`DATABASE_URL` is optional for `/health` but required for session APIs, Alembic, and the LangGraph checkpointer.

### PostgreSQL checkpointer (#12)

On startup, if `DATABASE_URL` is set, the app opens an `AsyncConnectionPool` + `AsyncPostgresSaver`, runs `setup()`, and stores the saver on `app.state`. Pool connections use `autocommit=True`, `row_factory=dict_row`, and `search_path` set to `CHECKPOINTS_SCHEMA` (default `langgraph`). Checkpoint tables are **not** Alembic/ORM models — they stay separate from `POSTGRES_SCHEMA`. Prefer a **session** pooler (not transaction pooler) for psycopg.

If `DATABASE_URL` is unset, the checkpointer stays disabled (stateless runs only). If `DATABASE_URL` is set but pool/setup fails, startup fails after closing allocated resources.

| Request | Behaviour |
| --- | --- |
| No `session_id` | Graph compiled **without** a checkpointer (stateless), even if a saver exists |
| Owned active `session_id` + saver available | Checkpointed graph; `thread_id = str(session.id)` |
| `session_id` + saver unavailable | **503** (before identity/ownership DB queries) |

Durable turns require `X-User-Id` and a session UUID that belongs to that user and is not archived (unknown / other-user / archived → **404**). Clients never pass a raw `thread_id`. Each turn sends only the new user message; checkpoint restore retains history.

**Restart recovery** means continuing a conversation from persisted checkpoint state after recreating the pool/saver/graph (e.g. process restart). It does **not** automatically resume an interrupted HTTP request.

Example (after creating a session):

```bash
curl -s http://localhost:8000/agents/run \
  -H 'content-type: application/json' \
  -H 'X-User-Id: demo-user-1' \
  -d '{"message":"What is 2 + 3?","session_id":"<session-uuid>"}'
```

Postgres checkpointer integration tests require a dedicated URL (never the app `DATABASE_URL`):

```bash
export CHECKPOINT_TEST_DATABASE_URL='postgresql+psycopg://...'
pytest -m integration
```

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
| `CHECKPOINTS_SCHEMA` | `langgraph` | Schema for LangGraph checkpoint tables |

`POST /agents/run` returns `execution_id`. That id is the LangSmith root run id. Metadata on the trace is only `execution_id`, `agent_id`, and `environment`.

### Tool registry

Approved tools live in a central `ToolRegistry` (`app.agents.tools`). Built-ins: `add`, `multiply`, `echo`.

## Quality

```bash
ruff check app tests
ruff format --check app tests
pytest
# optional: CHECKPOINT_TEST_DATABASE_URL=... pytest -m integration
```

## Docker

```bash
docker build -t agent-platform-api:local .
docker run --rm -p 8000:8000 -e ENVIRONMENT=demo agent-platform-api:local
```

## Azure

Container App env vars are owned by Bicep (`ENVIRONMENT`, `DATABASE_URL`, `POSTGRES_SCHEMA`, `CORS_ALLOWED_ORIGINS`, optional `LLM_API_KEY` / LangSmith). Set `CHECKPOINTS_SCHEMA` when overriding the default `langgraph` checkpoint schema. Run `alembic upgrade head` against Supabase before relying on session APIs in demo; checkpointer tables are created by `AsyncPostgresSaver.setup()` on app startup. `backend-cd` builds/pushes GHCR and updates the Container App image only.
