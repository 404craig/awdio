"""Engines by id."""

from __future__ import annotations

from collections.abc import Iterable

from .base import Engine


class UnknownEngine(Exception):
    pass


class EngineRegistry:
    def __init__(self, engines: Iterable[Engine]) -> None:
        self._engines = {e.id: e for e in engines}

    def get(self, engine_id: str) -> Engine:
        try:
            return self._engines[engine_id]
        except KeyError:
            raise UnknownEngine(engine_id) from None

    def all(self) -> list[Engine]:
        return list(self._engines.values())
