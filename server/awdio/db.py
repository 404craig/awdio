"""SQLite persistence (stdlib sqlite3, WAL mode) and small repository functions."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    block_count INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_opened_at TEXT
);
CREATE TABLE IF NOT EXISTS progress (
    doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    block_index INTEGER NOT NULL,
    word_index INTEGER NOT NULL,
    word_ordinal INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS synth_stats (
    engine TEXT NOT NULL,
    voice TEXT NOT NULL,
    seconds REAL NOT NULL,
    words INTEGER NOT NULL,
    PRIMARY KEY (engine, voice)
);
CREATE TABLE IF NOT EXISTS audio_cache (
    key TEXT PRIMARY KEY,
    doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    engine TEXT NOT NULL,
    voice TEXT NOT NULL,
    block_index INTEGER,
    ext TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audio_cache_doc ON audio_cache(doc_id, engine, voice);
"""


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class DocumentRow:
    id: str
    title: str
    source_type: str
    filename: str
    word_count: int
    block_count: int
    page_count: int
    created_at: str
    last_opened_at: str | None


@dataclass(frozen=True)
class ProgressRow:
    block_index: int
    word_index: int
    word_ordinal: int
    updated_at: str


class Database:
    """One shared connection guarded by a lock; every call is a short transaction."""

    def __init__(self, path: Path) -> None:
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    # documents
    def insert_document(self, row: DocumentRow) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)",
                (row.id, row.title, row.source_type, row.filename, row.word_count,
                 row.block_count, row.page_count, row.created_at, row.last_opened_at),
            )

    def get_document(self, doc_id: str) -> DocumentRow | None:
        with self._tx() as c:
            r = c.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return DocumentRow(**dict(r)) if r else None

    def list_documents(self) -> list[DocumentRow]:
        with self._tx() as c:
            rows = c.execute(
                "SELECT * FROM documents ORDER BY last_opened_at IS NULL, last_opened_at DESC, created_at DESC"
            ).fetchall()
        return [DocumentRow(**dict(r)) for r in rows]

    def set_title(self, doc_id: str, title: str) -> None:
        with self._tx() as c:
            c.execute("UPDATE documents SET title = ? WHERE id = ?", (title, doc_id))

    def touch_opened(self, doc_id: str) -> str:
        now = utc_now()
        with self._tx() as c:
            c.execute("UPDATE documents SET last_opened_at = ? WHERE id = ?", (now, doc_id))
        return now

    def delete_document(self, doc_id: str) -> list[tuple[str, str]]:
        """Delete the document row; returns (key, ext) of its cached audio so files can be removed."""
        with self._tx() as c:
            files = c.execute("SELECT key, ext FROM audio_cache WHERE doc_id = ?", (doc_id,)).fetchall()
            c.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        return [(r["key"], r["ext"]) for r in files]

    # progress
    def get_progress(self, doc_id: str) -> ProgressRow | None:
        with self._tx() as c:
            r = c.execute(
                "SELECT block_index, word_index, word_ordinal, updated_at FROM progress WHERE doc_id = ?", (doc_id,)
            ).fetchone()
        return ProgressRow(**dict(r)) if r else None

    def put_progress(self, doc_id: str, block_index: int, word_index: int, word_ordinal: int) -> ProgressRow:
        row = ProgressRow(block_index, word_index, word_ordinal, utc_now())
        with self._tx() as c:
            c.execute(
                "INSERT INTO progress VALUES (?,?,?,?,?) ON CONFLICT(doc_id) DO UPDATE SET "
                "block_index = excluded.block_index, word_index = excluded.word_index, "
                "word_ordinal = excluded.word_ordinal, updated_at = excluded.updated_at",
                (doc_id, row.block_index, row.word_index, row.word_ordinal, row.updated_at),
            )
        return row

    # settings
    def get_setting(self, key: str) -> Any:
        with self._tx() as c:
            r = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(r["value"]) if r else None

    def get_settings(self) -> dict[str, Any]:
        with self._tx() as c:
            rows = c.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: json.loads(r["value"]) for r in rows}

    def set_settings(self, values: dict[str, Any]) -> None:
        with self._tx() as c:
            for key, value in values.items():
                if value is None:
                    c.execute("DELETE FROM settings WHERE key = ?", (key,))
                else:
                    c.execute(
                        "INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (key, json.dumps(value)),
                    )

    # synthesis statistics
    def add_synth_stats(self, engine: str, voice: str, seconds: float, words: int) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT INTO synth_stats VALUES (?,?,?,?) ON CONFLICT(engine, voice) DO UPDATE SET "
                "seconds = seconds + excluded.seconds, words = words + excluded.words",
                (engine, voice, seconds, words),
            )

    def seconds_per_word(self, engine: str, voice: str) -> float | None:
        """Measured seconds per word for this voice, else for the engine as a whole."""
        with self._tx() as c:
            r = c.execute(
                "SELECT SUM(seconds) s, SUM(words) w FROM synth_stats WHERE engine = ? AND voice = ?",
                (engine, voice),
            ).fetchone()
            if not r["w"]:
                r = c.execute(
                    "SELECT SUM(seconds) s, SUM(words) w FROM synth_stats WHERE engine = ?", (engine,)
                ).fetchone()
        return r["s"] / r["w"] if r["w"] else None

    # audio cache index
    def add_audio(self, key: str, doc_id: str | None, engine: str, voice: str,
                  block_index: int | None, ext: str) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT OR REPLACE INTO audio_cache VALUES (?,?,?,?,?,?)",
                (key, doc_id, engine, voice, block_index, ext),
            )

    def cached_block_count(self, doc_id: str, engine: str, voice: str) -> int:
        with self._tx() as c:
            r = c.execute(
                "SELECT COUNT(DISTINCT block_index) n FROM audio_cache WHERE doc_id = ? AND engine = ? AND voice = ?",
                (doc_id, engine, voice),
            ).fetchone()
        return int(r["n"])
