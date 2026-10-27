from __future__ import annotations

import json
from collections.abc import Callable

import httpx
from fastapi.testclient import TestClient

from awdio.settings import SettingsStore
from awdio.tts.elevenlabs_engine import API_BASE, ElevenLabsEngine

from .conftest import FakeEngine

GOOD_KEY = "sk_good"
VOICES = {
    "voices": [
        {"voice_id": "el_rachel", "name": "Rachel", "labels": {"accent": "american", "gender": "female"}},
        {"voice_id": "el_mystery", "name": "Mystery", "labels": {}},
    ]
}


def elevenlabs_transport(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.headers.get("xi-api-key") != GOOD_KEY:
            return httpx.Response(401, json={"detail": {"status": "invalid_api_key", "message": "Invalid API key"}})
        if request.url.path.endswith("/voices"):
            return httpx.Response(200, json=VOICES)
        return httpx.Response(500, json={"detail": {"message": "boom"}})

    return httpx.MockTransport(handler)


def client_with_elevenlabs(make_client: Callable[..., TestClient], seen: list[httpx.Request]) -> TestClient:
    def engines(settings: SettingsStore) -> list:
        http = httpx.Client(base_url=API_BASE, transport=elevenlabs_transport(seen))
        return [FakeEngine(), ElevenLabsEngine(settings.elevenlabs_credentials, client=http)]

    return make_client(engines=engines)


def test_defaults(client: TestClient) -> None:
    assert client.get("/api/settings").json() == {
        "engine": "kokoro",
        "voiceId": "af_heart",
        "speed": 1.0,
        "font": "serif",
        "textSize": 19,
        "theme": "system",
        "autoScroll": True,
        "elevenLabsConfigured": False,
        "elevenLabsModelId": "eleven_multilingual_v2",
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


def test_elevenlabs_key_is_validated_stored_and_never_returned(make_client: Callable[..., TestClient]) -> None:
    seen: list[httpx.Request] = []
    client = client_with_elevenlabs(make_client, seen)

    rejected = client.put("/api/settings", json={"elevenLabsApiKey": "sk_bad"})
    assert rejected.status_code == 400 and rejected.json()["error"]["code"] == "invalid_api_key"
    assert client.put("/api/settings", json={"engine": "elevenlabs"}).json()["error"]["code"] == "engine_not_configured"

    accepted = client.put("/api/settings", json={"elevenLabsApiKey": f"  {GOOD_KEY} "})
    assert accepted.status_code == 200
    assert accepted.json()["elevenLabsConfigured"] is True
    assert GOOD_KEY not in json.dumps(accepted.json())
    assert seen[-1].headers["xi-api-key"] == GOOD_KEY

    switched = client.put("/api/settings", json={"engine": "elevenlabs"}).json()
    assert (switched["engine"], switched["voiceId"]) == ("elevenlabs", "el_rachel")

    engines = {e["id"]: e for e in client.get("/api/voices").json()["engines"]}
    assert engines["elevenlabs"]["configured"] and engines["elevenlabs"]["ready"]
    assert engines["elevenlabs"]["voices"] == [
        {"id": "el_rachel", "engine": "elevenlabs", "name": "Rachel", "accent": "American", "gender": "female"},
        {"id": "el_mystery", "engine": "elevenlabs", "name": "Mystery", "accent": "Unknown", "gender": "neutral"},
    ]
    health = client.get("/api/health").json()
    assert health == {"status": "ok", "engines": [{"id": "kokoro", "ready": True}, {"id": "elevenlabs", "ready": True}]}

    cleared = client.put("/api/settings", json={"elevenLabsApiKey": ""}).json()
    assert cleared["elevenLabsConfigured"] is False
    assert (cleared["engine"], cleared["voiceId"]) == ("kokoro", "af_heart")
