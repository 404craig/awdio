"""Block audio (JSON with timings), cached audio files, and the prepare job."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import APIRouter, Depends, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from ..errors import ApiError
from ..services import Services, get_services
from ..tts.base import EngineNotConfigured
from ..tts.kokoro_voices import DEFAULT_KOKORO_VOICE
from ..tts.worker import Priority
from .documents import document_row
from .engine_errors import engine_errors

router = APIRouter()

MEDIA_TYPES = {"wav": "audio/wav", "mp3": "audio/mpeg"}
_CACHE_KEY = re.compile(r"[0-9a-f]{24}")
LONG_CACHE = "public, max-age=31536000, immutable"
DEFAULT_VOICES = {"kokoro": DEFAULT_KOKORO_VOICE}


async def resolve_voice(services: Services, engine: str | None, voice: str | None) -> tuple[str, str]:
    """Engine/voice from the query, defaulting to the saved settings; validated against the engine."""
    settings = services.settings.get()
    engine_id = engine or settings["engine"]
    voice_id = voice or (settings["voiceId"] if engine_id == settings["engine"] else DEFAULT_VOICES.get(engine_id, ""))
    with engine_errors():
        instance = services.engines.get(engine_id)
        if not instance.configured():
            raise EngineNotConfigured(f"{instance.name} is not configured")
        if not voice_id:
            raise ApiError(400, "unknown_voice", "choose a voice for this engine")
        await run_in_threadpool(services.synth.check_voice, instance, voice_id)
    return engine_id, voice_id


@router.get("/api/documents/{doc_id}/blocks/{block_index}/audio")
async def block_audio(
    doc_id: str,
    block_index: int,
    engine: str | None = None,
    voice: str | None = None,
    prefetch: bool = False,
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    row = document_row(services, doc_id)
    if not 0 <= block_index < row.block_count:
        raise ApiError(404, "block_not_found", f"block index must be 0..{row.block_count - 1}")
    engine_id, voice_id = await resolve_voice(services, engine, voice)
    doc = await run_in_threadpool(services.library.load, doc_id)
    with engine_errors():
        future = services.synth.block_audio(
            doc, block_index, engine_id, voice_id, Priority.PREFETCH if prefetch else Priority.ON_DEMAND
        )
        entry = await asyncio.wrap_future(future)
    return {
        "blockIndex": block_index,
        "engine": engine_id,
        "voiceId": voice_id,
        "url": entry.url,
        "durationSec": entry.duration_sec,
        "timings": entry.timings,
        "format": entry.format,
    }


@router.get("/api/audio/{key}.{ext}")
def audio_file(key: str, ext: str, services: Services = Depends(get_services)) -> FileResponse:
    if not _CACHE_KEY.fullmatch(key) or ext not in MEDIA_TYPES:
        raise ApiError(404, "not_found", "no such audio file")
    path = services.cache.file_path(key, ext)
    if not path.is_file():
        raise ApiError(404, "not_found", "no such audio file")
    return FileResponse(path, media_type=MEDIA_TYPES[ext], headers={"Cache-Control": LONG_CACHE})


@router.post("/api/documents/{doc_id}/prepare", status_code=202)
async def start_prepare(
    doc_id: str, engine: str | None = None, voice: str | None = None, services: Services = Depends(get_services)
) -> dict[str, Any]:
    document_row(services, doc_id)
    engine_id, voice_id = await resolve_voice(services, engine, voice)
    status = await run_in_threadpool(services.prepare.start, doc_id, engine_id, voice_id)
    return status.to_json()


@router.get("/api/documents/{doc_id}/prepare")
async def prepare_status(
    doc_id: str, engine: str | None = None, voice: str | None = None, services: Services = Depends(get_services)
) -> dict[str, Any]:
    row = document_row(services, doc_id)
    engine_id, voice_id = await resolve_voice(services, engine, voice)
    return services.prepare.status(doc_id, engine_id, voice_id, row.block_count).to_json()


@router.delete("/api/documents/{doc_id}/prepare", status_code=204)
def cancel_prepare(doc_id: str, services: Services = Depends(get_services)) -> Response:
    document_row(services, doc_id)
    services.prepare.cancel(doc_id)
    return Response(status_code=204)
