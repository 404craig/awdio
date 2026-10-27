from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from awdio import auth


def test_open_access_when_no_pin(client: TestClient) -> None:
    assert client.get("/api/config").json() == {"accessPinRequired": False, "unlocked": True, "version": "0.1.0"}
    assert client.get("/api/documents").status_code == 200


def test_pin_gate(make_client: Callable[..., TestClient]) -> None:
    client = make_client(pin="2468")
    assert client.get("/api/config").json()["accessPinRequired"] is True
    assert client.get("/api/config").json()["unlocked"] is False
    for path in (
        "/api/documents",
        "/api/settings",
        "/api/voices",
        "/api/health",
        "/api/audio/0123456789abcdef01234567.wav",
    ):
        response = client.get(path)
        assert response.status_code == 401 and response.json()["error"]["code"] == "locked", path

    wrong = client.post("/api/unlock", json={"pin": "1111"})
    assert wrong.status_code == 401 and "awdio_session" not in wrong.cookies

    right = client.post("/api/unlock", json={"pin": "2468"})
    assert right.status_code == 204
    cookie = right.headers["set-cookie"]
    assert "awdio_session=" in cookie and "HttpOnly" in cookie and "Max-Age=15552000" in cookie
    assert client.get("/api/config").json()["unlocked"] is True
    assert client.get("/api/documents").status_code == 200

    client.cookies.clear()
    client.cookies.set("awdio_session", "forged")
    assert client.get("/api/documents").status_code == 401


def test_pin_lockout_after_five_wrong_attempts(make_client: Callable[..., TestClient], monkeypatch) -> None:
    client = make_client(pin="2468")
    for _ in range(auth.MAX_FAILURES):
        assert client.post("/api/unlock", json={"pin": "0000"}).status_code == 401
    locked = client.post("/api/unlock", json={"pin": "2468"})
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "too_many_attempts"

    now = auth.time.monotonic()
    monkeypatch.setattr(auth.time, "monotonic", lambda: now + auth.LOCKOUT_SECONDS + 1)
    assert client.post("/api/unlock", json={"pin": "2468"}).status_code == 204
