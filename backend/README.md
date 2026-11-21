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
evals/           # Offline regression dataset, graders, and optional LangSmith upload
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

An access token with `email_verified: false` is rejected. Install `backend/auth0/post-login-verify-email.js` so Auth0 also refuses the login and adds `{AUTH0_AUDIENCE}/email`, `{AUTH0_AUDIENCE}/email_verified`, and `{AUTH0_AUDIENCE}/name` to the access token. Set `AUTH0_REQUIRE_VERIFIED_EMAIL=true` after that Action is active. Invitations use a Management API application (`AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`) to find or create the one linked user for an email and assign the User, Admin, or Super Admin role. The database connection name defaults to `Username-Password-Authentication` (`AUTH0_DB_CONNECTION`). For the deployed API, add those two values as GitHub secrets and run an infra deploy so the Container App receives them.

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
| `agents:read` | List/get agents (with view/audience eligibility), sessions, and message history |
| `agents:execute` | Create/archive sessions, post/stream messages, `POST /agents/run` |
| `agents:configure` | Create (with manage) / update metadata / deactivate agents |
| `agent-access:manage` | Business access admin: grants, access-config, activate; view every Agent. Audience-mode use is included. Legacy execution still needs that user's grant |
| `platform:technical` | Technical configuration and protected catalogs (prompt, tools, models, skill detail) |

| Role | Permissions |
| --- | --- |
| Super Admin | all five, including `platform:technical` |
| Admin | `agents:read`, `agents:execute`, `agents:configure`, `agent-access:manage` — **never** `platform:technical` |
| User | `agents:read`, `agents:execute` |

Do **not** treat Agent Developer as a target role. Group leadership does **not** grant `platform:technical`. Existing Auth0 roles may remain during migration; do **not** grant technical permission to Admin (or legacy Agent Developer) as a compatibility shortcut.

Missing or incomplete permissions → **403** (`Permission denied`). Platform permissions do **not** bypass session ownership. Modes are never OR'd: legacy grants authorize only `legacy_grants` Agents; audience membership authorizes only `audience` Agents. `agent-access:manage` can view every Agent, including legacy-grant Agents and audience Agents with an empty group set. Audience-mode execution is included. Executing a legacy-grant Agent still requires that user's execute grant. It never grants cross-user session access.

### Agent catalog (#19)

