"""On-disk audio cache: `<key>.<ext>` plus a `<key>.json` sidecar with duration and word timings."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..config import AudioFormat, ffmpeg_available
from ..db import Database
from .audio_io import pad_silence, write_mp3, write_wav
from .base import SynthResult

log = logging.getLogger(__name__)

PAD_AFTER_HEADING = 0.5
PAD_AFTER_OTHER = 0.15


def block_cache_key(engine: str, voice: str, doc_id: str, block_index: int, text: str) -> str:
    return hashlib.sha1(f"{engine}|{voice}|{doc_id}|{block_index}|{text}".encode()).hexdigest()[:24]


def preview_cache_key(engine: str, voice: str, text: str) -> str:
    return hashlib.sha1(f"{engine}|{voice}|preview|{text}".encode()).hexdigest()[:24]


@dataclass(frozen=True)
class CachedAudio:
    key: str
    format: str
    duration_sec: float
    timings: list[tuple[float, float]]

    @property
    def url(self) -> str:
        return f"/api/audio/{self.key}.{self.format}"


@dataclass(frozen=True)
class CacheOwner:
    """What a cache entry belongs to; `doc_id`/`block_index` are None for voice previews."""

    engine: str
    voice: str
    doc_id: str | None = None
    block_index: int | None = None


class DocumentGone(Exception):
    """The document was deleted while its audio was being synthesised."""


class AudioCache:
    def __init__(self, directory: Path, db: Database, audio_format: AudioFormat) -> None:
        self._dir = directory
        self._db = db
        if audio_format == "mp3" and not ffmpeg_available():
            log.warning("AWDIO_AUDIO_FORMAT=mp3 but ffmpeg is not on PATH; caching WAV instead")
            audio_format = "wav"
        self._format = audio_format

    def file_path(self, key: str, ext: str) -> Path:
        return self._dir / f"{key}.{ext}"

    def lookup(self, key: str) -> CachedAudio | None:
        try:
            meta = json.loads((self._dir / f"{key}.json").read_text())
            entry = CachedAudio(key, meta["format"], meta["durationSec"], [tuple(t) for t in meta["timings"]])
        except (FileNotFoundError, ValueError, KeyError, TypeError):
            return None
        return entry if self.file_path(key, entry.format).exists() else None

    def store(self, key: str, result: SynthResult, *, pad_seconds: float, owner: CacheOwner) -> CachedAudio:
        audio = pad_silence(result.audio, result.sample_rate, pad_seconds)
        duration = len(audio) / result.sample_rate
        fmt = self._format
        writer = write_mp3 if fmt == "mp3" else write_wav
        self._write_atomic(key, fmt, lambda p: writer(p, audio, result.sample_rate))

        timings = [(round(min(s, duration), 3), round(min(e, duration), 3)) for s, e in result.word_timings]
        entry = CachedAudio(key, fmt, round(duration, 3), timings)
        try:
            self._db.add_audio(key, owner.doc_id, owner.engine, owner.voice, owner.block_index, fmt)
        except sqlite3.IntegrityError:
            self.remove([(key, fmt)])
            raise DocumentGone(owner.doc_id) from None
        meta = {"format": fmt, "durationSec": entry.duration_sec, "timings": entry.timings}
        self._write_atomic(key, "json", lambda p: p.write_text(json.dumps(meta)))
        if owner.doc_id is not None:
            self._db.add_synth_stats(owner.engine, owner.voice, duration, len(timings))
        return entry

    def remove(self, entries: list[tuple[str, str]]) -> None:
        for key, ext in entries:
            for path in (self.file_path(key, ext), self._dir / f"{key}.json"):
                path.unlink(missing_ok=True)

    def _write_atomic(self, key: str, ext: str, write: Callable[[Path], object]) -> None:
        final = self.file_path(key, ext)
        tmp = final.with_name(f".{final.name}.tmp")
        write(tmp)
        os.replace(tmp, final)
