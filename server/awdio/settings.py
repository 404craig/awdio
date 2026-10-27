"""User settings (single user) persisted in the settings table, plus server secrets."""

from __future__ import annotations

import secrets
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .db import Database

DEFAULTS: dict[str, Any] = {
    "engine": "kokoro",
    "voiceId": "af_heart",
    "speed": 1.0,
    "font": "serif",
    "textSize": 19,
    "theme": "system",
    "autoScroll": True,
}
_REMOVED_KEYS = ("elevenlabs_api_key", "elevenLabsModelId")  # from installs that still had the cloud engine
_SESSION_SECRET = "session_secret"


class SettingsUpdate(BaseModel):
    """Body of PUT /api/settings: any subset of the writable fields."""

    model_config = ConfigDict(extra="forbid")

    engine: str | None = Field(default=None, min_length=1, max_length=32)
    voiceId: str | None = Field(default=None, min_length=1, max_length=128)
    speed: float | None = Field(default=None, ge=0.5, le=3.0)
    font: Literal["serif", "sans"] | None = None
    textSize: int | None = Field(default=None, ge=15, le=26)
    theme: Literal["system", "light", "dark", "sepia"] | None = None
    autoScroll: bool | None = None

    @field_validator("speed")
    @classmethod
    def _snap_speed(cls, value: float | None) -> float | None:
        return None if value is None else round(value * 4) / 4


class SettingsStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get(self) -> dict[str, Any]:
        stored = self._db.get_settings()
        return {k: stored.get(k, default) for k, default in DEFAULTS.items()}

    def update(self, values: dict[str, Any]) -> None:
        self._db.set_settings({k: v for k, v in values.items() if k in DEFAULTS})

    def forget_unknown_engine(self, engine_ids: set[str]) -> None:
        """Drop settings left by engines that no longer exist (the saved voice falls back to the default)."""
        self._db.set_settings(dict.fromkeys(_REMOVED_KEYS))
        if self.get()["engine"] not in engine_ids:
            self._db.set_settings({"engine": None, "voiceId": None})

    def session_secret(self) -> str:
        secret = self._db.get_setting(_SESSION_SECRET)
        if not secret:
            secret = secrets.token_hex(32)
            self._db.set_settings({_SESSION_SECRET: secret})
        return secret
