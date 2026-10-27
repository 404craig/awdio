"""Voice catalogue per engine and cached voice previews."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from ..services import Services, get_services
from ..tts.base import Engine, EngineError
from .audio import LONG_CACHE, MEDIA_TYPES, resolve_voice
from .engine_errors import engine_errors

log = logging.getLogger(__name__)
router = APIRouter()


def _engine_info(engine: Engine) -> dict[str, Any]:
    try:
        voices = [v.to_json() for v in engine.voices()]
    except EngineError as exc:
        log.warning("could not list %s voices: %s", engine.id, exc)
        voices = []
    return {
        "id": engine.id,
        "name": engine.name,
        "ready": engine.ready(),
        "configured": engine.configured(),
        "description": engine.description,
        "voices": voices,
    }


@router.get("/api/voices")
async def list_voices(services: Services = Depends(get_services)) -> dict[str, Any]:
    engines = [await run_in_threadpool(_engine_info, e) for e in services.engines.all()]
    return {"engines": engines}


@router.get("/api/voices/{engine}/{voice_id}/preview")
async def preview(engine: str, voice_id: str, services: Services = Depends(get_services)) -> FileResponse:
    engine_id, voice = await resolve_voice(services, engine, voice_id)
    with engine_errors():
        entry = await asyncio.wrap_future(services.synth.preview(engine_id, voice))
    return FileResponse(
        services.cache.file_path(entry.key, entry.format),
        media_type=MEDIA_TYPES[entry.format],
        headers={"Cache-Control": LONG_CACHE},
    )
