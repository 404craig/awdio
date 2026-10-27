from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from awdio.config import Config
from awdio.main import create_app
from awdio.settings import SettingsStore
from awdio.tts.base import Engine, SynthContext, SynthResult, SynthSteps, Voice
from awdio.tts.sentences import split_sentences

from . import corpus

FAKE_RATE = 8000
FAKE_SECONDS_PER_WORD = 0.25


class FakeEngine:
    """Stands in for Kokoro: deterministic tone audio, evenly spaced word timings, no model."""

    id = "kokoro"
    name = "Fake Kokoro"
    description = "test engine"

    def __init__(self, *, ready: bool = True, sentence_delay: float = 0.0) -> None:
        self.is_ready = ready
        self.sentence_delay = sentence_delay
        self.calls: list[tuple[str, str, SynthContext]] = []
        self.sentences: list[str] = []  # every sentence synthesised, in the order the worker ran them

    def ready(self) -> bool:
        return self.is_ready

    def warm(self) -> None:
        self.is_ready = True

    def voices(self) -> list[Voice]:
        return [
            Voice("af_heart", "kokoro", "Heart", "American", "female", "A"),
            Voice("bf_emma", "kokoro", "Emma", "British", "female", "B-"),
        ]

    def synthesize(self, text: str, voice_id: str, *, context: SynthContext) -> SynthSteps:
        self.calls.append((text, voice_id, context))
        sentences = split_sentences(text)
        for i, sentence in enumerate(sentences):
            time.sleep(self.sentence_delay)
            self.sentences.append(sentence)
            if i + 1 < len(sentences):
                yield
        words = text.split(" ")
        seconds = len(words) * FAKE_SECONDS_PER_WORD
        t = np.arange(int(seconds * FAKE_RATE)) / FAKE_RATE
        audio = (0.1 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        timings = [(i * FAKE_SECONDS_PER_WORD, (i + 0.8) * FAKE_SECONDS_PER_WORD) for i in range(len(words))]
        return SynthResult(audio, FAKE_RATE, timings)


def assert_timings_valid(
    timings: list[tuple[float, float]] | list[list[float]], word_count: int, duration: float
) -> None:
    assert len(timings) == word_count
    previous_end = 0.0
    for start, end in timings:
        assert 0.0 <= start <= end <= duration + 1e-6
        assert start >= previous_end - 1e-6
        previous_end = end
    assert timings[-1][1] <= duration + 1e-6


def assert_document_invariants(doc: dict) -> None:
    """The API contract's invariants for a Document response."""
    ordinal = 0
    index = 0
    assert doc["pages"], "a document has at least one page"
    for page_index, page in enumerate(doc["pages"]):
        assert page["index"] == page_index
        assert isinstance(page["label"], str) and page["label"]
        assert page["blocks"]
        for block in page["blocks"]:
            text = block["text"]
            assert text and text == text.strip() and "  " not in text
            assert "\n" not in text and "\t" not in text
            assert block["index"] == index
            assert block["wordCount"] == len(text.split(" "))
            assert block["wordStart"] == ordinal
            if block["kind"] in ("title", "heading"):
                assert 1 <= block["level"] <= 6
            else:
                assert block["level"] is None
            ordinal += block["wordCount"]
            index += 1
    assert doc["wordCount"] == ordinal
    assert doc["blockCount"] == index
    assert doc["pageCount"] == len(doc["pages"])


@pytest.fixture
def make_client(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def factory(
        *,
        pin: str | None = None,
        engines: Callable[[SettingsStore], list[Engine]] | None = None,
        warm: bool = False,
        auto_prepare: bool = False,
        fake: FakeEngine | None = None,
    ) -> TestClient:
        config = Config(
            data_dir=tmp_path / "data",
            access_pin=pin,
            warm_engines=warm,
            auto_prepare=auto_prepare,
            web_dist=tmp_path / "no-dist",
        )
        fake = fake or FakeEngine()
        app = create_app(config, engines or (lambda _settings: [fake]))
        client = TestClient(app)
        client.__enter__()
        client.fake = fake  # type: ignore[attr-defined]
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


@pytest.fixture(scope="session")
def fixtures_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("fixtures")
    corpus.make_pdf(directory / "alice.pdf")
    corpus.make_blank_pdf(directory / "blank.pdf")
    corpus.make_docx(directory / "pride.docx")
    corpus.make_epub(directory / "pride.epub")
    corpus.make_txt(directory / "pride.txt")
    corpus.make_md(directory / "pride.md")
    return directory


def upload(client: TestClient, path: Path, content_type: str = "application/octet-stream"):
    with path.open("rb") as f:
        return client.post("/api/documents", files={"file": (path.name, f, content_type)})
