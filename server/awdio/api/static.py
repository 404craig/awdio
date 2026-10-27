"""Serve the built frontend (web/dist) with SPA fallback; mounted after the API routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from ..errors import ApiError

_ASSET_CACHE = "public, max-age=31536000, immutable"


def static_router(dist: Path) -> APIRouter:
    router = APIRouter()
    root = dist.resolve()

    @router.get("/{path:path}", include_in_schema=False, response_model=None)
    def frontend(path: str, request: Request) -> FileResponse | JSONResponse:
        if path == "api" or path.startswith("api/"):
            raise ApiError(404, "not_found", f"no API route {request.url.path}")
        index = root / "index.html"
        if not index.is_file():
            return JSONResponse(_hint(), status_code=200 if path == "" else 404)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            headers = {"Cache-Control": _ASSET_CACHE} if path.startswith("assets/") else None
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return router


def _hint() -> dict[str, Any]:
    return {
        "app": "awdio",
        "message": "The web app is not built. Run `make build` (or `cd web && npm run build`), "
                   "or use the Vite dev server on http://localhost:5173.",
        "api": "/api/health",
    }
