"""Translate engine exceptions into API errors."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from ..errors import ApiError
from ..tts.base import EngineError, EngineNotReady, UnknownVoice
from ..tts.cache import DocumentGone
from ..tts.registry import UnknownEngine


@contextmanager
def engine_errors() -> Iterator[None]:
    try:
        yield
    except UnknownEngine as exc:
        raise ApiError(400, "unknown_engine", f"unknown engine '{exc}'") from exc
    except UnknownVoice as exc:
        raise ApiError(400, "unknown_voice", f"unknown voice '{exc}'") from exc
    except EngineNotReady as exc:
        raise ApiError(503, "engine_not_ready", "the voice model is still loading; try again shortly") from exc
    except EngineError as exc:
        raise ApiError(502, "engine_error", str(exc)) from exc
    except DocumentGone as exc:
        raise ApiError(404, "not_found", "the document was deleted") from exc
