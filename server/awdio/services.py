"""Long-lived application services, built once per app in the lifespan."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from fastapi import Request

from .auth import PinGate
from .config import Config
from .db import Database
from .library import Library
from .settings import SettingsStore
from .tts.base import Engine
from .tts.cache import AudioCache
from .tts.elevenlabs_engine import ElevenLabsEngine
from .tts.kokoro_engine import KokoroEngine
from .tts.prepare import PrepareManager
from .tts.registry import EngineRegistry
from .tts.service import SynthesisService
from .tts.worker import SynthWorker


@dataclass
class Services:
    config: Config
    db: Database
    settings: SettingsStore
    library: Library
    engines: EngineRegistry
    cache: AudioCache
    worker: SynthWorker
    synth: SynthesisService
    prepare: PrepareManager
    gate: PinGate

    def close(self) -> None:
        self.prepare.shutdown()
        self.worker.stop()
        self.db.close()


EngineFactory = Callable[[SettingsStore], Sequence[Engine]]


def default_engines(settings: SettingsStore) -> Sequence[Engine]:
    return [KokoroEngine(), ElevenLabsEngine(settings.elevenlabs_credentials)]


def build_services(config: Config, engines: EngineFactory = default_engines) -> Services:
    config.ensure_dirs()
    db = Database(config.db_path)
    settings = SettingsStore(db)
    if config.elevenlabs_api_key_seed and not settings.api_key():
        settings.set_api_key(config.elevenlabs_api_key_seed)
    registry = EngineRegistry(engines(settings))
    cache = AudioCache(config.audio_dir, db, config.audio_format)
    worker = SynthWorker()
    synth = SynthesisService(registry, cache, worker)
    library = Library(config, db)
    return Services(
        config=config,
        db=db,
        settings=settings,
        library=library,
        engines=registry,
        cache=cache,
        worker=worker,
        synth=synth,
        prepare=PrepareManager(synth, db, library.load),
        gate=PinGate(config.access_pin, settings.session_secret()),
    )


def get_services(request: Request) -> Services:
    return request.app.state.services
