from __future__ import annotations

import io
import time
import wave
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


from .conftest import FAKE_SECONDS_PER_WORD, FakeEngine, assert_timings_valid, upload


def wait_for(condition: Callable[[], bool], timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


@pytest.fixture
def doc(client: TestClient, fixtures_dir: Path) -> dict:
    doc_id = upload(client, fixtures_dir / "pride.md").json()["id"]
    return client.get(f"/api/documents/{doc_id}").json()


def blocks_of(doc: dict) -> list[dict]:
    return [b for p in doc["pages"] for b in p["blocks"]]


def test_block_audio_json_file_and_range(client: TestClient, doc: dict) -> None:
    title, first = blocks_of(doc)[0], blocks_of(doc)[1]
    response = client.get(
        f"/api/documents/{doc['id']}/blocks/0/audio", params={"engine": "kokoro", "voice": "af_heart"}
    )
    assert response.status_code == 200
    audio = response.json()
    assert audio["blockIndex"] == 0 and audio["engine"] == "kokoro" and audio["voiceId"] == "af_heart"
    assert audio["format"] == "wav" and audio["url"].startswith("/api/audio/") and audio["url"].endswith(".wav")
    # title blocks get 0.5 s of silence after the speech
    assert audio["durationSec"] == pytest.approx(title["wordCount"] * FAKE_SECONDS_PER_WORD + 0.5)
    assert_timings_valid(audio["timings"], title["wordCount"], audio["durationSec"])

    file = client.get(audio["url"])
    assert file.status_code == 200 and file.headers["content-type"] == "audio/wav"
    assert "immutable" in file.headers["cache-control"] and file.headers.get("content-encoding") is None
    with wave.open(io.BytesIO(file.content)) as w:
        assert w.getnframes() / w.getframerate() == pytest.approx(audio["durationSec"], abs=1e-3)

    partial = client.get(audio["url"], headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206 and len(partial.content) == 100
    assert partial.headers["content-range"].startswith("bytes 0-99/")

    fake: FakeEngine = client.fake  # type: ignore[attr-defined]
    again = client.get(f"/api/documents/{doc['id']}/blocks/0/audio").json()  # defaults come from settings
    assert again == audio and len(fake.calls) == 1  # served from the cache

    client.get(f"/api/documents/{doc['id']}/blocks/1/audio", params={"prefetch": "true"})
    text, _, context = fake.calls[1]
    assert text == first["text"] and context.kind == "paragraph"
    assert context.previous_text == title["text"] and context.next_text == blocks_of(doc)[2]["text"]

    emma = client.get(f"/api/documents/{doc['id']}/blocks/0/audio", params={"voice": "bf_emma"}).json()
    assert emma["voiceId"] == "bf_emma" and emma["url"] != audio["url"]

    summary = client.get("/api/documents").json()[0]
    assert summary["estimatedSeconds"] != round(doc["wordCount"] * 0.38, 1)  # measured rate replaces the default


def test_block_audio_errors(client: TestClient, doc: dict) -> None:
    base = f"/api/documents/{doc['id']}/blocks"
    assert client.get(f"{base}/0/audio", params={"voice": "zz_nobody"}).json()["error"]["code"] == "unknown_voice"
    assert client.get(f"{base}/0/audio", params={"engine": "espeak"}).json()["error"]["code"] == "unknown_engine"
    response = client.get(f"{base}/{doc['blockCount']}/audio")
    assert response.status_code == 404 and response.json()["error"]["code"] == "block_not_found"
    assert client.get("/api/documents/missing/blocks/0/audio").status_code == 404
    assert client.get("/api/audio/0123456789abcdef01234567.wav").status_code == 404
    assert client.get("/api/audio/../../etc/passwd").status_code == 404


def test_engine_not_ready_returns_503_then_warms(make_client: Callable[..., TestClient], fixtures_dir: Path) -> None:
    fake = FakeEngine(ready=False)
    client = make_client(engines=lambda _settings: [fake])
    doc_id = upload(client, fixtures_dir / "pride.txt").json()["id"]
    response = client.get(f"/api/documents/{doc_id}/blocks/0/audio")
    assert response.status_code == 503 and response.json()["error"]["code"] == "engine_not_ready"
    assert client.get("/api/health").json()["engines"][0]["id"] == "kokoro"
    wait_for(fake.ready)
    assert client.get(f"/api/documents/{doc_id}/blocks/0/audio").status_code == 200


def test_prepare_synthesises_every_block_and_delete_removes_audio(
    client: TestClient, doc: dict, tmp_path: Path
) -> None:
    base = f"/api/documents/{doc['id']}/prepare"
    started = client.post(base, params={"engine": "kokoro", "voice": "bf_emma"})
    assert started.status_code == 202
    assert started.json()["total"] == doc["blockCount"] and started.json()["voiceId"] == "bf_emma"

    def status() -> dict:
        return client.get(base, params={"voice": "bf_emma"}).json()

    wait_for(lambda: status()["status"] == "done")
    assert status() == {
        "status": "done",
        "done": doc["blockCount"],
        "total": doc["blockCount"],
        "engine": "kokoro",
        "voiceId": "bf_emma",
    }
    assert client.get(base).json()["status"] == "idle"  # default voice (af_heart) is not prepared
    assert client.delete(base).status_code == 204

    audio_dir = tmp_path / "data" / "audio"
    assert len(list(audio_dir.glob("*.wav"))) == doc["blockCount"]
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    assert list(audio_dir.iterdir()) == []


def test_voices_and_preview(client: TestClient) -> None:
    engines = client.get("/api/voices").json()["engines"]
    assert engines[0]["id"] == "kokoro" and {v["id"] for v in engines[0]["voices"]} == {"af_heart", "bf_emma"}
    preview = client.get("/api/voices/kokoro/bf_emma/preview")
    assert preview.status_code == 200 and preview.headers["content-type"] == "audio/wav"
    assert client.get("/api/voices/kokoro/nobody/preview").status_code == 400
