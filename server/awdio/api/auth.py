"""GET /api/config, POST /api/unlock and the middleware that gates /api/* behind the access PIN."""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from .. import __version__
from ..auth import COOKIE_MAX_AGE, COOKIE_NAME
from ..errors import ApiError, error_response
from ..services import Services, get_services

router = APIRouter()

OPEN_PATHS = {"/api/config", "/api/unlock"}


class UnlockBody(BaseModel):
    pin: str = Field(max_length=16)


@router.get("/api/config")
def config(request: Request, services: Services = Depends(get_services)) -> dict[str, Any]:
    gate = services.gate
    return {
        "accessPinRequired": gate.required,
        "unlocked": gate.is_unlocked(request.cookies.get(COOKIE_NAME)),
        "version": __version__,
    }


@router.post("/api/unlock", status_code=204)
def unlock(body: UnlockBody, request: Request, services: Services = Depends(get_services)) -> Response:
    gate = services.gate
    if not gate.required:
        return Response(status_code=204)
    client = request.client.host if request.client else "unknown"
    wait = gate.locked_for(client)
    if wait > 0:
        raise ApiError(429, "too_many_attempts", f"too many wrong attempts; try again in {math.ceil(wait)} s")
    if not gate.check(client, body.pin.strip()):
        raise ApiError(401, "wrong_pin", "that PIN is not right")
    response = Response(status_code=204)
    response.set_cookie(
        COOKIE_NAME,
        gate.token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return response


async def pin_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    path = request.url.path
    if path.startswith("/api/") and path not in OPEN_PATHS and request.method != "OPTIONS":
        gate = request.app.state.services.gate
        if not gate.is_unlocked(request.cookies.get(COOKIE_NAME)):
            return error_response(401, "locked", "enter the access PIN first")
    return await call_next(request)
