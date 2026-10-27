"""Document parsing: format detection, per-format parsers and shared structure finalisation."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from pathlib import Path

from .base import NoTextError, ParsedDocument, ParseError, SourceType, StructuredDocument
from .docx import parse_docx
from .epub import parse_epub
from .pdf import parse_pdf
from .structure import finalize
from .text import parse_md, parse_txt

__all__ = ["NoTextError", "ParseError", "StructuredDocument", "detect_source_type", "parse_document"]

log = logging.getLogger(__name__)

_EXTENSIONS: dict[str, SourceType] = {
    ".pdf": "pdf",
    ".epub": "epub",
    ".docx": "docx",
    ".txt": "txt",
    ".text": "txt",
    ".md": "md",
    ".markdown": "md",
}
_MIME_TYPES: dict[str, SourceType] = {
    "application/pdf": "pdf",
    "application/epub+zip": "epub",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/x-markdown": "md",
}
_PARSERS: dict[SourceType, Callable[[Path], ParsedDocument]] = {
    "pdf": parse_pdf,
    "epub": parse_epub,
    "docx": parse_docx,
    "txt": parse_txt,
    "md": parse_md,
}


def detect_source_type(filename: str, content_type: str | None) -> SourceType | None:
    """The extension decides; the MIME type is the fallback for files without a known extension."""
    by_ext = _EXTENSIONS.get(Path(filename).suffix.lower())
    if by_ext is not None:
        return by_ext
    mime = (content_type or "").split(";")[0].strip().lower()
    return _MIME_TYPES.get(mime)


def parse_document(path: Path, source_type: SourceType, filename: str) -> StructuredDocument:
    """Parse and structure a file. Raises NoTextError, or ParseError for anything unreadable."""
    started = time.perf_counter()
    try:
        document = finalize(_PARSERS[source_type](path), filename)
    except ParseError:
        raise
    except Exception as exc:  # a heuristic tripping over an unusual file must not become a 500
        log.exception("unexpected failure while parsing a %s file", source_type)
        raise ParseError(f"could not analyse this {source_type.upper()} file") from exc
    log.info(
        "parsed %s: %d pages, %d blocks, %d words in %.2fs",
        source_type,
        len(document.pages),
        document.block_count,
        document.word_count,
        time.perf_counter() - started,
    )
    return document
