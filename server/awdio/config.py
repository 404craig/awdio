"""Runtime configuration read from environment variables."""

from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

AudioFormat = Literal["wav", "mp3"]

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Config:
    data_dir: Path
    access_pin: str | None = None
    audio_format: AudioFormat = "wav"
    elevenlabs_api_key_seed: str | None = None
    web_dist: Path = _REPO_ROOT / "web" / "dist"
    host: str = "127.0.0.1"
    port: int = 8000
    warm_engines: bool = True
    auto_prepare: bool = True
    dev_cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    @classmethod
    def from_env(cls) -> Config:
        pin = os.environ.get("AWDIO_ACCESS_PIN", "").strip() or None
        if pin is not None and not re.fullmatch(r"\d{4,8}", pin):
            raise ValueError("AWDIO_ACCESS_PIN must be 4-8 digits")
        fmt = os.environ.get("AWDIO_AUDIO_FORMAT", "wav").strip().lower()
        if fmt not in ("wav", "mp3"):
            raise ValueError("AWDIO_AUDIO_FORMAT must be 'wav' or 'mp3'")
        web_dist = os.environ.get("AWDIO_WEB_DIST")
        return cls(
            data_dir=Path(os.environ.get("AWDIO_DATA_DIR", "./data")).resolve(),
            access_pin=pin,
            audio_format=fmt,  # type: ignore[arg-type]
            elevenlabs_api_key_seed=os.environ.get("ELEVENLABS_API_KEY", "").strip() or None,
            web_dist=Path(web_dist).resolve() if web_dist else cls.web_dist,
            host=os.environ.get("AWDIO_HOST", "127.0.0.1"),
            port=int(os.environ.get("AWDIO_PORT", "8000")),
            auto_prepare=os.environ.get("AWDIO_AUTO_PREPARE", "1").strip().lower() not in ("0", "false", "no", "off"),
        )

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def docs_dir(self) -> Path:
        return self.data_dir / "docs"

    @property
    def audio_dir(self) -> Path:
        return self.data_dir / "audio"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "awdio.sqlite"

    def ensure_dirs(self) -> None:
        for d in (self.uploads_dir, self.docs_dir, self.audio_dir):
            d.mkdir(parents=True, exist_ok=True)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None
