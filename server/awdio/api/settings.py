"""GET/PUT /api/settings."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from ..errors import ApiError
from ..services import Services, get_services
from ..settings import SettingsUpdate
from .engine_errors import engine_errors

router = APIRouter()


@router.get("/api/settings")
def get_settings(services: Services = Depends(get_services)) -> dict[str, Any]:
    return services.settings.get()


@router.put("/api/settings")
async def put_settings(body: SettingsUpdate, services: Services = Depends(get_services)) -> dict[str, Any]:
    update = body.model_dump(exclude_none=True)
    current = services.settings.get()
    if "engine" in update or "voiceId" in update:
        engine_id = update.get("engine", current["engine"])
        with engine_errors():
            engine = services.engines.get(engine_id)
            if "voiceId" not in update and engine_id != current["engine"]:
                update["voiceId"] = await _default_voice(services, engine_id)
            if "voiceId" in update:
                await run_in_threadpool(services.synth.check_voice, engine, update["voiceId"])
    services.settings.update(update)
    return services.settings.get()


async def _default_voice(services: Services, engine_id: str) -> str:
    voices = await run_in_threadpool(services.engines.get(engine_id).voices)
    if not voices:
        raise ApiError(400, "unknown_voice", "no voices are available for this engine")
    return voices[0].id
