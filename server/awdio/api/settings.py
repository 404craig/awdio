"""GET/PUT /api/settings, including ElevenLabs key storage and validation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from ..errors import ApiError
from ..services import Services, get_services
from ..settings import SettingsUpdate
from ..tts.elevenlabs_engine import ElevenLabsEngine
from ..tts.kokoro_voices import DEFAULT_KOKORO_VOICE
from .engine_errors import engine_errors

router = APIRouter()


@router.get("/api/settings")
def get_settings(services: Services = Depends(get_services)) -> dict[str, Any]:
    return services.settings.get()


@router.put("/api/settings")
async def put_settings(body: SettingsUpdate, services: Services = Depends(get_services)) -> dict[str, Any]:
    update = body.model_dump(exclude_none=True)
    api_key = update.pop("elevenLabsApiKey", None)
    if api_key is not None:
        await _store_api_key(services, api_key.strip())

    current = services.settings.get()
    if current["engine"] == "elevenlabs" and not current["elevenLabsConfigured"] and "engine" not in update:
        update["engine"] = "kokoro"  # the key was just cleared: fall back to the local engine
    if "engine" in update or "voiceId" in update:
        engine_id = update.get("engine", current["engine"])
        with engine_errors():
            engine = services.engines.get(engine_id)
            if not engine.configured():
                raise ApiError(400, "engine_not_configured", f"{engine.name} needs an API key first")
            if "voiceId" not in update and engine_id != current["engine"]:
                update["voiceId"] = await _default_voice(services, engine_id)
            if "voiceId" in update:
                await run_in_threadpool(services.synth.check_voice, engine, update["voiceId"])
    services.settings.update(update)
    return services.settings.get()


async def _store_api_key(services: Services, api_key: str) -> None:
    if not api_key:
        services.settings.set_api_key(None)
        return
    with engine_errors():
        engine = services.engines.get("elevenlabs")
        if not isinstance(engine, ElevenLabsEngine):
            raise ApiError(400, "unknown_engine", "the ElevenLabs engine is not available")
        if not await run_in_threadpool(engine.validate_key, api_key):
            raise ApiError(400, "invalid_api_key", "ElevenLabs rejected that API key")
    services.settings.set_api_key(api_key)


async def _default_voice(services: Services, engine_id: str) -> str:
    if engine_id == "kokoro":
        return DEFAULT_KOKORO_VOICE
    voices = await run_in_threadpool(services.engines.get(engine_id).voices)
    if not voices:
        raise ApiError(400, "unknown_voice", "no voices are available for this engine")
    return voices[0].id
