"""Local Kokoro-82M engine: one shared model, one lazily created pipeline per language (American/British)."""

from __future__ import annotations

import logging
import os
import time
import warnings
from typing import Any

import numpy as np

from .alignment import EngineToken, TokenChunk, align_words, token_spans
from .base import EngineError, SynthContext, SynthResult, SynthSteps, UnknownVoice, Voice
from .kokoro_voices import DEFAULT_KOKORO_VOICE, KOKORO_VOICES
from .sentences import split_sentences

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000
REPO_ID = "hexgrad/Kokoro-82M"
MODEL_FILE = "kokoro-v1_0.pth"


def torch_threads() -> int:
    """Leave one core free on multi-core machines: torch's thread pool stalls badly when any other process
    (the browser, the web server) takes a core, so 4 threads on 4 busy cores is ~1.7x slower than 3."""
    configured = os.environ.get("AWDIO_TTS_THREADS", "").strip()
    if configured.isdigit() and int(configured) > 0:
        return int(configured)
    cores = os.cpu_count() or 1
    return cores - 1 if cores >= 4 else cores


def _cached_file(filename: str) -> str | None:
    """Path of a Hugging Face file already in the local cache (no network request), else None."""
    from huggingface_hub import try_to_load_from_cache

    path = try_to_load_from_cache(REPO_ID, filename)
    return path if isinstance(path, str) else None


def lang_code(voice_id: str) -> str:
    return "b" if voice_id.startswith("b") else "a"


class KokoroEngine:
    id = "kokoro"
    name = "Kokoro (on this device)"
    description = "Natural open-weights voices that run privately on this machine. Free."

    def __init__(self, default_voice: str = DEFAULT_KOKORO_VOICE) -> None:
        self._default_voice = default_voice
        self._voice_ids = {v.id for v in KOKORO_VOICES}
        self._model: Any = None
        self._pipelines: dict[str, Any] = {}  # only touched on the synthesis worker thread

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[Voice]:
        return list(KOKORO_VOICES)

    def warm(self) -> None:
        pipeline = self._pipeline(lang_code(self._default_voice))
        self._preload_voice(pipeline, self._default_voice)
        pipeline.load_voice(self._default_voice)

    def synthesize(self, text: str, voice_id: str, *, context: SynthContext) -> SynthSteps:
        """Synthesise sentence by sentence, yielding between sentences so the worker can pre-empt."""
        if voice_id not in self._voice_ids:
            raise UnknownVoice(voice_id)
        pipeline = self._pipeline(lang_code(voice_id))
        self._preload_voice(pipeline, voice_id)
        pieces: list[np.ndarray] = []
        chunks: list[TokenChunk] = []
        offset = 0.0
        sentences = split_sentences(text)
        for i, sentence in enumerate(sentences):
            try:
                for result in pipeline(sentence, voice=voice_id, speed=1.0):
                    if result.audio is None:
                        continue
                    audio = result.audio.detach().cpu().numpy().astype(np.float32).reshape(-1)
                    tokens = [
                        EngineToken(t.text, t.whitespace or "", t.start_ts, t.end_ts) for t in result.tokens or []
                    ]
                    chunks.append(TokenChunk(result.graphemes, tokens, offset))
                    pieces.append(audio)
                    offset += len(audio) / SAMPLE_RATE
            except Exception as exc:  # torch / G2P failures surface as many types
                log.exception("kokoro synthesis failed")
                raise EngineError("local synthesis failed") from exc
            if i + 1 < len(sentences):
                yield
        audio = np.concatenate(pieces) if pieces else np.zeros(int(0.2 * SAMPLE_RATE), dtype=np.float32)
        speech_end = len(audio) / SAMPLE_RATE
        timings = align_words(text, token_spans(text, chunks), speech_end)
        return SynthResult(audio, SAMPLE_RATE, timings)

    @staticmethod
    def _preload_voice(pipeline: Any, voice_id: str) -> None:
        """Load a cached voice file directly; kokoro itself asks the Hub first (fails offline). Uncached
        voices are left to kokoro, which downloads them."""
        if voice_id in pipeline.voices:
            return
        path = _cached_file(f"voices/{voice_id}.pt")
        if path is not None:
            import torch

            pipeline.voices[voice_id] = torch.load(path, weights_only=True)

    def _pipeline(self, lang: str) -> Any:
        pipeline = self._pipelines.get(lang)
        if pipeline is not None:
            return pipeline
        started = time.perf_counter()
        import torch
        from kokoro import KModel, KPipeline  # heavy import (torch): deferred until first use
        from loguru import logger as kokoro_logger

        kokoro_logger.disable("kokoro")  # its log lines can echo document text
        with warnings.catch_warnings():  # torch deprecation chatter from the model definition
            warnings.simplefilter("ignore")
            if self._model is None:
                torch.set_num_threads(torch_threads())
                # Cached weights load without contacting the Hub, so a warm cache works offline.
                config, weights = _cached_file("config.json"), _cached_file(MODEL_FILE)
                kwargs = {"config": config, "model": weights} if config and weights else {}
                model = KModel(repo_id=REPO_ID, **kwargs).to("cpu").eval()
            else:
                model = self._model
            pipeline = KPipeline(lang_code=lang, repo_id=REPO_ID, model=model)
        self._pipelines[lang] = pipeline
        self._model = model
        log.info(
            "kokoro pipeline '%s' loaded in %.1fs (%d threads)", lang, time.perf_counter() - started, torch.get_num_threads()
        )
        return pipeline
