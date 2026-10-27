from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from awdio.api import documents as documents_api

from .conftest import assert_document_invariants, upload


def test_upload_get_progress_delete_roundtrip(client: TestClient, fixtures_dir: Path, tmp_path: Path) -> None:
    created = upload(client, fixtures_dir / "alice.pdf")
    assert created.status_code == 201
    summary = created.json()
    doc_id = summary["id"]
    assert summary["title"] == "Alice's Adventures in Wonderland"
    assert summary["sourceType"] == "pdf"
    assert summary["pageCount"] == 4
    assert summary["lastOpenedAt"] is None and summary["progress"] is None
    assert summary["prepare"] == {
        "status": "idle",
        "done": 0,
        "total": summary["blockCount"],
        "engine": "kokoro",
        "voiceId": "af_heart",
    }
    assert summary["estimatedSeconds"] == round(summary["wordCount"] * 0.38, 1)

    response = client.get(f"/api/documents/{doc_id}", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip"
    doc = response.json()
    assert_document_invariants(doc)
    assert doc["lastOpenedAt"] is not None
    assert [p["label"] for p in doc["pages"]] == ["i", "1", "2", "3"]

    assert client.get(f"/api/documents/{doc_id}/progress").json() is None
    third = doc["pages"][0]["blocks"][2]
    progress = client.put(f"/api/documents/{doc_id}/progress", json={"blockIndex": 2, "wordIndex": 5}).json()
    assert progress["blockIndex"] == 2 and progress["wordIndex"] == 5
    assert progress["wordOrdinal"] == third["wordStart"] + 5
    assert progress["percent"] == round(100 * progress["wordOrdinal"] / doc["wordCount"], 2)
    assert client.get(f"/api/documents/{doc_id}/progress").json() == progress

    clamped = client.put(f"/api/documents/{doc_id}/progress", json={"blockIndex": 999, "wordIndex": 999}).json()
    last = doc["pages"][-1]["blocks"][-1]
    assert (clamped["blockIndex"], clamped["wordIndex"]) == (last["index"], last["wordCount"] - 1)
    negative = client.put(f"/api/documents/{doc_id}/progress", json={"blockIndex": -3, "wordIndex": -1}).json()
    assert (negative["blockIndex"], negative["wordIndex"], negative["percent"]) == (0, 0, 0.0)

    listed = client.get("/api/documents").json()
    assert [d["id"] for d in listed] == [doc_id] and listed[0]["progress"]["blockIndex"] == 0

    data_dir = tmp_path / "data"
    assert (data_dir / "docs" / doc_id / "document.json").exists()
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert client.get(f"/api/documents/{doc_id}").json()["error"]["code"] == "not_found"
    assert client.get("/api/documents").json() == []
    assert not (data_dir / "docs" / doc_id).exists()
    assert not list((data_dir / "uploads").iterdir())


def test_every_format_uploads(client: TestClient, fixtures_dir: Path) -> None:
    for name, source_type in [("pride.docx", "docx"), ("pride.epub", "epub"), ("pride.txt", "txt"), ("pride.md", "md")]:
        response = upload(client, fixtures_dir / name)
        assert response.status_code == 201, response.text
        assert response.json()["sourceType"] == source_type
        assert_document_invariants(client.get(f"/api/documents/{response.json()['id']}").json())


def test_mime_type_decides_when_extension_is_unknown(client: TestClient, fixtures_dir: Path, tmp_path: Path) -> None:
    path = tmp_path / "download"
    path.write_bytes((fixtures_dir / "pride.txt").read_bytes())
    response = upload(client, path, content_type="text/plain")
    assert response.status_code == 201 and response.json()["sourceType"] == "txt"


def test_list_sorted_by_last_opened_then_created(client: TestClient, fixtures_dir: Path) -> None:
    first = upload(client, fixtures_dir / "pride.txt").json()["id"]
    second = upload(client, fixtures_dir / "pride.md").json()["id"]
    third = upload(client, fixtures_dir / "pride.docx").json()["id"]
    client.get(f"/api/documents/{first}")
    order = [d["id"] for d in client.get("/api/documents").json()]
    assert order[0] == first and set(order[1:]) == {second, third}


def test_rename(client: TestClient, fixtures_dir: Path) -> None:
    doc_id = upload(client, fixtures_dir / "pride.txt").json()["id"]
    renamed = client.patch(f"/api/documents/{doc_id}", json={"title": "  My   Austen  "})
    assert renamed.status_code == 200 and renamed.json()["title"] == "My Austen"
    assert client.patch(f"/api/documents/{doc_id}", json={"title": "   "}).status_code == 400
    assert client.patch("/api/documents/nope", json={"title": "x"}).status_code == 404


def test_upload_errors(client: TestClient, fixtures_dir: Path, tmp_path: Path, monkeypatch) -> None:
    image = tmp_path / "photo.png"
    image.write_bytes(b"\x89PNG\r\n")
    response = upload(client, image, content_type="image/png")
    assert response.status_code == 415 and response.json()["error"]["code"] == "unsupported_type"

    response = upload(client, fixtures_dir / "blank.pdf")
    assert response.status_code == 422 and response.json()["error"]["code"] == "no_text"

    broken = tmp_path / "broken.epub"
    broken.write_bytes(b"not a zip")
    assert upload(client, broken).json()["error"]["code"] == "parse_error"

    monkeypatch.setattr(documents_api, "MAX_UPLOAD_BYTES", 1000)
    big = tmp_path / "big.txt"
    big.write_text("word " * 1000)
    response = upload(client, big)
    assert response.status_code == 413 and response.json()["error"]["code"] == "file_too_large"

    assert client.post("/api/documents", data={"other": "x"}).status_code == 400
    assert not list((tmp_path / "data" / "uploads").iterdir())
    assert client.get("/api/documents").json() == []


def test_unknown_api_route_and_frontend_hint(client: TestClient) -> None:
    missing = client.get("/api/nothing-here")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
    hint = client.get("/")
    assert hint.status_code == 200 and hint.json()["app"] == "awdio"
