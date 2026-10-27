"""Types shared by all parsers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SourceType = Literal["pdf", "epub", "docx", "txt", "md"]
BlockKind = Literal["title", "heading", "paragraph", "list_item", "quote"]


class ParseError(Exception):
    """The file could not be read as the declared format."""


class NoTextError(ParseError):
    """The file was readable but contained no extractable text (e.g. a scanned PDF)."""


@dataclass
class RawBlock:
    """A block as emitted by a format parser; `text` may still contain raw whitespace and line breaks."""

    kind: BlockKind
    text: str
    level: int | None = None
    page: int | None = None  # real page index (PDF only)


@dataclass
class ParsedDocument:
    source_type: SourceType
    blocks: list[RawBlock]
    metadata_title: str | None = None
    page_labels: list[str] = field(default_factory=list)  # PDF only: printed label per real page


@dataclass(frozen=True)
class Block:
    index: int
    kind: BlockKind
    level: int | None
    text: str
    word_count: int
    word_start: int

    def to_json(self) -> dict[str, object]:
        return {
            "index": self.index,
            "kind": self.kind,
            "level": self.level,
            "text": self.text,
            "wordCount": self.word_count,
            "wordStart": self.word_start,
        }


@dataclass(frozen=True)
class Page:
    index: int
    label: str
    blocks: list[Block]

    def to_json(self) -> dict[str, object]:
        return {"index": self.index, "label": self.label, "blocks": [b.to_json() for b in self.blocks]}


@dataclass(frozen=True)
class StructuredDocument:
    title: str
    source_type: SourceType
    pages: list[Page]

    @property
    def blocks(self) -> list[Block]:
        return [b for p in self.pages for b in p.blocks]

    @property
    def word_count(self) -> int:
        return sum(b.word_count for p in self.pages for b in p.blocks)

    @property
    def block_count(self) -> int:
        return sum(len(p.blocks) for p in self.pages)
