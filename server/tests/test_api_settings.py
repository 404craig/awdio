from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from fastapi.testclient import TestClient

from awdio.config import Config
from awdio.db import Database


def test_defaults(client: TestClient) -> None:
    assert client.get("/api/settings").json() == {
        "engine": "kokoro",
        "voiceId": "af_heart",
        "speed": 1.0,
        "font": "serif",
        "textSize": 19,
        "theme": "system",
        "autoScroll": True,
    }


def test_partial_update_and_validation(client: TestClient) -> None:
    updated = client.put("/api/settings", json={"speed": 1.3, "theme": "sepia", "textSize": 22, "voiceId": "bf_emma"})
    assert updated.status_code == 200
    body = updated.json()
    assert (body["speed"], body["theme"], body["textSize"], body["voiceId"]) == (1.25, "sepia", 22, "bf_emma")
    assert client.get("/api/settings").json() == body

    for bad in ({"speed": 4}, {"textSize": 10}, {"theme": "neon"}, {"unknownField": 1}):
        response = client.put("/api/settings", json=bad)
        assert response.status_code == 400 and response.json()["error"]["code"] == "bad_request", bad
    response = client.put("/api/settings", json={"voiceId": "zz_nobody"})
    assert response.status_code == 400 and response.json()["error"]["code"] == "unknown_voice"
    assert client.put("/api/settings", json={"engine": "elevenlabs"}).json()["error"]["code"] == "unknown_engine"


def test_settings_left_by_a_removed_engine_fall_back_to_the_default_voice(
    make_client: Callable[..., TestClient], tmp_path: Path
) -> None:
    data = tmp_path / "data"
    Config(data_dir=data).ensure_dirs()
    old = Database(data / "awdio.sqlite")
    old.set_settings({"engine": "elevenlabs", "voiceId": "el_rachel", "elevenlabs_api_key": "sk_x", "speed": 1.5})
    old.close()
    client = make_client()
    settings = client.get("/api/settings").json()
    assert (settings["engine"], settings["voiceId"], settings["speed"]) == ("kokoro", "af_heart", 1.5)
    assert set(settings) == {"engine", "voiceId", "speed", "font", "textSize", "theme", "autoScroll"}


def test_voices_and_health_list_only_local_engines(client: TestClient) -> None:
    engines = client.get("/api/voices").json()["engines"]
    assert [e["id"] for e in engines] == ["kokoro"]
    assert set(engines[0]) == {"id", "name", "ready", "description", "voices"}
    assert client.get("/api/health").json() == {"status": "ok", "engines": [{"id": "kokoro", "ready": True}]}
