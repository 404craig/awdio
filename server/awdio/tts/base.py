"""The engine contract: text in, audio plus one [start, end] per whitespace-delimited word out."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

from ..parsing.base import BlockKind

Gender = Literal["female", "male", "neutral"]


class EngineNotReady(Exception):
    """The engine cannot synthesise yet (e.g. the local model is still loading)."""


class EngineNotConfigured(Exception):
    """The engine needs configuration first (e.g. an API key)."""


class EngineError(Exception):
    """The engine failed; the message is short and safe to show (no text, no keys)."""


class UnknownVoice(Exception):
    pass


@dataclass(frozen=True)
class Voice:
    id: str
    engine: str
    name: str
    accent: str
    gender: Gender
    quality: str | None = None

    def to_json(self) -> dict[str, str]:
        data = {"id": self.id, "engine": self.engine, "name": self.name, "accent": self.accent, "gender": self.gender}
        if self.quality:
            data["quality"] = self.quality
        return data


@dataclass(frozen=True)
class SynthContext:
    kind: BlockKind
    previous_text: str | None = None
    next_text: str | None = None


@dataclass
class SynthResult:
    audio: np.ndarray                         # float32 mono PCM; empty when only `mp3` is available
    sample_rate: int
    word_timings: list[tuple[float, float]]   # one per word of the input text
    mp3: bytes | None = None                  # already-encoded audio to store untouched (no ffmpeg to decode it)


class Engine(Protocol):
    id: str
    name: str
    description: str

    def ready(self) -> bool: ...
    def configured(self) -> bool: ...
    def warm(self) -> None:
        """Load whatever is slow to load. Always called on the synthesis worker thread."""
    def voices(self) -> list[Voice]: ...
    def synthesize(self, text: str, voice_id: str, *, context: SynthContext) -> SynthResult: ...
