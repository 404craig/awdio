"""Background "Prepare audio" jobs: synthesise every block of a document at the lowest priority."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Literal

from ..db import Database
from .base import EngineNotReady
from .cache import CachedAudio
from .service import BlockSource, SynthesisService
from .worker import Priority

log = logging.getLogger(__name__)

READY_POLL_SECONDS = 1.0
READY_TIMEOUT_SECONDS = 600.0

Status = Literal["idle", "running", "done", "error"]


@dataclass
class PrepareStatus:
    status: Status
    done: int
    total: int
    engine: str | None = None
    voice_id: str | None = None
    error: str | None = None

    def to_json(self) -> dict[str, object]:
        data: dict[str, object] = {"status": self.status, "done": self.done, "total": self.total}
        if self.engine:
            data["engine"] = self.engine
        if self.voice_id:
            data["voiceId"] = self.voice_id
        if self.error:
            data["error"] = self.error
        return data


@dataclass
class _Job:
    doc_id: str
    engine: str
    voice_id: str
    total: int
    done: int = 0
    status: Status = "running"
    error: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def snapshot(self) -> PrepareStatus:
        return PrepareStatus(self.status, self.done, self.total, self.engine, self.voice_id, self.error)


class PrepareManager:
    def __init__(self, synth: SynthesisService, db: Database, load: Callable[[str], BlockSource]) -> None:
        self._synth = synth
        self._db = db
        self._load = load
        self._jobs: dict[str, _Job] = {}  # latest job per document
        self._lock = threading.Lock()

    def start(self, doc_id: str, engine: str, voice_id: str) -> PrepareStatus:
        with self._lock:
            current = self._jobs.get(doc_id)
            if current is not None and current.status == "running":
                if (current.engine, current.voice_id) == (engine, voice_id):
                    return current.snapshot()
                current.cancel.set()
            doc = self._load(doc_id)
            job = _Job(doc_id, engine, voice_id, total=len(doc.blocks))
            self._jobs[doc_id] = job
        threading.Thread(target=self._run, args=(job, doc), name=f"awdio-prepare-{doc_id[:8]}", daemon=True).start()
        return job.snapshot()

    def status(self, doc_id: str, engine: str, voice_id: str, total: int) -> PrepareStatus:
        with self._lock:
            job = self._jobs.get(doc_id)
            if (
                job is not None
                and (job.engine, job.voice_id) == (engine, voice_id)
                and job.status in ("running", "error")
            ):
                return job.snapshot()
        done = min(self._db.cached_block_count(doc_id, engine, voice_id), total)
        return PrepareStatus("done" if done >= total else "idle", done, total, engine, voice_id)

    def summary_status(self, doc_id: str, engine: str, voice_id: str, total: int) -> PrepareStatus:
        """For library cards: the running job whatever its voice, else the status for the given voice."""
        with self._lock:
            job = self._jobs.get(doc_id)
            if job is not None and job.status == "running":
                return job.snapshot()
        return self.status(doc_id, engine, voice_id, total)

    def cancel(self, doc_id: str) -> None:
        with self._lock:
            job = self._jobs.pop(doc_id, None)
        if job is not None:
            job.cancel.set()

    def shutdown(self) -> None:
        with self._lock:
            jobs, self._jobs = list(self._jobs.values()), {}
        for job in jobs:
            job.cancel.set()

    def _run(self, job: _Job, doc: BlockSource) -> None:
        started = time.perf_counter()
        try:
            for block in doc.blocks:
                if job.cancel.is_set():
                    job.status = "idle"
                    return
                future = self._submit(job, doc, block.index)
                if future is None:
                    job.status = "idle"
                    return
                future.result()
                job.done += 1
            job.status = "done"
            log.info(
                "prepared %d blocks with %s/%s in %.1fs",
                job.total,
                job.engine,
                job.voice_id,
                time.perf_counter() - started,
            )
        except Exception as exc:
            log.warning("prepare job failed: %s", type(exc).__name__)
            job.status, job.error = "error", str(exc) or type(exc).__name__

    def _submit(self, job: _Job, doc: BlockSource, index: int) -> Future[CachedAudio] | None:
        """Queue one block, waiting while the engine is still loading. None if the job was cancelled meanwhile."""
        deadline = time.monotonic() + READY_TIMEOUT_SECONDS
        while True:
            try:
                return self._synth.block_audio(doc, index, job.engine, job.voice_id, Priority.PREPARE)
            except EngineNotReady:
                if time.monotonic() > deadline:
                    raise
                if job.cancel.wait(READY_POLL_SECONDS):
                    return None