Agents are persisted rows (`id`, `name`, `description`, `status`, `created_by`). Migrations always seed a fixed active agent `id=default`. If you set `AGENT_ID` to something else, provision that agent separately (create via API or SQL)—migrations do not read runtime settings.

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/agents` | `agents:configure` **and** `agent-access:manage` — audience mode + empty selected groups; **no** creator grant |
| `GET` | `/agents` | `agents:read` — lists agents the caller can **view** (SQL filter before pagination; `status=active\|inactive\|all`, default `active`) |
| `GET` | `/agents/{agent_id}` | `agents:read` + VIEW scope; **missing → 404** (catalog non-disclosure; distinct from session-scoped **403**) |
| `PATCH` | `/agents/{agent_id}` | `agents:configure` + CONFIGURE scope — `name` / `description` only |
| `GET`/`PUT` | `/agents/{agent_id}/access-config` | `agent-access:manage` — audience/owning-group configuration |
| `POST` | `/agents/{agent_id}/access-config/activate` | `agent-access:manage` — sets `authorization_mode=audience` from saved config; does not delete grants |
| `GET`/`PUT` | `/agents/{agent_id}/instruction-skills` | authenticated; `agent-access:manage` **or** a group Leader with view access to the Agent — published business Instruction Skills |
| `GET`/`PUT` | `/agents/{agent_id}/knowledge-references` | `agent-access:manage` or a group Leader with view access to the agent. Stores document names and sizes. |
| `GET` | `/groups`, `/groups/{group_id}` | authenticated. Group lists and details include the caller’s designation when present. |
| `GET` | `/groups/{group_id}/memberships`, `/groups/{group_id}/agents` | group members, Leaders, and callers with `agent-access:manage`. |
| `GET` | `/agents/{agent_id}/configuration` | `platform:technical` + CONFIGURE scope — system prompt, LLM, temperature, tool and skill assignments |
| `PUT` | `/agents/{agent_id}/configuration` | `platform:technical` + CONFIGURE scope — full replace (row-locked) |
| `POST` | `/agents/{agent_id}/deactivate` | `agents:configure` + CONFIGURE scope — soft-deactivate (idempotent) |
| `GET` | `/tools`, `/llm-models` | `platform:technical` |
| `GET` | `/skills` | `agents:read` — curated skill catalog (**name + description only**) |
| `GET` | `/skills/{name}` | `platform:technical` — full instructions + descriptive resource refs |

**Deactivation** blocks **all new executions** with **409** `Agent is inactive` (before the model runs): new sessions, existing-session JSON/SSE, and session-scoped or stateless `/agents/run`. Existing history remains readable under ownership + view grants.

### Agent configuration (#20)

Persisted per agent: `system_prompt` (exact max **20 000** characters; whitespace preserved), `llm_provider` / `llm_model` (must be in `APPROVED_LLM_MODELS`), `temperature` (required when the approved entry supports it; must be `null` when it does not), `tool_names` (registered tools only; **empty means no tools**, never all tools), and `skill_names` (curated skills only; **empty means no skills**, never all skills).

- **GET/PUT** `/agents/{id}/configuration` require `platform:technical` plus mode-specific CONFIGURE scope (legacy: configure grant; audience: `agent-access:manage`). Configure grants alone never bypass `platform:technical`. Prompt, tool, and skill lists are not returned on `AgentOut` list/get.
- **Disclosure caveat:** configure-gated GET protects the stored prompt from users without configure access, but a model may still echo or paraphrase prompt content in replies visible to executors.
- **Execution snapshot:** before a run (including before SSE headers), the API loads the agent once (including published Instruction Skills), builds an immutable `AgentExecutionConfig`, validates it (approved LLM, temperature, registered tools and skills, API key), then closes the DB session. Mid-run config edits do not affect that turn. Invalid config → **503** (JSON, not a started stream).
- **System prompt** is prepended as an ephemeral `SystemMessage` on each model call only — it is not written into checkpoint history. Published Instruction Skills are composed next (stored order), then curated skill **names and descriptions**; full curated skill instructions still load only via `load_skill`.
- **Tool assignment:** adding a tool checks the caller's permissions against that tool's `required_permissions`; removing a tool does not. Runtime authorization uses `ToolAuthContext.allowed_tools` from the snapshot (replaces the former code allowlist map). The internal `load_skill` tool cannot be persisted in `tool_names`.
- Migration `20261111_0005` backfills fixed DeepSeek literals (`deepseek` / `deepseek-flash` / `temperature=1.0`); `default` also gets built-in tools. Migration `20261112_0007` adds `skill_names` defaulting to `[]`. Application `POST /agents` defaults come from settings + catalog (no silent “first catalog entry” fallback if `LLM_PROVIDER`/`LLM_MODEL` are unapproved).

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

#### Auth0 Dashboard setup (manual; Issue 4)

Do **not** change Auth0 from automation. Operators must:

1. On **EAP API**, enable **RBAC** and **Add Permissions in the Access Token**.
2. Create permissions exactly: `agents:read`, `agents:execute`, `agents:configure`, `agent-access:manage`, **`platform:technical`**.
3. Align roles to the target matrix: **Super Admin** (all five), **Admin** (business four, no technical), **User** (read+execute). Do not keep Agent Developer as a target role; do not add `platform:technical` to Admin.
4. Assign roles in the Dashboard. Users must **refresh tokens** (re-login / new PKCE token) after permission changes — existing tokens keep the old claim set.
5. **Manual check:** after assigning Super Admin, obtain a **new** access token and call `GET /agents/{id}/configuration` (expect 200 with technical). With Admin-only tokens, expect **403** on technical routes.

```bash
# After assigning User and getting a fresh access token:
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
| `APPROVED_MCP_SERVERS` | `[]` | JSON array of `{name, url}` Streamable HTTP MCP servers. Empty registers no MCP tools. Names match `^[a-z][a-z0-9_]{0,31}$` and must not contain `__`. URLs are `http` or `https` with no userinfo. Authenticated MCP servers are not supported in this version |
| `MCP_TIMEOUT_SECONDS` | `10` | Deadline for one discovery or one tool call, including connect and initialize |
| `MCP_CLEANUP_TIMEOUT_SECONDS` | `2` | Separate deadline for closing the MCP session and HTTP client after the operation |

