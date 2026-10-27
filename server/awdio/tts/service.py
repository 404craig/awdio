"""Block and preview synthesis: cache lookups, queueing on the worker, padding and statistics."""

from __future__ import annotations

import logging
import time
from concurrent.futures import Future
from typing import Protocol

from ..parsing.base import Block
from .base import Engine, EngineNotReady, SynthContext, UnknownVoice
from .cache import (
    PAD_AFTER_HEADING,
    PAD_AFTER_OTHER,
    AudioCache,
    CachedAudio,
    CacheOwner,
    block_cache_key,
    preview_cache_key,
)
from .registry import EngineRegistry
from .worker import Priority, SynthWorker

log = logging.getLogger(__name__)

PREVIEW_TEXT = "Hello! This is how I sound when I read your documents aloud."


class BlockSource(Protocol):
    """The parts of a document synthesis needs."""

    @property
    def id(self) -> str: ...
    @property
    def blocks(self) -> list[Block]: ...


class SynthesisService:
    def __init__(self, registry: EngineRegistry, cache: AudioCache, worker: SynthWorker) -> None:
        self.registry = registry
        self.cache = cache
        self.worker = worker

    def warm(self, engine: Engine) -> None:
        """Queue the engine's warm-up (idempotent while one is queued or running)."""

        def run() -> None:
            started = time.perf_counter()
            try:
                engine.warm()
            except Exception:
                log.exception("warming engine %s failed", engine.id)
                return
            log.info("engine %s warm in %.1fs", engine.id, time.perf_counter() - started)

        self.worker.submit(f"warm:{engine.id}", run, Priority.WARM)

    def check_voice(self, engine: Engine, voice_id: str) -> None:
        """Raise UnknownVoice for voices the engine does not offer (may raise EngineError for cloud engines)."""
        if voice_id not in {v.id for v in engine.voices()}:
            raise UnknownVoice(voice_id)

    def block_audio(
        self, doc: BlockSource, block_index: int, engine_id: str, voice_id: str, priority: Priority
    ) -> Future[CachedAudio]:
        """Cached audio for a block, or a future for its synthesis. Raises EngineNotReady/UnknownEngine."""
        engine = self.registry.get(engine_id)
        blocks = doc.blocks
        block = blocks[block_index]
        key = block_cache_key(engine_id, voice_id, doc.id, block_index, block.text)
        hit = self.cache.lookup(key)
        if hit is not None:
            done: Future[CachedAudio] = Future()
            done.set_result(hit)
            return done
        if not engine.ready():
            self.warm(engine)
            raise EngineNotReady(engine_id)
        context = SynthContext(
            kind=block.kind,
            previous_text=blocks[block_index - 1].text if block_index > 0 else None,
            next_text=blocks[block_index + 1].text if block_index + 1 < len(blocks) else None,
        )
        pad = PAD_AFTER_HEADING if block.kind in ("title", "heading") else PAD_AFTER_OTHER
        owner = CacheOwner(engine_id, voice_id, doc.id, block_index)

        def run() -> CachedAudio:
            cached = self.cache.lookup(key)
            if cached is not None:
                return cached
            started = time.perf_counter()
            result = engine.synthesize(block.text, voice_id, context=context)
            entry = self.cache.store(key, result, pad_seconds=pad, owner=owner)
            elapsed = time.perf_counter() - started
            log.info(
                "synthesised block %d (%d words) with %s/%s: %.2fs audio in %.2fs (RTF %.2f)",
                block_index,
                block.word_count,
                engine_id,
                voice_id,
                entry.duration_sec,
                elapsed,
                elapsed / entry.duration_sec if entry.duration_sec else 0.0,
            )
            return entry

        return self.worker.submit(key, run, priority)

    def preview(self, engine_id: str, voice_id: str) -> Future[CachedAudio]:
        engine = self.registry.get(engine_id)
        key = preview_cache_key(engine_id, voice_id, PREVIEW_TEXT)
        hit = self.cache.lookup(key)
        if hit is not None:
            done: Future[CachedAudio] = Future()
            done.set_result(hit)
            return done
        if not engine.ready():
            self.warm(engine)
            raise EngineNotReady(engine_id)

        def run() -> CachedAudio:
            result = engine.synthesize(PREVIEW_TEXT, voice_id, context=SynthContext(kind="paragraph"))
            return self.cache.store(key, result, pad_seconds=0.0, owner=CacheOwner(engine_id, voice_id))

        return self.worker.submit(key, run, Priority.ON_DEMAND)
