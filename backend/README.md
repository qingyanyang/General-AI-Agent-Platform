# Backend

FastAPI foundation for the Enterprise AI Agent Platform (issue #7).

## Layout

```text
app/
  api/           # HTTP routers
  agents/        # Agent runtime (future; LangGraph out of scope here)
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

`DATABASE_URL` is optional for `/health`. Importing `app.core.database` helpers requires it.

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

Container App env vars are owned by Bicep (`ENVIRONMENT`, `DATABASE_URL`, `POSTGRES_SCHEMA`, `CORS_ALLOWED_ORIGINS`, optional `LLM_API_KEY`). `backend-cd` builds/pushes GHCR and updates the Container App image only.
