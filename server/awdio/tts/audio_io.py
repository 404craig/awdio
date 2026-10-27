"""WAV/MP3 encoding (MP3 via ffmpeg) and silence padding."""

from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np


def pad_silence(audio: np.ndarray, sample_rate: int, seconds: float) -> np.ndarray:
    silence = np.zeros(int(round(sample_rate * seconds)), dtype=np.float32)
    return np.concatenate([audio.astype(np.float32, copy=False), silence])


def _pcm16(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(_pcm16(audio))


def write_mp3(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "s16le",
            "-ar",
            str(sample_rate),
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-f",
            "mp3",
            str(path),
        ],
        input=_pcm16(audio),
        check=True,
        capture_output=True,
    )
