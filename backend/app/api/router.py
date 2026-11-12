from fastapi import APIRouter

from app.api.routes import agent_access, agents, executions, health, sessions, skills

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(agents.router)
api_router.include_router(agent_access.router)
api_router.include_router(sessions.router)
api_router.include_router(executions.router)
api_router.include_router(skills.router)
