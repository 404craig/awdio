from __future__ import annotations

import threading
from collections.abc import Generator, Iterator

import pytest

from awdio.tts.worker import Priority, SynthWorker


@pytest.fixture
def worker() -> Iterator[SynthWorker]:
    w = SynthWorker()
    w.start()
    yield w
    w.stop()


def steps_job(
    name: str, n: int, log: list[str], hold: threading.Event | None = None, started: threading.Event | None = None
):
    def run() -> Generator[None, None, str]:
        for i in range(n):
            log.append(f"{name}{i}")
            if i == 0 and started is not None and hold is not None:
                started.set()
                hold.wait(5)
            yield
        return name

    return run


def test_on_demand_job_overtakes_a_running_prepare_job_between_steps(worker: SynthWorker) -> None:
    log: list[str] = []
    started, hold = threading.Event(), threading.Event()
    prepare = worker.submit("prep", steps_job("p", 3, log, hold, started), Priority.PREPARE)
    assert started.wait(5)
    urgent = worker.submit("seek", steps_job("s", 2, log), Priority.ON_DEMAND)
    hold.set()
    assert urgent.result(5) == "s" and prepare.result(5) == "p"
    assert log == ["p0", "s0", "s1", "p1", "p2"]  # parked after one step, resumed without redoing p0


def test_equal_priority_does_not_preempt(worker: SynthWorker) -> None:
    log: list[str] = []
    started, hold = threading.Event(), threading.Event()
    first = worker.submit("a", steps_job("a", 3, log, hold, started), Priority.ON_DEMAND)
    assert started.wait(5)
    second = worker.submit("b", steps_job("b", 1, log), Priority.ON_DEMAND)
    hold.set()
    second.result(5), first.result(5)
    assert log == ["a0", "a1", "a2", "b0"]


def test_parked_job_can_be_promoted_by_a_duplicate_request(worker: SynthWorker) -> None:
    log: list[str] = []
    started, hold = threading.Event(), threading.Event()
    blocker_started, blocker_hold = threading.Event(), threading.Event()
    prepare = worker.submit("block-7", steps_job("p", 3, log, hold, started), Priority.PREPARE)
    assert started.wait(5)
    worker.submit("other", steps_job("o", 2, log, blocker_hold, blocker_started), Priority.PREFETCH)
    hold.set()  # prepare parks in favour of the prefetch
    assert blocker_started.wait(5)
    worker.submit("later", steps_job("l", 1, log), Priority.PREFETCH)
    assert worker.submit("block-7", steps_job("never", 1, log), Priority.ON_DEMAND) is prepare
    blocker_hold.set()
    prepare.result(5)
    worker.submit("done", steps_job("d", 1, log), Priority.PREPARE).result(5)
    # the promoted block resumes (at p1) before the queued prefetch; nothing restarts from scratch
    assert log == ["p0", "o0", "p1", "p2", "o1", "l0", "d0"]


def test_plain_jobs_errors_and_deduplication(worker: SynthWorker) -> None:
    assert worker.submit("plain", lambda: 42, Priority.ON_DEMAND).result(5) == 42

    def boom() -> Generator[None, None, None]:
        yield
        raise ValueError("bad")

    with pytest.raises(ValueError):
        worker.submit("boom", boom, Priority.ON_DEMAND).result(5)

    gate = threading.Event()
    blocker = worker.submit("blocker", lambda: gate.wait(5), Priority.ON_DEMAND)
    a = worker.submit("same", lambda: "first", Priority.PREPARE)
    b = worker.submit("same", lambda: "second", Priority.ON_DEMAND)
    gate.set()
    assert a is b and b.result(5) == "first" and blocker.result(5) is True
