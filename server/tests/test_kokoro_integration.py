"""Opt-in: synthesise with the real Kokoro model (downloads ~330 MB on first run). AWDIO_TEST_KOKORO=1 to run."""

from __future__ import annotations

import os
import time
import wave
from pathlib import Path

import pytest

from awdio.db import Database, DocumentRow, utc_now
from awdio.library import LoadedDocument
from awdio.parsing.base import Block, Page
from awdio.tts.base import SynthContext, run_steps
from awdio.tts.cache import PAD_AFTER_OTHER, AudioCache
from awdio.tts.kokoro_engine import SAMPLE_RATE, KokoroEngine
from awdio.tts.registry import EngineRegistry
from awdio.tts.sentences import split_sentences
from awdio.tts.service import SynthesisService
from awdio.tts.worker import Priority, SynthWorker

from . import corpus
from .conftest import assert_timings_valid

pytestmark = pytest.mark.skipif(os.environ.get("AWDIO_TEST_KOKORO") != "1", reason="set AWDIO_TEST_KOKORO=1")

PARAGRAPH = (
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want "
    "of a wife. However little known the feelings or views of such a man may be on his first entering a "
    "neighbourhood, Dr. Smith paid £3.50 for 2 coffees!"
)
ALICE_57 = corpus.ALICE[0][1][0]  # the 57-word opening paragraph of Alice


@pytest.mark.parametrize("voice", ["af_heart", "bf_emma"])
def test_real_kokoro_timings(voice: str) -> None:
    engine = KokoroEngine(default_voice=voice)
    loaded = time.perf_counter()
    engine.warm()
    load_seconds = time.perf_counter() - loaded

    started = time.perf_counter()
    result = run_steps(engine.synthesize(PARAGRAPH, voice, context=SynthContext(kind="paragraph")))
    wall = time.perf_counter() - started

    duration = len(result.audio) / SAMPLE_RATE
    assert result.sample_rate == SAMPLE_RATE and duration > 5
    assert_timings_valid(result.word_timings, len(PARAGRAPH.split(" ")), duration)
    assert result.word_timings[0][0] < 1.0
    assert result.word_timings[-1][1] == pytest.approx(duration)  # last word ends where the audio ends
    print(
        f"\n[kokoro {voice}] load {load_seconds:.1f}s, {len(split_sentences(PARAGRAPH))} sentences, "
        f"audio {duration:.2f}s, synth {wall:.2f}s, RTF {wall / duration:.3f}"
    )


def test_sentence_steps_and_cached_block_duration(tmp_path: Path) -> None:
    """A 57-word paragraph through the real worker/cache path: first sentence latency, wav length == duration."""
    engine = KokoroEngine()
    engine.warm()
    steps = engine.synthesize(ALICE_57, "af_heart", context=SynthContext(kind="paragraph"))
    started = time.perf_counter()
    next(steps)
    first_sentence = time.perf_counter() - started
    result = run_steps(steps)
    total = time.perf_counter() - started
    speech = len(result.audio) / SAMPLE_RATE
    assert_timings_valid(result.word_timings, 57, speech)

    doc = LoadedDocument("doc", "txt", [Page(0, "1", [Block(0, "paragraph", None, ALICE_57, 57, 0)])])
    db = Database(tmp_path / "db.sqlite")
    db.insert_document(DocumentRow("doc", "Alice", "txt", "alice.txt", 57, 1, 1, utc_now(), None))
    worker = SynthWorker()
    worker.start()
    try:
        service = SynthesisService(EngineRegistry([engine]), AudioCache(tmp_path, db, "wav"), worker)
        entry = service.block_audio(doc, 0, "kokoro", "af_heart", Priority.ON_DEMAND).result(timeout=300)
    finally:
        worker.stop()
    with wave.open(str(tmp_path / f"{entry.key}.wav")) as w:
        file_seconds = w.getnframes() / w.getframerate()
    assert file_seconds == pytest.approx(entry.duration_sec, abs=1e-3)
    assert entry.timings[-1][1] <= entry.duration_sec
    assert entry.duration_sec == pytest.approx(entry.timings[-1][1] + PAD_AFTER_OTHER, abs=2e-3)
    assert_timings_valid(entry.timings, 57, entry.duration_sec)
    print(
        f"\n[kokoro 57 words] {len(split_sentences(ALICE_57))} sentences: first sentence in {first_sentence:.2f}s, "
        f"whole block {total:.2f}s for {speech:.2f}s of speech (RTF {total / speech:.3f})"
    )
