"""Curated Kokoro-82M English voices with the overall grades published in the model's VOICES.md."""

from __future__ import annotations

from .base import Gender, Voice

_ACCENTS = {"a": "American", "b": "British"}
_GENDERS: dict[str, Gender] = {"f": "female", "m": "male"}
_GRADES = {  # British first (the user is in the UK), each accent best grade first
    "bf_emma": "B-",
    "bf_isabella": "C",
    "bm_fable": "C",
    "bm_george": "C",
    "bm_lewis": "D+",
    "bf_alice": "D",
    "bf_lily": "D",
    "bm_daniel": "D",
    "af_heart": "A",
    "af_bella": "A-",
    "af_nicole": "B-",
    "af_aoede": "C+",
    "af_kore": "C+",
    "af_sarah": "C+",
    "am_fenrir": "C+",
    "am_michael": "C+",
    "am_puck": "C+",
    "af_alloy": "C",
    "af_nova": "C",
    "af_sky": "C-",
    "af_jessica": "D",
    "af_river": "D",
    "am_echo": "D",
    "am_eric": "D",
    "am_liam": "D",
    "am_onyx": "D",
    "am_santa": "D-",
    "am_adam": "F+",
}

KOKORO_VOICES: list[Voice] = [
    Voice(
        id=voice_id,
        engine="kokoro",
        name=voice_id[3:].capitalize(),
        accent=_ACCENTS[voice_id[0]],
        gender=_GENDERS[voice_id[1]],
        quality=grade,
    )
    for voice_id, grade in _GRADES.items()
]
DEFAULT_KOKORO_VOICE = "af_heart"  # the highest-graded voice stays the default
