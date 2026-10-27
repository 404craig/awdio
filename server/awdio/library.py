"""Document storage: original uploads, parsed structure JSON and the documents table."""

from __future__ import annotations

import json
import shutil
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

from .config import Config
from .db import Database, DocumentRow, utc_now
from .parsing import StructuredDocument, parse_document
from .parsing.base import Block, Page, SourceType

FORMAT_VERSION = 1
_MEMORY_CACHE_SIZE = 8


@dataclass(frozen=True)
class LoadedDocument:
    id: str
    source_type: SourceType
    pages: list[Page]

    @cached_property
    def blocks(self) -> list[Block]:
        return [b for p in self.pages for b in p.blocks]

    def pages_json(self) -> list[dict[str, object]]:
        return [p.to_json() for p in self.pages]


class Library:
    def __init__(self, config: Config, db: Database) -> None:
        self._config = config
        self._db = db
        self._memory: OrderedDict[str, LoadedDocument] = OrderedDict()
        self._memory_lock = threading.Lock()

    def upload_path(self, doc_id: str, source_type: SourceType) -> Path:
        return self._config.uploads_dir / f"{doc_id}.{source_type}"

    def new_id(self) -> str:
        return str(uuid.uuid4())

    def add(self, doc_id: str, source_type: SourceType, filename: str) -> DocumentRow:
        """Parse an already-saved upload and record it. Raises ParseError/NoTextError (upload is then removed)."""
        upload = self.upload_path(doc_id, source_type)
        try:
            parsed = parse_document(upload, source_type, filename)
        except Exception:
            upload.unlink(missing_ok=True)
            raise
        self._write_structure(doc_id, parsed)
        row = DocumentRow(
            id=doc_id,
            title=parsed.title,
            source_type=source_type,
            filename=filename,
            word_count=parsed.word_count,
            block_count=parsed.block_count,
            page_count=len(parsed.pages),
            created_at=utc_now(),
            last_opened_at=None,
        )
        self._db.insert_document(row)
        return row

    def load(self, doc_id: str) -> LoadedDocument:
        with self._memory_lock:
            if doc_id in self._memory:
                self._memory.move_to_end(doc_id)
                return self._memory[doc_id]
        data = json.loads((self._config.docs_dir / doc_id / "document.json").read_text())
        pages = [
            Page(
                p["index"],
                p["label"],
                [
                    Block(b["index"], b["kind"], b["level"], b["text"], b["wordCount"], b["wordStart"])
                    for b in p["blocks"]
                ],
            )
            for p in data["pages"]
        ]
        doc = LoadedDocument(doc_id, data["sourceType"], pages)
        with self._memory_lock:
            self._memory[doc_id] = doc
            while len(self._memory) > _MEMORY_CACHE_SIZE:
                self._memory.popitem(last=False)
        return doc

    def delete_files(self, doc_id: str, source_type: str) -> None:
        with self._memory_lock:
            self._memory.pop(doc_id, None)
        (self._config.uploads_dir / f"{doc_id}.{source_type}").unlink(missing_ok=True)
        shutil.rmtree(self._config.docs_dir / doc_id, ignore_errors=True)

    def _write_structure(self, doc_id: str, parsed: StructuredDocument) -> None:
        directory = self._config.docs_dir / doc_id
        directory.mkdir(parents=True, exist_ok=True)
        data = {
            "version": FORMAT_VERSION,
            "sourceType": parsed.source_type,
            "pages": [p.to_json() for p in parsed.pages],
        }
        tmp = directory / "document.json.tmp"
        tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        tmp.replace(directory / "document.json")
