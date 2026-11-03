# Backend

FastAPI foundation for the Enterprise AI Agent Platform (issues #7–#8).

## Layout

```text
app/
  api/           # HTTP routers (health, agents)
  agents/        # LangGraph runtime (state, tools, graph, invoke)
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
| `LLM_API_KEY` | unset | Required for live `POST /agents/run` |
| `LLM_MODEL` | `gpt-4o-mini` | OpenAI-compatible model id |
| `LLM_BASE_URL` | unset | Optional OpenAI-compatible base URL |
| `AGENT_RECURSION_LIMIT` | `10` | LangGraph recursion limit (tool-loop guard) |

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
