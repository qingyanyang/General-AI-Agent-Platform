from fastapi import APIRouter

from app.api.routes import (
    agent_access,
    agents,
    catalog,
    executions,
    groups,
    health,
    sessions,
    skills,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(agents.router)
api_router.include_router(catalog.router)
api_router.include_router(agent_access.router)
api_router.include_router(groups.router)
api_router.include_router(users.router)
api_router.include_router(sessions.router)
api_router.include_router(executions.router)
api_router.include_router(skills.router)
