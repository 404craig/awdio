"""The engine contract: text in, audio plus one [start, end] per whitespace-delimited word out."""

from __future__ import annotations

from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

from ..parsing.base import BlockKind

Gender = Literal["female", "male", "neutral"]


class EngineNotReady(Exception):
    """The engine cannot synthesise yet (e.g. the local model is still loading)."""


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
    audio: np.ndarray  # float32 mono PCM; empty when only `mp3` is available
    sample_rate: int
    word_timings: list[tuple[float, float]]  # one per word of the input text


SynthSteps = Generator[None, None, SynthResult]
"""A synthesis in progress: each `next()` does one unit of work (a sentence); StopIteration carries the result.

The worker checks between steps whether more urgent work is waiting and, if so, parks the generator."""


def as_steps(synthesize: Callable[[], SynthResult]) -> SynthSteps:
    """A synthesis that runs as one uninterruptible step (an engine that cannot pause between sentences)."""
    yield from ()
    return synthesize()


def run_steps(steps: SynthSteps) -> SynthResult:
    """Drive a synthesis to completion without pre-emption."""
    while True:
        try:
            next(steps)
        except StopIteration as done:
            return done.value


class Engine(Protocol):
    id: str
    name: str
    description: str

    def ready(self) -> bool: ...
    def warm(self) -> None:
        """Load whatever is slow to load. Always called on the synthesis worker thread."""

    def voices(self) -> list[Voice]: ...
    def synthesize(self, text: str, voice_id: str, *, context: SynthContext) -> SynthSteps: ...
