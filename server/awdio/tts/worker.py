"""The single synthesis worker thread: a priority queue of de-duplicated jobs."""

from __future__ import annotations

import itertools
import logging
import queue
import threading
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

log = logging.getLogger(__name__)


class Priority(IntEnum):
    WARM = 0
    ON_DEMAND = 1
    PREFETCH = 2
    PREPARE = 3


@dataclass
class _Job:
    key: str
    fn: Callable[[], Any]
    priority: Priority
    future: Future[Any] = field(default_factory=Future)
    started: bool = False


class SynthWorker:
    """Runs jobs one at a time (the local model is CPU-bound and not thread-safe), lowest priority value first.

    Submitting a key that is already queued or running returns the same future; a more urgent request
    re-queues the pending job at the higher priority.
    """

    def __init__(self) -> None:
        self._queue: queue.PriorityQueue[tuple[int, int, _Job | None]] = queue.PriorityQueue()
        self._seq = itertools.count()
        self._jobs: dict[str, _Job] = {}
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, name="awdio-synth", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._queue.put((-1, next(self._seq), None))
        self._thread.join(timeout=5)

    def submit(self, key: str, fn: Callable[[], Any], priority: Priority) -> Future[Any]:
        with self._lock:
            job = self._jobs.get(key)
            if job is None:
                job = _Job(key, fn, priority)
                self._jobs[key] = job
                self._queue.put((priority, next(self._seq), job))
            elif priority < job.priority and not job.started:
                job.priority = priority
                self._queue.put((priority, next(self._seq), job))
            return job.future

    def _run(self) -> None:
        while True:
            _, _, job = self._queue.get()
            if job is None:
                return
            with self._lock:
                if job.started:
                    continue  # a stale entry for a job that was re-queued at a higher priority
                job.started = True
            try:
                job.future.set_result(job.fn())
            except BaseException as exc:  # delivered to whoever awaits the future
                job.future.set_exception(exc)
            finally:
                with self._lock:
                    self._jobs.pop(job.key, None)
