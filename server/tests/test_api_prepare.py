from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import FakeEngine, upload


def wait_for(condition: Callable[[], bool], timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def long_text(tmp_path: Path, paragraphs: int = 3, sentences: int = 6) -> Path:
    text = "\n\n".join(
        " ".join(f"Paragraph {p} sentence {s} goes here." for s in range(sentences)) for p in range(paragraphs)
    )
    path = tmp_path / "long.txt"
    path.write_text(text + "\n")
    return path


def blocks_of(client: TestClient, doc_id: str) -> list[dict]:
    return [b for p in client.get(f"/api/documents/{doc_id}").json()["pages"] for b in p["blocks"]]


def test_on_demand_request_overtakes_running_prepare_job(
    make_client: Callable[..., TestClient], tmp_path: Path
) -> None:
    fake = FakeEngine(sentence_delay=0.05)
    client = make_client(fake=fake)
    doc_id = upload(client, long_text(tmp_path)).json()["id"]
    blocks = blocks_of(client, doc_id)

    assert client.post(f"/api/documents/{doc_id}/prepare").status_code == 202
    wait_for(lambda: len(fake.sentences) >= 1)  # prepare is inside block 0
    started = time.monotonic()
    audio = client.get(f"/api/documents/{doc_id}/blocks/2/audio")
    waited = time.monotonic() - started
    assert audio.status_code == 200

    assert waited < 6 * 0.05 + 6 * 0.05  # well under "finish block 0, then block 2"

    wait_for(lambda: client.get(f"/api/documents/{doc_id}/prepare").json()["status"] == "done")
    order = fake.sentences
    block0_last = order.index("Paragraph 0 sentence 5 goes here.")
    block2_first = order.index("Paragraph 2 sentence 0 goes here.")
    assert block2_first < block0_last  # block 0 was parked mid-way, block 2 ran, then block 0 resumed
    calls = [text for text, _, _ in fake.calls]
    assert calls == [blocks[0]["text"], blocks[2]["text"], blocks[1]["text"]]  # each block synthesised once
    assert order.count("Paragraph 0 sentence 0 goes here.") == 1  # resumed, not restarted


def test_prepare_runs_in_document_order_and_skips_cached_blocks(client: TestClient, fixtures_dir: Path) -> None:
    doc_id = upload(client, fixtures_dir / "pride.md").json()["id"]
    blocks = blocks_of(client, doc_id)
    client.get(f"/api/documents/{doc_id}/blocks/2/audio")
    fake: FakeEngine = client.fake  # type: ignore[attr-defined]

    assert client.post(f"/api/documents/{doc_id}/prepare").status_code == 202
    wait_for(lambda: client.get(f"/api/documents/{doc_id}/prepare").json()["status"] == "done")
    expected = [blocks[2]["text"]] + [b["text"] for b in blocks if b["index"] != 2]
    assert [text for text, _, _ in fake.calls] == expected


def test_upload_auto_prepares_with_the_saved_local_voice(
    make_client: Callable[..., TestClient], fixtures_dir: Path
) -> None:
    client = make_client(auto_prepare=True)
    summary = upload(client, fixtures_dir / "pride.txt").json()
    assert summary["prepare"]["status"] in ("running", "done") and summary["prepare"]["voiceId"] == "af_heart"
    doc_id = summary["id"]
    wait_for(lambda: client.get(f"/api/documents/{doc_id}/prepare").json()["status"] == "done")
    assert client.get("/api/documents").json()[0]["prepare"]["done"] == summary["blockCount"]

    client.put("/api/settings", json={"voiceId": "bf_emma"})  # changing the voice starts nothing
    time.sleep(0.1)
    assert client.get(f"/api/documents/{doc_id}/prepare", params={"voice": "bf_emma"}).json()["status"] == "idle"


def test_upload_never_auto_prepares_on_a_cloud_engine(
    make_client: Callable[..., TestClient], fixtures_dir: Path
) -> None:
    fake = FakeEngine()
    fake.local = False
    client = make_client(auto_prepare=True, fake=fake)
    summary = upload(client, fixtures_dir / "pride.txt").json()
    assert summary["prepare"]["status"] == "idle"
    time.sleep(0.1)
    assert fake.calls == []
