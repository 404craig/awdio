"""Map engine timing units (tokens, characters) onto the block's whitespace-delimited words."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class TimedSpan:
    """A character span [start, end) of the block text and when it is spoken, in seconds."""

    start: int
    end: int
    t0: float
    t1: float


@dataclass(frozen=True)
class EngineToken:
    text: str
    whitespace: str
    start_ts: float | None
    end_ts: float | None


@dataclass(frozen=True)
class TokenChunk:
    """One synthesis chunk: its text, its tokens and where its audio starts in the concatenated output."""

    graphemes: str
    tokens: Sequence[EngineToken]
    offset: float


def word_spans(text: str) -> list[tuple[int, int]]:
    spans, pos = [], 0
    for word in text.split(" "):
        spans.append((pos, pos + len(word)))
        pos += len(word) + 1
    return spans


def token_spans(text: str, chunks: Iterable[TokenChunk]) -> list[TimedSpan]:
    """Locate each chunk in `text` (falling back to a positional estimate) and give each timed token its span."""
    spans: list[TimedSpan] = []
    cursor = 0
    for chunk in chunks:
        found = text.find(chunk.graphemes, cursor) if chunk.graphemes else -1
        start = found if found >= 0 else min(cursor, len(text))
        pos = start
        for tok in chunk.tokens:
            end = pos + len(tok.text)
            if tok.start_ts is not None and tok.end_ts is not None and tok.text:
                spans.append(TimedSpan(min(pos, len(text)), min(end, len(text)),
                                       chunk.offset + tok.start_ts, chunk.offset + tok.end_ts))
            pos = end + len(tok.whitespace)
        cursor = max(cursor, start + len(chunk.graphemes))
    return spans


def char_spans(text: str, characters: Sequence[str], starts: Sequence[float], ends: Sequence[float]) -> list[TimedSpan]:
    """Walk a per-character alignment (ElevenLabs) against `text`; whitespace characters carry no timing."""
    spans: list[TimedSpan] = []
    pos = 0
    for ch, t0, t1 in zip(characters, starts, ends, strict=False):
        if not ch or ch.isspace():
            if pos < len(text) and text[pos] == " ":
                pos += 1
            continue
        found = text.find(ch, pos, pos + 8)
        if found < 0:
            continue
        spans.append(TimedSpan(found, found + len(ch), t0, t1))
        pos = found + len(ch)
    return spans


def align_words(text: str, spans: Sequence[TimedSpan], speech_end: float) -> list[tuple[float, float]]:
    """One (start, end) per word: min/max of overlapping timed spans, gaps interpolated by character length,
    then made monotonic and non-overlapping, clamped to [0, speech_end], with the last word ending at speech_end."""
    words = word_spans(text)
    ordered = sorted(spans, key=lambda s: s.start)
    timed: list[tuple[float, float] | None] = []
    j = 0
    for ws, we in words:
        while j < len(ordered) and ordered[j].end <= ws:
            j += 1
        hits = []
        k = j
        while k < len(ordered) and ordered[k].start < we:
            if ordered[k].end > ws:
                hits.append(ordered[k])
            k += 1
        timed.append((min(h.t0 for h in hits), max(h.t1 for h in hits)) if hits else None)

    filled = _interpolate(timed, [we - ws for ws, we in words], speech_end)
    return _monotonic(filled, speech_end)


def _interpolate(timed: list[tuple[float, float] | None], lengths: list[int], speech_end: float) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    i = 0
    while i < len(timed):
        value = timed[i]
        if value is not None:
            out.append(value)
            i += 1
            continue
        run_end = i
        while run_end < len(timed) and timed[run_end] is None:
            run_end += 1
        left = out[-1][1] if out else 0.0
        right_value = timed[run_end] if run_end < len(timed) else None
        right = right_value[0] if right_value is not None else speech_end
        right = max(right, left)
        weights = [lengths[x] + 1 for x in range(i, run_end)]
        total = sum(weights)
        t = left
        for w in weights:
            step = (right - left) * w / total
            out.append((t, t + step))
            t += step
        i = run_end
    return out


def _monotonic(values: list[tuple[float, float]], speech_end: float) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    prev_end = 0.0
    for start, end in values:
        start = min(max(start, prev_end, 0.0), speech_end)
        end = min(max(end, start), speech_end)
        out.append((start, end))
        prev_end = end
    if out:
        out[-1] = (out[-1][0], speech_end)
    return out
