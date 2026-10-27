"""Shared structure heuristics: text normalisation, heading fallback, titles and paging."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .base import Block, NoTextError, Page, ParsedDocument, RawBlock, StructuredDocument

PAGE_TARGET_WORDS = 450
CHAPTER_BREAK_MIN_WORDS = 150

_LIGATURES = str.maketrans({"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"})
_INVISIBLE = re.compile("[­​‌‍⁠﻿‎‏]")
_LINE_HYPHEN_LOWER = re.compile(r"\b([A-Za-z][a-z]*)-[ \t]*\n\s*([a-z]+)\b")
_LINE_HYPHEN_OTHER = re.compile(r"(\w)-[ \t]*\n\s*(?=\w)")
_WHITESPACE = re.compile(r"\s+")
_HEADING_WORDS = re.compile(r"^(chapter|part|book|section|prologue|epilogue|appendix)\b", re.IGNORECASE)
_SMALL_WORDS = {"a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of",
                "on", "or", "the", "to", "with", "vs", "via", "over", "up", "upon"}


def normalize_text(raw: str) -> str:
    """NFC, strip control/invisible characters, repair line-end hyphenation, collapse whitespace."""
    text = unicodedata.normalize("NFC", raw).translate(_LIGATURES)
    text = _INVISIBLE.sub("", text)
    text = _LINE_HYPHEN_LOWER.sub(r"\1\2", text)
    text = _LINE_HYPHEN_OTHER.sub(r"\1-", text)
    text = "".join(" " if unicodedata.category(ch) in ("Cc", "Zl", "Zp") else ch for ch in text)
    return _WHITESPACE.sub(" ", text).strip()


def is_chapter_line(line: str) -> bool:
    """Short line starting with chapter/part/book/...; a terminal period is allowed only on
    very short lines such as "CHAPTER I." so that prose like "Part of it was mine." is not a heading."""
    words = line.split()
    if not words or len(words) > 12 or _HEADING_WORDS.match(line) is None:
        return False
    return line[-1] not in ".,;:" or len(words) <= 3


def fallback_heading_level(line: str) -> int | None:
    """Heading rule for text without layout cues; `line` is already its own paragraph.

    Chapter-like lines get level 1, other ALL CAPS / Title Case lines level 2; None means not a heading.
    """
    words = line.split()
    if not words or len(words) > 12:
        return None
    if is_chapter_line(line):
        return 1
    return 2 if _looks_like_heading(line, words) else None


def _looks_like_heading(line: str, words: list[str]) -> bool:
    if line[-1] in ".,;:" or not any(ch.isalpha() for ch in line):
        return False
    letters = [ch for ch in line if ch.isalpha()]
    if len(letters) >= 2 and all(ch.isupper() for ch in letters):
        return True
    return len(words) >= 2 and _is_title_case(words)


def _is_title_case(words: list[str]) -> bool:
    alpha = [w.strip("\"'“”‘’()[]!?") for w in words]
    alpha = [w for w in alpha if w and w[0].isalpha()]
    if not alpha or not alpha[0][0].isupper():
        return False
    return all(w[0].isupper() or w.lower() in _SMALL_WORDS for w in alpha)


def promote_title(blocks: list[RawBlock]) -> None:
    """A leading heading whose level is not repeated later becomes the document's title block."""
    first = next((b for b in blocks if normalize_text(b.text)), None)
    if first is None or first.kind != "heading" or first.level is None:
        return
    later = [b.level for b in blocks if b is not first and b.kind in ("heading", "title") and b.level is not None]
    if all(level > first.level for level in later):
        first.kind = "title"
        first.level = 1


def prettify_stem(filename: str) -> str:
    stem = _WHITESPACE.sub(" ", re.sub(r"[_\-.]+", " ", Path(filename).stem)).strip()
    if not stem:
        return "Untitled"
    return stem[0].upper() + stem[1:] if stem.islower() else stem


def _clean_title(title: str | None) -> str | None:
    if not title:
        return None
    t = normalize_text(title)
    return t if t and t.lower() not in {"untitled", "unknown"} else None


def finalize(parsed: ParsedDocument, filename: str) -> StructuredDocument:
    """Normalise block text, drop empty blocks, assign global indices and word ordinals, and build pages."""
    blocks: list[tuple[RawBlock, str]] = []
    for raw in parsed.blocks:
        text = normalize_text(raw.text)
        if text:
            blocks.append((raw, text))
    if not blocks:
        raise NoTextError("no readable text found")

    built: list[tuple[Block, int | None]] = []
    ordinal = 0
    for index, (raw, text) in enumerate(blocks):
        count = len(text.split(" "))
        level = raw.level if raw.kind in ("title", "heading") else None
        built.append((Block(index, raw.kind, level, text, count, ordinal), raw.page))
        ordinal += count

    if parsed.source_type == "pdf":
        pages = _real_pages(built, parsed.page_labels)
    else:
        pages = _synthetic_pages([b for b, _ in built])

    title_block = next((b.text for b, _ in built if b.kind == "title"), None)
    title = _clean_title(parsed.metadata_title) or title_block or prettify_stem(filename)
    return StructuredDocument(title=title, source_type=parsed.source_type, pages=pages)


def _real_pages(built: list[tuple[Block, int | None]], labels: list[str]) -> list[Page]:
    by_page: dict[int, list[Block]] = {}
    for block, page in built:
        by_page.setdefault(page or 0, []).append(block)
    pages = []
    for i, real in enumerate(sorted(by_page)):
        label = labels[real] if real < len(labels) and labels[real] else str(real + 1)
        pages.append(Page(i, label, by_page[real]))
    return pages


def _synthetic_pages(blocks: list[Block]) -> list[Page]:
    chapter_level = _chapter_level(blocks)
    groups: list[list[Block]] = []
    chapters: list[int] = []
    chapter = 0
    words = 0
    for block in blocks:
        starts_chapter = chapter_level is not None and block.kind == "heading" and block.level == chapter_level
        major = block.kind == "title" or (block.kind == "heading" and (block.level or 9) <= 2)
        if groups and (words >= PAGE_TARGET_WORDS or (major and words > CHAPTER_BREAK_MIN_WORDS)):
            groups.append([])
            chapters.append(chapter + 1 if starts_chapter else chapter)
            words = 0
        elif not groups:
            groups.append([])
            chapters.append(1 if starts_chapter else 0)
        if starts_chapter:
            chapter += 1
        groups[-1].append(block)
        words += block.word_count

    pages = []
    within: dict[int, int] = {}
    for i, (group, ch) in enumerate(zip(groups, chapters, strict=True)):
        within[ch] = within.get(ch, 0) + 1
        label = f"Ch. {ch} · {within[ch]}" if ch > 0 else str(within[ch])
        pages.append(Page(i, label, group))
    return pages


def _chapter_level(blocks: list[Block]) -> int | None:
    """Level of the headings that delimit chapters: the top heading level, if it is 1 or 2."""
    levels = [b.level for b in blocks if b.kind == "heading" and b.level is not None]
    top = min(levels, default=None)
    return top if top is not None and top <= 2 else None
