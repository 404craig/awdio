"""Opt-in: synthesise with the real Kokoro model (downloads ~330 MB on first run). AWDIO_TEST_KOKORO=1 to run."""

from __future__ import annotations

import os
import time

import pytest

from awdio.tts.base import SynthContext
from awdio.tts.kokoro_engine import SAMPLE_RATE, KokoroEngine

from .conftest import assert_timings_valid

pytestmark = pytest.mark.skipif(os.environ.get("AWDIO_TEST_KOKORO") != "1", reason="set AWDIO_TEST_KOKORO=1")

PARAGRAPH = (
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want "
    "of a wife. However little known the feelings or views of such a man may be on his first entering a "
    "neighbourhood, Dr. Smith paid £3.50 for 2 coffees!"
)


@pytest.mark.parametrize("voice", ["af_heart", "bf_emma"])
def test_real_kokoro_timings(voice: str) -> None:
    engine = KokoroEngine(default_voice=voice)
    loaded = time.perf_counter()
    engine.warm()
    load_seconds = time.perf_counter() - loaded

    started = time.perf_counter()
    result = engine.synthesize(PARAGRAPH, voice, context=SynthContext(kind="paragraph"))
    wall = time.perf_counter() - started

    duration = len(result.audio) / SAMPLE_RATE
    assert result.sample_rate == SAMPLE_RATE
    assert duration > 5
    assert_timings_valid(result.word_timings, len(PARAGRAPH.split(" ")), duration)
    assert result.word_timings[0][0] < 1.0
    print(
        f"\n[kokoro {voice}] load {load_seconds:.1f}s, audio {duration:.2f}s, synth {wall:.2f}s, "
        f"RTF {wall / duration:.3f}, first words {result.word_timings[:4]}"
    )
