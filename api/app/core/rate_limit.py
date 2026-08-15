"""Per-IP rate limiting for the login endpoint — plan T7.1.

`fastapi-users` owns the `/auth/jwt/login` route function directly, so a
decorator-based limiter (slowapi's usual pattern) can't be attached to it.
Using the `limits` library's primitives directly as a plain dependency
avoids that mismatch and gives an exact route scope via
`include_router(..., dependencies=[...])` in `app/main.py`.

In-memory storage — fine for a single-process MVP deployment (see plan
§7's JWT trade-off note for the same single-process caveat). Move to a
shared backend (e.g. Redis, which `limits` also supports) if the API ever
runs multiple worker processes.
"""

from fastapi import HTTPException, Request, status
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter

_storage = MemoryStorage()
_strategy = MovingWindowRateLimiter(_storage)
_LOGIN_LIMIT = parse("10/minute")


def reset_login_rate_limit() -> None:
    """Test-only hook — the storage is module-level/in-memory, so without
    this every test sharing one client IP would share one rate-limit bucket
    across the whole session."""
    _storage.reset()


async def rate_limit_login(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    if not _strategy.hit(_LOGIN_LIMIT, "login", client_ip):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many login attempts. Please wait a minute and try again.",
        )
