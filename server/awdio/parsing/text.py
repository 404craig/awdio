"""Plain text and Markdown parsers."""

from __future__ import annotations

import re
from pathlib import Path

from .base import ParsedDocument, ParseError, RawBlock
from .structure import fallback_heading_level, is_chapter_line, normalize_text, promote_title

_BLANK_SPLIT = re.compile(r"\n[ \t]*\n+")


def read_text_file(path: Path) -> str:
    data = path.read_bytes()
    if b"\x00" in data[:4096]:
        raise ParseError("file looks binary, not text")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding).replace("\r\n", "\n").replace("\r", "\n")
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1").replace("\r\n", "\n").replace("\r", "\n")


def parse_txt(path: Path) -> ParsedDocument:
    blocks: list[RawBlock] = []
    for para in _BLANK_SPLIT.split(read_text_file(path)):
        lines = [ln.strip() for ln in para.split("\n") if ln.strip()]
        if not lines:
            continue
        joined = normalize_text("\n".join(lines))
        if len(lines) == 1 and (level := fallback_heading_level(joined)) is not None:
            blocks.append(RawBlock("heading", joined, level=level))
        elif (
            len(lines) == 2 and is_chapter_line(lines[0]) and len(joined.split(" ")) <= 12
        ):  # "CHAPTER I." / "Down the Rabbit-Hole"
            blocks.append(RawBlock("heading", joined, level=1))
        else:
            blocks.append(RawBlock("paragraph", "\n".join(lines)))
    first = blocks[0] if blocks else None
    if first is not None and first.kind == "heading" and not is_chapter_line(first.text):
        first.kind, first.level = "title", 1
    return ParsedDocument("txt", blocks)


# --- Markdown -------------------------------------------------------------------------------

_ATX = re.compile(r"^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_SETEXT = re.compile(r"^ {0,3}(=+|-+)\s*$")
_HR = re.compile(r"^ {0,3}([-*_])(\s*\1){2,}\s*$")
_LIST = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
_QUOTE = re.compile(r"^ {0,3}>\s?(.*)$")
_FENCE = re.compile(r"^ {0,3}(```|~~~)")
_REF_DEF = re.compile(r"^ {0,3}\[[^\]]+\]:\s*\S+")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")

_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\](\([^)]*\)|\[[^\]]*\])")
_AUTOLINK = re.compile(r"<((?:https?|mailto):[^>]+)>")
_HTML_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_EMPHASIS = re.compile(r"(?<![\w*])(\*{1,3}|_{1,3})(?=\S)(.+?)(?<=\S)\1(?![\w*])")
_STRIKE = re.compile(r"~~(.+?)~~")
_CODE = re.compile(r"`+([^`]*)`+")


def strip_inline_markdown(text: str) -> str:
    text = _IMAGE.sub(r"\1", text)
    text = _LINK.sub(r"\1", text)
    text = _AUTOLINK.sub(r"\1", text)
    text = _CODE.sub(r"\1", text)
    text = _HTML_TAG.sub("", text)
    text = _STRIKE.sub(r"\1", text)
    for _ in range(3):  # nested emphasis such as ***bold italic*** or **_mixed_**
        text = _EMPHASIS.sub(r"\2", text)
    return text.replace("\\", "")


def parse_md(path: Path) -> ParsedDocument:
    lines = read_text_file(path).split("\n")
    lines = _skip_front_matter(lines)
    blocks: list[RawBlock] = []
    buf: list[str] = []
    buf_kind = "paragraph"

    def flush() -> None:
        nonlocal buf, buf_kind
        text = strip_inline_markdown("\n".join(buf)).strip()
        if text:
            blocks.append(RawBlock(buf_kind, text))  # type: ignore[arg-type]
        buf, buf_kind = [], "paragraph"

    in_fence = False
    for i, line in enumerate(lines):
        if _FENCE.match(line):
            flush()
            in_fence = not in_fence
            continue
        if in_fence:
            buf.append(line)
            continue
        if not line.strip():
            flush()
            continue
        if (m := _ATX.match(line)) is not None:
            flush()
            blocks.append(RawBlock("heading", strip_inline_markdown(m.group(2)), level=len(m.group(1))))
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if buf_kind == "paragraph" and not buf and _SETEXT.match(nxt) and not _LIST.match(line):
            blocks.append(
                RawBlock("heading", strip_inline_markdown(line.strip()), level=1 if nxt.strip().startswith("=") else 2)
            )
            continue
        if _SETEXT.match(line) and blocks and blocks[-1].kind == "heading" and not buf:
            continue  # the underline of a setext heading
        if _HR.match(line) or _REF_DEF.match(line) or _TABLE_SEP.match(line):
            flush()
            continue
        if (m := _QUOTE.match(line)) is not None:
            if buf_kind != "quote":
                flush()
                buf_kind = "quote"
            buf.append(m.group(1))
            continue
        if (m := _LIST.match(line)) is not None:
            flush()
            buf_kind = "list_item"
            marker = m.group(2)
            buf.append(m.group(3) if marker in "-*+" else f"{marker} {m.group(3)}")
            continue
        if line.lstrip().startswith("|"):
            flush()
            buf.append(" ".join(cell.strip() for cell in line.strip().strip("|").split("|")))
            flush()
            continue
        if buf_kind == "quote":
            flush()
        buf.append(line.strip())
    flush()
    promote_title(blocks)
    return ParsedDocument("md", blocks)


def _skip_front_matter(lines: list[str]) -> list[str]:
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                return lines[i + 1 :]
    return lines
