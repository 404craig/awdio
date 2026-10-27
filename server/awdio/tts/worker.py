"""The single synthesis worker thread: de-duplicated jobs by priority, with pre-emption between steps.

A job is a callable. If it returns a generator, the generator is a resumable job: every `next()` does one
unit of work (a sentence) and, between units, the worker checks whether a more urgent job is waiting. If so
the current job is parked (its generator keeps the audio synthesised so far) and re-queued, the urgent job
runs, and the parked one resumes later where it stopped. A seek therefore waits for at most one sentence of
someone else's work before its own block starts.
"""

from __future__ import annotations

import heapq
import inspect
import itertools
import logging
import threading
from collections.abc import Callable, Generator
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
    steps: Generator[Any, Any, Any] | None = None
    order: int = 0  # submission order: a parked job resumes ahead of later jobs of the same priority
    ticket: int = -1  # matches the job's one live heap entry; -1 while running
    running: bool = False


class SynthWorker:
    def __init__(self) -> None:
        self._heap: list[tuple[int, int, int, _Job]] = []  # (priority, order, ticket, job)
        self._tickets = itertools.count()
        self._jobs: dict[str, _Job] = {}
        self._cond = threading.Condition()
        self._stopping = False
        self._thread = threading.Thread(target=self._run, name="awdio-synth", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        with self._cond:
            self._stopping = True
            self._cond.notify()
        self._thread.join(timeout=5)
        with self._cond:
            pending, self._jobs = list(self._jobs.values()), {}
        for job in pending:
            job.future.cancel()

    def submit(self, key: str, fn: Callable[[], Any], priority: Priority) -> Future[Any]:
        """Queue a job, or join the queued/running/parked job with the same key (raising its priority)."""
        with self._cond:
            job = self._jobs.get(key)
            if job is None:
                job = _Job(key, fn, priority, order=next(self._tickets))
                self._jobs[key] = job
                self._push(job)
            elif priority < job.priority:
                job.priority = priority
                if not job.running:
                    self._push(job)
            return job.future

    def _push(self, job: _Job) -> None:
        job.ticket = next(self._tickets)
        heapq.heappush(self._heap, (job.priority, job.order, job.ticket, job))
        self._cond.notify()

    def _drop_stale(self) -> None:
        while self._heap and self._heap[0][2] != self._heap[0][3].ticket:
            heapq.heappop(self._heap)

    def _take(self) -> _Job | None:
        with self._cond:
            while True:
                if self._stopping:
                    return None
                self._drop_stale()
                if self._heap:
                    job = heapq.heappop(self._heap)[3]
                    job.ticket, job.running = -1, True
                    return job
                self._cond.wait()

    def _should_yield(self, job: _Job) -> bool:
        with self._cond:
            self._drop_stale()
            return bool(self._heap) and self._heap[0][0] < job.priority

    def _run(self) -> None:
        while (job := self._take()) is not None:
            try:
                if job.steps is None:
                    outcome = job.fn()
                    if not inspect.isgenerator(outcome):
                        self._finish(job, result=outcome)
                        continue
                    job.steps = outcome
                steps = job.steps
                while True:
                    next(steps)
                    if self._should_yield(job):
                        with self._cond:
                            job.running = False
                            self._push(job)
                        log.debug("parked job at priority %s for more urgent work", job.priority.name)
                        break
            except StopIteration as done:
                self._finish(job, result=done.value)
            except BaseException as exc:  # delivered to whoever awaits the future
                self._finish(job, error=exc)

    def _finish(self, job: _Job, *, result: Any = None, error: BaseException | None = None) -> None:
        with self._cond:
            self._jobs.pop(job.key, None)
        if error is not None:
            job.future.set_exception(error)
        else:
            job.future.set_result(result)
