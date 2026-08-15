from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.dependencies import fastapi_users
from app.auth.backend import auth_backend
from app.auth.router import router as users_router
from app.auth.schemas import UserRead, UserUpdate
from app.cases.router import router as cases_router
from app.core.config import settings
from app.core.database import init_db
from app.core.rate_limit import rate_limit_login
from app.import_data.router import router as import_data_router
from app.reference_data.router import router as reference_data_router
from app.reports.router import router as reports_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Case Logger API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth (fastapi-users) ---
# Rate-limited (plan T7.1) to blunt brute-force login attempts — 10/min per
# IP, applied to the whole router (login + logout) since fastapi-users owns
# the route functions directly and can't be decorated individually.
app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/jwt",
    tags=["auth"],
    dependencies=[Depends(rate_limit_login)],
)

# /users/me (any authed user) + admin-only patch/delete of a specific user.
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"]
)
# GET /users (list), POST /users (admin-provisioned create — not
# fastapi-users' /auth/register, see app/auth/router.py's create_user for
# why), POST /users/{id}/unlock.
app.include_router(users_router)

# --- App routers ---
app.include_router(cases_router)
app.include_router(reference_data_router)
app.include_router(reports_router)
app.include_router(import_data_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
