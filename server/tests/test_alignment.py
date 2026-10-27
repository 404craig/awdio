from __future__ import annotations

import pytest

from awdio.tts.alignment import EngineToken, TimedSpan, TokenChunk, align_words, token_spans

from .conftest import assert_timings_valid


def tok(text: str, ws: str = " ", start: float | None = None, end: float | None = None) -> EngineToken:
    return EngineToken(text, ws, start, end)


def test_tokens_map_to_words_with_punctuation_attached() -> None:
    text = "Hello, world. Dr. Smith paid £3.50!"
    chunk = TokenChunk(
        text,
        [
            tok("Hello", "", 0.10, 0.40),
            tok(",", " ", 0.40, 0.45),
            tok("world", "", 0.50, 0.90),
            tok(".", " ", 0.90, 0.95),
            tok("Dr.", " ", 1.20, 1.50),
            tok("Smith", " ", 1.55, 1.90),
            tok("paid", " ", 1.95, 2.20),
            tok("£", "", None, None),
            tok("3.50", "", 2.30, 2.90),
            tok("!", "", 2.90, 2.95),
        ],
        offset=0.0,
    )
    timings = align_words(text, token_spans(text, [chunk]), speech_end=3.2)
    assert timings == [(0.10, 0.45), (0.50, 0.95), (1.20, 1.50), (1.55, 1.90), (1.95, 2.20), (2.30, 3.2)]
    assert_timings_valid(timings, len(text.split(" ")), 3.2)


def test_untimed_words_are_interpolated_by_character_length() -> None:
    text = "one bb cccc four"
    chunk = TokenChunk(text, [tok("one", " ", 0.0, 1.0), tok("bb"), tok("cccc"), tok("four", "", 4.0, 5.0)], 0.0)
    timings = align_words(text, token_spans(text, [chunk]), speech_end=5.0)
    # 3 s of untimed speech split 3:5 between "bb" (2+1 chars) and "cccc" (4+1 chars)
    assert timings[1] == pytest.approx((1.0, 2.125))
    assert timings[2] == pytest.approx((2.125, 4.0))
    assert_timings_valid(timings, 4, 5.0)


def test_chunk_split_offsets_second_chunk_and_skips_whitespace() -> None:
    text = "First sentence here. Second one follows."
    chunks = [
        TokenChunk(
            "First sentence here.",
            [
                tok("First", " ", 0.1, 0.4),
                tok("sentence", " ", 0.4, 0.9),
                tok("here", "", 0.9, 1.2),
                tok(".", "", 1.2, 1.3),
            ],
            offset=0.0,
        ),
        TokenChunk(
            "Second one follows.",
            [
                tok("Second", " ", 0.05, 0.4),
                tok("one", " ", 0.4, 0.6),
                tok("follows", "", 0.6, 1.0),
                tok(".", "", None, None),
            ],
            offset=1.5,
        ),
    ]
    timings = align_words(text, token_spans(text, chunks), speech_end=2.7)
    assert timings[:3] == [(0.1, 0.4), (0.4, 0.9), (0.9, 1.3)]
    assert timings[3] == pytest.approx((1.55, 1.9))
    assert timings[5] == pytest.approx((2.1, 2.7))  # last word ends at the end of speech
    assert_timings_valid(timings, 6, 2.7)


def test_unlocatable_chunk_falls_back_to_position_and_stays_valid() -> None:
    text = "It cost twenty pounds today."
    chunks = [
        TokenChunk(
            "It cost £20 today.",
            [
                tok("It", " ", 0.0, 0.2),
                tok("cost", " ", 0.2, 0.5),
                tok("£20", " ", 0.5, 1.4),
                tok("today", "", 1.4, 1.8),
                tok(".", "", 1.8, 1.9),
            ],
            offset=0.0,
        )
    ]
    timings = align_words(text, token_spans(text, chunks), speech_end=2.0)
    assert timings[0] == (0.0, 0.2)
    assert_timings_valid(timings, 5, 2.0)


def test_no_timestamps_at_all_spreads_words_over_speech() -> None:
    text = "a b c d"
    timings = align_words(text, [], speech_end=2.0)
    assert timings == pytest.approx([(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)])


def test_overlapping_and_out_of_order_times_are_made_monotonic() -> None:
    text = "alpha beta gamma"
    spans = [TimedSpan(0, 5, 0.5, 1.2), TimedSpan(6, 10, 1.0, 1.1), TimedSpan(11, 16, 0.9, 2.5)]
    timings = align_words(text, spans, speech_end=2.0)
    assert timings == [(0.5, 1.2), (1.2, 1.2), (1.2, 2.0)]
    assert_timings_valid(timings, 3, 2.0)
