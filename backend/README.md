# Backend

FastAPI foundation for the Enterprise AI Agent Platform (issues #7–#17).

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

### Authentication (#15)

Protected routes accept Auth0 **API access tokens** only:

```http
Authorization: Bearer <access_token>
```

| Variable | Example | Notes |
| --- | --- | --- |
| `AUTH0_DOMAIN` | `dev-pf7wi26tb5bj8qxz.us.auth0.com` | Hostname only (no scheme, path, or query) |
| `AUTH0_AUDIENCE` | `https://api.agent-platform` | Auth0 API identifier |

Validation uses RS256 against Auth0 JWKS (`https://{AUTH0_DOMAIN}/.well-known/jwks.json`), and requires issuer `https://{AUTH0_DOMAIN}/`, audience, expiry, and a non-empty `sub` (max 512 characters — stored as session `user_id`). ID tokens and tokens for other APIs are rejected. `X-User-Id` is ignored and cannot set identity.

| Condition | Status |
| --- | --- |
| Missing / invalid / expired / wrong-issuer / wrong-audience / wrong-alg token | **401** with `WWW-Authenticate: Bearer` |
| Auth0 settings missing or not a hostname | **503** |
| JWKS cannot be retrieved when the signing key is not cached | **503** |

`/health` stays public. Protected: `/agents/run` (including stateless), session CRUD, message JSON, and SSE streaming. Authentication runs before persistence checks, streaming, and agent execution.

#### Manual token for local API calls

`curl` is not the login flow. Obtain a user access token with **Authorization Code + PKCE** against the **EAP Web** SPA (`http://localhost:5173` callback), audience `https://api.agent-platform`, then call the API:

1. In Auth0, authorize **EAP Web** for user-delegated access to **EAP API**.
2. Complete the Auth0 SPA / PKCE login in a browser (or Auth0’s sample SPA) and copy the **access token** (not the ID token).
3. Call the API with that token:

```bash
export ACCESS_TOKEN='...'   # Auth0 API access token for audience https://api.agent-platform

curl -s http://localhost:8000/sessions \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"agent_id":"default"}'
```

Backend verification does not use a client secret.

### Roles and permissions (#16)

Auth0 RBAC puts API permissions on the access token (`permissions` claim). The API authorizes by **exact** permission strings only (no trim/normalize). Roles are assigned in the Auth0 Dashboard; the backend does not trust a roles claim.

| Permission | Meaning |
| --- | --- |
| `agents:read` | List/get agents (with view grant), sessions, and message history |
| `agents:execute` | Create/archive sessions, post/stream messages, `POST /agents/run` |
| `agents:configure` | Create/update/deactivate agents (#19); creator auto-receives view+configure+execute on new agents |
| `agent-access:manage` | Grant / inspect / revoke per-user agent access (#17) |

| Role | Permissions |
| --- | --- |
| Admin | all four |
| Agent Developer | `agents:read`, `agents:configure`, `agents:execute` |
| Agent User | `agents:read`, `agents:execute` |

Missing or incomplete permissions → **403** (`Permission denied`). Platform permissions do **not** bypass session ownership or per-agent grants. **Admin has no implicit view/configure/execute** on agents — `agent-access:manage` only authorizes grant APIs.

### Agent catalog (#19)

Agents are persisted rows (`id`, `name`, `description`, `status`, `created_by`). Migrations always seed a fixed active agent `id=default`. If you set `AGENT_ID` to something else, provision that agent separately (create via API or SQL)—migrations do not read runtime settings.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/agents` | `agents:configure` — creates agent + creator grant (`view`+`configure`+`execute`) in one transaction; config defaults: empty prompt, catalog default LLM, `tool_names=[]` |
| `GET` | `/agents` | `agents:read` — lists agents the caller can **view** (`status=active\|inactive\|all`, default `active`) |
| `GET` | `/agents/{agent_id}` | `agents:read` + view grant; **missing view → 404** (catalog non-disclosure; distinct from session-scoped **403**) |
| `PATCH` | `/agents/{agent_id}` | `agents:configure` + configure grant — `name` / `description` only (`id` immutable; omit vs `null` for description) |
| `GET` | `/agents/{agent_id}/configuration` | `agents:configure` + configure grant — system prompt, LLM, temperature, tool assignments |
| `PUT` | `/agents/{agent_id}/configuration` | `agents:configure` + configure grant — full replace (row-locked); adding tools requires each tool's `required_permissions` |
| `POST` | `/agents/{agent_id}/deactivate` | `agents:configure` + configure grant — soft-deactivate (idempotent) |

**Deactivation** blocks **all new executions** with **409** `Agent is inactive` (before the model runs): new sessions, existing-session JSON/SSE, and session-scoped or stateless `/agents/run`. Existing history remains readable under ownership + view grants.

### Agent configuration (#20)

Persisted per agent: `system_prompt` (exact max **20 000** characters; whitespace preserved), `llm_provider` / `llm_model` (must be in `APPROVED_LLM_MODELS`), `temperature` (required when the approved entry supports it; must be `null` when it does not), and `tool_names` (registered tools only; **empty means no tools**, never all tools).

- **GET/PUT** `/agents/{id}/configuration` require both the `agents:configure` permission and a configure grant (same dual authz as catalog mutate). Prompt and tool lists are not returned on `AgentOut` list/get.
- **Disclosure caveat:** configure-gated GET protects the stored prompt from users without configure access, but a model may still echo or paraphrase prompt content in replies visible to executors.
- **Execution snapshot:** before a run (including before SSE headers), the API loads the agent once, builds an immutable `AgentExecutionConfig`, validates it (approved LLM, temperature, registered tools, API key), then closes the DB session. Mid-run config edits do not affect that turn. Invalid config → **503** (JSON, not a started stream).
- **System prompt** is prepended as an ephemeral `SystemMessage` on each model call only — it is not written into checkpoint history.
- **Tool assignment:** adding a tool checks the caller's permissions against that tool's `required_permissions`; removing a tool does not. Runtime authorization uses `ToolAuthContext.allowed_tools` from the snapshot (replaces the former code allowlist map).
- Migration `20261111_0005` backfills fixed DeepSeek literals (`deepseek` / `deepseek-flash` / `temperature=1.0`); `default` also gets built-in tools. Application `POST /agents` defaults come from settings + catalog (no silent “first catalog entry” fallback if `LLM_PROVIDER`/`LLM_MODEL` are unapproved).

Platform permissions remain required to use creator auto-grants (having `can_execute` on a grant does not replace `agents:execute`).

### Agent-level access (#17)

In addition to platform permissions, callers need a per-user grant for the specific `agent_id` (Auth0 `sub` + agent id). Agent ids must refer to a persisted Agent row (#19).

| Capability | Controls |
| --- | --- |
| `view` | Agent GET/list, session list/get, and message history |
| `execute` | Create session, post/stream messages, `POST /agents/run` (agent must be **active**) |
| `configure` | Agent PATCH / deactivate |

**Execute-only grants are allowed:** the user can create/send and receive the current-turn reply, but cannot list or retrieve history without `view`. JSON and SSE responses expose only the current run (not prior message objects). `/agents/run` without `view` returns `reply` plus a single current-turn assistant entry in `messages` — not the full checkpoint transcript.

**Limitation:** execute-only access hides history endpoints and historical message objects in API responses, but the **model still receives saved checkpoint context** and may repeat prior content in a new reply. Response filtering cannot guarantee historical information remains inaccessible.

**Archive:** owners may soft-delete sessions with platform `agents:execute` only (no agent grant). Idempotent for already-archived owned sessions.

**Status codes (session-scoped):** unknown / archived / other-user → **404** first; owned session missing the required agent capability → **403** (`Agent access denied`). Session lists SQL-filter to viewable `agent_id`s before limit/cursor.

**Admin grant API** (`agent-access:manage`):

| Method | Path | Notes |
| --- | --- | --- |
| `PUT` | `/agent-access/grants` | Full replace upsert; all three booleans required; all-false deletes |
| `GET` | `/agent-access/grants` | Optional `user_id` / `agent_id` filters, then `limit`/`cursor` pagination |
| `DELETE` | `/agent-access/grants` | Query `user_id` + `agent_id`; 404 if missing |

Revocation applies to subsequent requests only (cancelling in-flight runs is out of scope). Stateless `/agents/run` authorizes against `AGENT_ID` / `settings.agent_id` (default `default`).

#### Auth0 Dashboard setup

1. On **EAP API**, enable **RBAC** and **Add Permissions in the Access Token**.
2. Create the four permissions above (names must match exactly).
3. Create roles **Admin**, **Agent Developer**, and **Agent User** with the matrix.
4. Assign a role to the user in the Dashboard (no Management API in this milestone).
5. **Manual check:** after assigning a role, obtain a **new** PKCE access token and call a protected route. Mocked tokens cannot prove Dashboard wiring.

```bash
# After assigning Agent User and getting a fresh access token:
curl -s http://localhost:8000/sessions \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"agent_id":"default"}'
# Expect 201 when the token includes agents:execute; 403 otherwise.
```

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
  -H "Authorization: Bearer $ACCESS_TOKEN" \
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

**Error precedence** (FastAPI `Depends` may return **422** for body first):

1. Missing / invalid credentials → **401** (or Auth0 config / JWKS failure → **503**)
2. Saver unavailable → **503** (POST and GET)
3. Unknown / archived / other-user session → **404**
4. LLM not configured → **503** (**POST only**; GET never checks LLM)
5. Agent execution failure → **502** (POST only)

**Failed runs:** A **502** does not mean nothing was saved. The checkpoint may already contain the new user message (and tool turns). Retrying the same POST may **duplicate** the user message in history.

**Activity:** After a successful POST, `last_activity_at` is updated on the request-scoped DB session. Checkpoint writes and that ORM update are not atomic. If the timestamp update fails, the API rolls back the ORM transaction, logs the metadata failure, and still returns **200** with the assistant reply.

```bash
curl -s http://localhost:8000/sessions/<session-uuid>/messages \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"content":"What is 2 + 3?"}'
```

### SSE streaming (#14)

`POST /sessions/{id}/messages/stream` uses the same body, bearer authentication, and ownership rules as `POST /sessions/{id}/messages`. The response is `text/event-stream`. Each frame has an `event` name and one JSON `data` line whose `type` matches that name.

Pre-stream HTTP errors, in order:

1. Missing / invalid credentials → **401** (or Auth0 config / JWKS failure → **503**)
2. Validation (body) → **422**
3. Checkpointer unavailable → **503**
4. Unknown, archived, or another user's session → **404**
5. Agent inactive → **409**; missing execute grant → **403**
6. Invalid/missing agent configuration or LLM API key → **503** (before SSE starts)

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
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"content":"What is 2 + 3?"}'
```

`POST /agents/run` remains available for ad-hoc/stateless invokes (and optional `session_id` from #12). It requires the same bearer token.

### Agent execution history (#21)

Each successful preflight on `POST /agents/run`, `POST /sessions/{id}/messages`, and `POST /sessions/{id}/messages/stream` inserts a metadata row (`running`) **before** the model runs (and before SSE starts). Terminal updates are idempotent (`WHERE status='running'` only).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/executions` | `agents:read` — caller's own rows (`limit`/`cursor`, filters `status`, `agent_id`, `session_id`) |
| `GET` | `/executions/{id}` | `agents:read` — owned row or **404** |

Ownership filters rows; it does **not** replace platform `agents:read`. Users without an agent `can_view` grant who still hold `agents:read` can list/get **their own** runs. `agent-access:manage` does **not** grant cross-user history (future permission if needed).

Rows store metadata only (ids, status, timestamps, `duration_ms`, sanitized `error_summary`) — **not** conversation content, prompts, tool output, or provider payloads. `langsmith_run_id` equals the execution UUID and is a **correlation id**; it does not guarantee a LangSmith trace exists.

`duration_ms` uses a monotonic clock; `started_at` / `completed_at` are UTC. While `running`, `completed_at`, `duration_ms`, and `error_summary` stay null. Process crashes or failed finalization can leave rows `running`; automatic reconciliation is out of scope. Graph success is recorded as `succeeded` even if the client disconnects during delivery of `done`; `cancelled` is used when cancellation interrupts execution.

Failed initial insert → **503** and the model is never invoked. Finalization failures are logged and do not turn a successful reply into an error response.

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
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"What is 2 + 3?"}'
```

Without `LLM_API_KEY`, `POST /agents/run` returns **503**. Without a valid access token it returns **401**.

`DATABASE_URL` is optional for `/health` but required for session APIs, Alembic, and the LangGraph checkpointer.

### PostgreSQL checkpointer (#12)

On startup, if `DATABASE_URL` is set, the app opens an `AsyncConnectionPool` + `AsyncPostgresSaver`, runs `setup()`, and stores the saver on `app.state`. Pool connections use `autocommit=True`, `row_factory=dict_row`, and `search_path` set to `CHECKPOINTS_SCHEMA` (default `langgraph`). Checkpoint tables are **not** Alembic/ORM models — they stay separate from `POSTGRES_SCHEMA`. Prefer a **session** pooler (not transaction pooler) for psycopg.

If `DATABASE_URL` is unset, the checkpointer stays disabled (stateless runs only). If `DATABASE_URL` is set but pool/setup fails, startup fails after closing allocated resources.

| Request | Behaviour |
| --- | --- |
| No `session_id` | Graph compiled **without** a checkpointer (stateless), even if a saver exists |
| Owned active `session_id` + saver available | Checkpointed graph; `thread_id = str(session.id)` |
| `session_id` + saver unavailable | **503** (after authentication; before ownership DB queries) |

Durable turns require a validated access token and a session UUID that belongs to that user and is not archived (unknown / other-user / archived → **404**). Clients never pass a raw `thread_id`. Each turn sends only the new user message; checkpoint restore retains history.

**Restart recovery** means continuing a conversation from persisted checkpoint state after recreating the pool/saver/graph (e.g. process restart). It does **not** automatically resume an interrupted HTTP request.

Example (after creating a session):

```bash
curl -s http://localhost:8000/agents/run \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
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
| `LLM_PROVIDER` | `openai` | Process default provider; must be in `APPROVED_LLM_MODELS` with `LLM_MODEL` (no silent fallback) |
| `LLM_API_KEY` | unset | Primary key for live agent runs (process-wide; not stored per agent) |
| `DEEPSEEK_API_KEY` | unset | Optional DeepSeek key if `LLM_API_KEY` is unset |
| `LLM_MODEL` | `gpt-4o-mini` | Process default model; DeepSeek + this OpenAI default remaps to `deepseek-flash` for create defaults and legacy `create_chat_model` |
| `LLM_BASE_URL` | unset | OpenAI-compatible base URL; DeepSeek defaults to `https://api.deepseek.com` |
| `APPROVED_LLM_MODELS` | built-in JSON catalog | JSON array of `{provider, model, temperature_min?, temperature_max?}`; PUT configuration and create defaults must match |
| `AGENT_RECURSION_LIMIT` | `10` | LangGraph recursion limit (tool-loop guard) |
| `AGENT_ID` | `default` | Stateless `/agents/run` target + LangSmith `metadata.agent_id` |
| `LANGSMITH_TRACING` | `false` | Turn on LangSmith tracing for agent runs |
| `LANGSMITH_API_KEY` | unset | Required when tracing is on; tracing stays off if it is missing |
| `LANGSMITH_ENDPOINT` | LangSmith default | Optional API base URL (use APAC if your org is on that data plane) |
| `POSTGRES_SCHEMA` | `agent_platform` | Schema for ORM tables / Alembic version table |
| `CHECKPOINTS_SCHEMA` | `langgraph` | Schema for LangGraph checkpoint tables |
| `AUTH0_DOMAIN` | unset | Auth0 tenant hostname (required for protected routes) |
| `AUTH0_AUDIENCE` | unset | Auth0 API audience (required for protected routes) |

`POST /agents/run` returns `execution_id`. That id is the LangSmith root run id. Metadata on the trace is only `execution_id`, `agent_id`, and `environment`.

### Tool registry and authorization

Approved tools live in a central `ToolRegistry` (`app.agents.tools`). Built-ins: `add`, `multiply`, `echo`. Each registration declares `required_permissions` (built-ins require `agents:execute`).

**Authorization (#18 + #20)** is separate from agent access grants (#17):

- Each agent's persisted `tool_names` is the allowlist. Empty means **no tools** (fail closed). There is no code-level `agent_id` → tools map.
- Public runners (`run_agent` / `stream_agent`) require a trusted `ToolAuthContext` (`user_id`, `permissions`, `agent_id`, `allowed_tools`) and an `AgentExecutionConfig` snapshot from the API — never from the model.
- The model only sees the permitted intersection (`allowed_tools` ∩ registry ∩ user permissions). An empty set uses an unbound model (no `bind_tools([])`). There is no full-registry fallback.
- `registry.aexecute(..., context=None)` is the sole execution-time authz boundary; omitted context raises `ToolAuthorizationError` (not `TypeError`). The tools node maps denials to controlled `ToolMessage`s.
- Auth context is bound on a non-persisted `ContextVar` inside the graph consumer / stream producer (`try`/`finally`). It is not written to checkpoints or LangSmith metadata/`configurable`.

The same policy applies to JSON session messages, SSE streams, and `POST /agents/run`.

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