`POST /agents/run` returns `execution_id`. That id is the LangSmith root run id. Metadata on the trace is only `execution_id`, `agent_id`, and `environment`.

### Tool registry and authorization

Approved tools live in a central `ToolRegistry` (`app.agents.tools`). Built-ins: `add`, `multiply`, `echo`, plus internal `load_skill` (#23). Each registration declares `required_permissions` (built-ins require `agents:execute`).

**Authorization (#18 + #20)** is separate from agent access grants (#17):

- Each agent's persisted `tool_names` is the allowlist. Empty means **no tools** (fail closed). There is no code-level `agent_id` → tools map.
- Public runners (`run_agent` / `stream_agent`) require a trusted `ToolAuthContext` (`user_id`, `permissions`, `agent_id`, `allowed_tools`, `allowed_skills`) and an `AgentExecutionConfig` snapshot from the API — never from the model.
- The model only sees the permitted intersection (`allowed_tools` ∩ registry ∩ user permissions). An empty set uses an unbound model (no `bind_tools([])`). There is no full-registry fallback.
- `registry.aexecute(..., context=None)` is the sole execution-time authz boundary; omitted context raises `ToolAuthorizationError` (not `TypeError`). The tools node maps denials to controlled `ToolMessage`s.
- Auth context is bound on a non-persisted `ContextVar` inside the graph consumer / stream producer (`try`/`finally`). It is not written to checkpoints or LangSmith metadata/`configurable`.

The same policy applies to JSON session messages, SSE streams, and `POST /agents/run`.

### MCP tools

Startup discovers tools from `APPROVED_MCP_SERVERS` with the MCP Python SDK 1.30 Streamable HTTP client (`streamable_http_client`). Legacy HTTP+SSE (`sse_client`) is not used. Streamable HTTP responses may still be `text/event-stream`.

Discovered tools are registered as `{server}__{remote}` and executed only through `registry.aexecute`. The original remote name is what the client sends to `call_tool`. A tool whose name is unsafe for the configured OpenAI-compatible providers, contains `__`, collides with another registry entry, or publishes an external `$ref` is skipped. Discovery follows `list_tools` pagination. One server failing discovery does not drop tools from the other servers and does not stop the process. The catalog stays fixed until restart.

Redirects are not followed unless the target is the approved URL or that URL with only a trailing slash added or removed. A cross-origin or different-path redirect is a connection failure.

`isError=true` becomes a tool-execution `ToolMessage` (`Tool execution error for '{name}'`). Timeouts and transport failures use `Tool connection error for '{name}'`. Neither message includes the raw exception. Caller cancellation closes the session and client, then propagates; it is not turned into a tool error. Shutdown itself has `MCP_CLEANUP_TIMEOUT_SECONDS` so a hung close cannot hold the request. A result that already arrived is returned even if the session DELETE or client close hangs or fails.

If an agent's saved `tool_names` includes a tool that was not in the startup catalog, execution preflight returns HTTP 503 before the model runs and before SSE response headers. The saved `tool_names` are left unchanged.

### Published Instruction Skills (Issue 5)

Per-agent **business** instructions distinct from the technical `system_prompt` and from curated `#23` skills.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/agents/{agent_id}/instruction-skills` | `get_current_user`; then manage **or** owning-group Leader |
| `PUT` | `/agents/{agent_id}/instruction-skills` | same — full replacement is publication |

- **Fields:** ordered `items[]` of `{ name, description, instructions }` (prototype-aligned). No resource/script/tool/permission fields. Unknown JSON fields are rejected.
- **Limits:** at most **50** items; `name` ≤ 120 (trimmed, non-empty, unique case-insensitive); `description` ≤ 2 000 (trimmed, may be empty); `instructions` ≤ 20 000 (reject whitespace-only; preserve accepted text exactly); aggregate length of all submitted name+description+instructions ≤ **50 000**. Empty `items` clears the published collection.
- **Authorization:** `agent-access:manage`, or a group Leader with view access under the Agent’s current audience or legacy grant rules. Editing does not activate audience mode or change group memberships. Unknown Agent → **404**; existing Agent without edit rights → **403**. Unauthenticated → **401**.
- **Persistence:** table `agent_instruction_skills`; PUT locks the Agent row (`FOR UPDATE`), re-checks authorization, validates **before** deletes, then replaces in one transaction. SQLite tests do **not** prove PostgreSQL row-lock concurrency.
- **Runtime:** loaded into the immutable execution snapshot at the API boundary (JSON, SSE, stateless/session run, approval resume). Composed into the ephemeral system prompt after `system_prompt` and before the curated skill catalog. Not tools, not `skill_names`, not checkpointed messages. Publication affects the **next** request's snapshot; an in-flight snapshot is unchanged. Resume keeps the frozen tool batch; the following model call sees the new instructions.

### Agent skills (#23)

Skills are curated instruction packages in an in-process registry (`app.agents.skills`). There is no skills DB table and no runtime skill CRUD.

- **Operator access:** `GET /skills` (`agents:read`) returns names and descriptions only. `GET /skills/{name}` (`agents:configure`) returns instructions and descriptive resource refs. Operators may inspect all curated skills; assignment restricts **runtime loading**, not operator catalog/detail access.
- **Assignment:** persist `skill_names` on agent configuration. Empty means no skills. Unknown names are rejected on PUT; a saved skill missing from the registry yields HTTP **503** at execution preflight.
- **Runtime:** assigned skills appear in the ephemeral system catalog as name + description only. Full instructions load only when the model calls `load_skill`. `execution_bundle` adds `load_skill` to the run-only tool allowlist when `skill_names` is non-empty; empty skills means no loader. `load_skill` always re-checks `allowed_skills` and never grants additional tool permissions. Resource ids are descriptive references only — the platform does not fetch or open them.
- **Checkpoint retention:** `load_skill` returns a normal `ToolMessage`. That text remains in the session’s checkpoint history across turns. Removing a skill assignment prevents future loads and removes the catalog entry for new runs, but previously loaded instructions stay in that same session until a **new** session/thread is started.
- **Disclosure caveat:** the configure gate on `GET /skills/{name}` does not keep instructions from executors. Once loaded, an assigned skill's instructions appear in `GET /sessions/{id}/messages` (role `tool`) and in SSE `tool.end` events, visible to anyone who can run and view that session. Do not put confidential content in skills.

### Human approval (#24)

`approval_tool_names` on an agent configuration is the subset of `tool_names` that must pause for a decision. Empty means the agent does not pause. Names outside `tool_names` are rejected. `awaiting_approval` is a non-terminal execution status: `completed_at` stays null until the run finishes.

A session run claims `session_run_gates` in the same transaction as the `running` execution row. A second message, SSE stream, session-scoped `POST /agents/run`, or approval for that session returns **409** until the gate is idle. The gate is a database claim, not a process lock.

| Request | When the run pauses | When it finishes |
| --- | --- | --- |
| `POST /sessions/{id}/messages` | **202** `PendingApproval` | **200** `ChatMessageCreateResult` (`execution_id`, `message.role`, `message.content`) |
| Session-scoped `POST /agents/run` | **202** `PendingApproval` | **200** `AgentRunResponse` (`reply`, `execution_id`, `messages`) |
| `POST /sessions/{id}/approvals/{interrupt_id}/approve` or `reject` | **202** `PendingApproval` if another gated call is next | **200** `ChatMessageCreateResult` |
| `POST /sessions/{id}/messages/stream` | **200** `text/event-stream` after preflight, then `approval.required`, then the stream closes | **200** stream ending in `done` |

SSE preflight is unchanged: **401**, **403**, **404**, **409**, and **503** are returned before the stream starts. A pause does not emit `done` or `error`. Stateless `POST /agents/run` (no `session_id`) cannot pause. A gated call becomes an error tool message and is not executed; the **200** body stays `AgentRunResponse`.

`GET /sessions/{id}/approvals` returns the current checkpoint interrupt, including when a crash left the gate `running`. Approve and reject require the gate to be `awaiting_approval` and the path interrupt id, body `tool_call_id`, and stored checkpoint id to match. A mismatch or a second decision is **409**. Unknown, archived, or another user's session is **404**. An owned session whose caller lacks the agent grant is **403**.

The tools node freezes tool ids, names, arguments, and `requires_approval` before any `interrupt()` or tool execution. Resume uses that frozen batch. Removing an approval requirement does not skip a decision that is already pending. Resume rebuilds tool authorization from the current caller. A tool that is no longer permitted is not executed.

The checkpoint write and the gate update are separate. A crash after the interrupt is checkpointed and before the gate moves to `awaiting_approval` leaves both the execution and the gate `running`. Do not release that gate while a worker might still be executing tools. `lease_heartbeat_at` is diagnostic only. A stale heartbeat is not a reason to recover.

Operator recovery is `recover_stuck_run` (not an HTTP sweeper). Stop or confirm termination of every worker that could still own the run **before** changing the gate. If the checkpoint has an interrupt, recovery moves the rows to `awaiting_approval` and does not add the unknown crash gap to `active_duration_ms`. Otherwise it fails the execution using only the duration already recorded and idles the gate.

A successful graph retries its final gate update up to three times. If that still fails, the response stays successful and the gate stays blocked for an operator. Replay-safe approval is not exactly-once for external side effects: if the process dies after a tool runs and before the checkpoint write, a later resume can run that tool again. Tools with side effects need their own idempotency.

Business-table concurrency tests use `TEST_DATABASE_URL`. Checkpoint tests keep using `CHECKPOINT_TEST_DATABASE_URL`. Do not point gate tests at the checkpoint database.

```bash
export TEST_DATABASE_URL='postgresql+psycopg://...'
pytest -m business_db
```

## Evaluation (#26)

Deterministic runs are regression tests of graph execution, authorization, and the graders. They do not measure whether a real model selects the right tool. Model-quality scores come only from the optional live example.

These tests are CI-ready; run them locally with the documented pytest command. They are not yet running in CI.

`agent-platform-agent-core` is an evaluation-owned LangSmith dataset. The checked-in JSON is the source of truth. `python -m evals --upload` updates existing rows, adds rows that are missing remotely, and **deletes remote examples that are not in the JSON**, including duplicate ids. Upload does not turn tracing on. A local run emits no tracing requests and then restores the previous tracing settings.

```bash
python -m evals
# optional live model-quality example; fails if the provider key is missing
# EVAL_LLM=1 python -m evals
# optional: LANGSMITH_API_KEY=... python -m evals --upload
```

A normal run prints `Live model-quality checks: skipped`.

## Quality

```bash
ruff check app evals tests
ruff format --check app evals tests
pytest
# optional: CHECKPOINT_TEST_DATABASE_URL=... pytest -m integration
# optional: TEST_DATABASE_URL=... pytest -m business_db
```

## Docker

```bash
docker build -t agent-platform-api:local .
docker run --rm -p 8000:8000 -e ENVIRONMENT=demo agent-platform-api:local
```

## Azure

Container App env vars are owned by Bicep (`ENVIRONMENT`, `DATABASE_URL`, `POSTGRES_SCHEMA`, `CORS_ALLOWED_ORIGINS`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_DB_CONNECTION`, optional `LLM_API_KEY` / LangSmith / `AUTH0_MGMT_*`). `CORS_ALLOWED_ORIGINS` always includes the Static Web App URL plus any `corsAllowedOrigins` param entries. Set `CHECKPOINTS_SCHEMA` when overriding the default `langgraph` checkpoint schema. `backend-cd` builds/pushes GHCR, runs `alembic upgrade head` from the runner with the `demo` environment's `DATABASE_URL` and `POSTGRES_SCHEMA=agent_platform`, then updates the Container App image. A failed migration stops the deploy. The runner is IPv4-only, so `DATABASE_URL` must be the Supabase session pooler URL. Checkpointer tables are created by `AsyncPostgresSaver.setup()` on app startup. `DATABASE_URL` may use `postgresql://` or `postgresql+psycopg://`; settings normalize it to the installed psycopg 3 driver.
