"""User settings (single user) persisted in the settings table, plus server secrets."""

from __future__ import annotations

import secrets
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .db import Database
from .tts.elevenlabs_engine import Credentials

DEFAULTS: dict[str, Any] = {
    "engine": "kokoro",
    "voiceId": "af_heart",
    "speed": 1.0,
    "font": "serif",
    "textSize": 19,
    "theme": "system",
    "autoScroll": True,
    "elevenLabsModelId": "eleven_multilingual_v2",
}
_API_KEY = "elevenlabs_api_key"
_SESSION_SECRET = "session_secret"


class SettingsUpdate(BaseModel):
    """Body of PUT /api/settings: any subset of the writable fields."""

    model_config = ConfigDict(extra="forbid")

    engine: Literal["kokoro", "elevenlabs"] | None = None
    voiceId: str | None = Field(default=None, min_length=1, max_length=128)
    speed: float | None = Field(default=None, ge=0.5, le=3.0)
    font: Literal["serif", "sans"] | None = None
    textSize: int | None = Field(default=None, ge=15, le=26)
    theme: Literal["system", "light", "dark", "sepia"] | None = None
    autoScroll: bool | None = None
    elevenLabsModelId: str | None = Field(default=None, min_length=1, max_length=128)
    elevenLabsApiKey: str | None = Field(default=None, max_length=256)

    @field_validator("speed")
    @classmethod
    def _snap_speed(cls, value: float | None) -> float | None:
        return None if value is None else round(value * 4) / 4


class SettingsStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get(self) -> dict[str, Any]:
        stored = self._db.get_settings()
        values = {k: stored.get(k, default) for k, default in DEFAULTS.items()}
        values["elevenLabsConfigured"] = bool(stored.get(_API_KEY))
        return values

    def update(self, values: dict[str, Any]) -> None:
        self._db.set_settings({k: v for k, v in values.items() if k in DEFAULTS})

    def api_key(self) -> str | None:
        return self._db.get_setting(_API_KEY) or None

    def set_api_key(self, key: str | None) -> None:
        self._db.set_settings({_API_KEY: key or None})

    def elevenlabs_credentials(self) -> Credentials:
        return Credentials(self.api_key(), self.get()["elevenLabsModelId"])

    def session_secret(self) -> str:
        secret = self._db.get_setting(_SESSION_SECRET)
        if not secret:
            secret = secrets.token_hex(32)
            self._db.set_settings({_SESSION_SECRET: secret})
        return secret
