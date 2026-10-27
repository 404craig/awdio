from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..services import Services, get_services

router = APIRouter()


@router.get("/api/health")
def health(services: Services = Depends(get_services)) -> dict[str, Any]:
    return {"status": "ok", "engines": [{"id": e.id, "ready": e.ready()} for e in services.engines.all()]}
