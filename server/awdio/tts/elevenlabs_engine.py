"""ElevenLabs cloud engine using the with-timestamps endpoint for character-level alignment."""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx
import numpy as np

from ..config import ffmpeg_available
from .alignment import align_words, char_spans
from .audio_io import MP3_DECODE_RATE, decode_mp3, mp3_duration_estimate
from .base import EngineError, EngineNotConfigured, Gender, SynthContext, SynthResult, SynthSteps, Voice, as_steps

log = logging.getLogger(__name__)

API_BASE = "https://api.elevenlabs.io/v1"
OUTPUT_FORMAT = "mp3_44100_128"
VOICES_TTL = 600.0
CONTEXT_CHARS = 400


@dataclass(frozen=True)
class Credentials:
    api_key: str | None
    model_id: str


class ElevenLabsEngine:
    id = "elevenlabs"
    name = "ElevenLabs (cloud)"
    description = "Most expressive voices, using your own API key. Text is sent to ElevenLabs."
    local = False

    def __init__(self, credentials: Callable[[], Credentials], client: httpx.Client | None = None) -> None:
        self._credentials = credentials
        self._client = client or httpx.Client(base_url=API_BASE, timeout=httpx.Timeout(60.0, connect=10.0))
        self._voices: tuple[str, float, list[Voice]] | None = None  # (key fingerprint, fetched at, voices)
        self._voices_lock = threading.Lock()

    def ready(self) -> bool:
        return self.configured()

    def configured(self) -> bool:
        return bool(self._credentials().api_key)

    def warm(self) -> None:
        return None

    def validate_key(self, api_key: str) -> bool:
        """True if ElevenLabs accepts the key; EngineError if ElevenLabs cannot be reached."""
        response = self._request("GET", "/voices", api_key)
        if response.status_code in (401, 403):
            return False
        _raise_for_status(response)
        return True

    def voices(self) -> list[Voice]:
        api_key = self._credentials().api_key
        if not api_key:
            return []
        fingerprint = hashlib.sha256(api_key.encode()).hexdigest()
        with self._voices_lock:
            cached = self._voices
            if cached and cached[0] == fingerprint and time.monotonic() - cached[1] < VOICES_TTL:
                return cached[2]
            response = self._request("GET", "/voices", api_key)
            _raise_for_status(response)
            voices = [_voice(v) for v in response.json().get("voices", [])]
            self._voices = (fingerprint, time.monotonic(), voices)
            return voices

    def synthesize(self, text: str, voice_id: str, *, context: SynthContext) -> SynthSteps:
        # One request per block: ElevenLabs gets the whole paragraph (plus neighbours) for natural prosody.
        return as_steps(lambda: self._synthesize(text, voice_id, context))

    def _synthesize(self, text: str, voice_id: str, context: SynthContext) -> SynthResult:
        creds = self._credentials()
        if not creds.api_key:
            raise EngineNotConfigured("add an ElevenLabs API key in Settings")
        body: dict[str, str] = {"text": text, "model_id": creds.model_id}
        if context.previous_text:
            body["previous_text"] = context.previous_text[-CONTEXT_CHARS:]
        if context.next_text:
            body["next_text"] = context.next_text[:CONTEXT_CHARS]
        response = self._request(
            "POST",
            f"/text-to-speech/{voice_id}/with-timestamps",
            creds.api_key,
            json=body,
            params={"output_format": OUTPUT_FORMAT},
        )
        _raise_for_status(response)
        try:
            payload = response.json()
            mp3 = base64.b64decode(payload["audio_base64"])
            alignment = payload.get("alignment") or {}
        except (ValueError, KeyError, binascii.Error) as exc:
            raise EngineError("ElevenLabs returned an unexpected response") from exc

        spans = char_spans(
            text,
            alignment.get("characters", []),
            alignment.get("character_start_times_seconds", []),
            alignment.get("character_end_times_seconds", []),
        )
        if ffmpeg_available():
            audio = decode_mp3(mp3)
            speech_end = len(audio) / MP3_DECODE_RATE
            return SynthResult(audio, MP3_DECODE_RATE, align_words(text, spans, speech_end))
        speech_end = max(mp3_duration_estimate(mp3), max((s.t1 for s in spans), default=0.0))
        return SynthResult(
            np.zeros(0, dtype=np.float32), MP3_DECODE_RATE, align_words(text, spans, speech_end), mp3=mp3
        )

    def _request(self, method: str, path: str, api_key: str, **kwargs: object) -> httpx.Response:
        try:
            return self._client.request(method, path, headers={"xi-api-key": api_key}, **kwargs)  # type: ignore[arg-type]
        except httpx.HTTPError as exc:
            raise EngineError(f"could not reach ElevenLabs ({type(exc).__name__})") from exc


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    message = ""
    try:
        detail = response.json().get("detail")
        message = detail.get("message", "") if isinstance(detail, dict) else str(detail or "")
    except ValueError:
        pass
    log.warning("elevenlabs request failed with HTTP %d", response.status_code)
    raise EngineError(f"ElevenLabs error {response.status_code}" + (f": {message[:160]}" if message else ""))


def _voice(data: dict) -> Voice:
    labels = data.get("labels") or {}
    gender_label = str(labels.get("gender", "")).lower()
    gender: Gender = "female" if gender_label == "female" else "male" if gender_label == "male" else "neutral"
    accent = str(labels.get("accent") or "Unknown").strip()
    return Voice(
        id=data["voice_id"],
        engine="elevenlabs",
        name=data.get("name") or data["voice_id"],
        accent=accent[:1].upper() + accent[1:] if accent else "Unknown",
        gender=gender,
    )
