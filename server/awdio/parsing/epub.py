"""EPUB parser (ebooklib + BeautifulSoup), reading content documents in spine order."""

from __future__ import annotations

import re
import warnings
from pathlib import Path

import ebooklib
from bs4 import BeautifulSoup, Comment, NavigableString, Tag, XMLParsedAsHTMLWarning
from ebooklib import epub

from .base import BlockKind, ParsedDocument, ParseError, RawBlock
from .structure import promote_title

_HEADINGS = {f"h{i}" for i in range(1, 7)}
_BLOCK_TAGS = _HEADINGS | {
    "p", "div", "section", "article", "main", "aside", "header", "footer", "figure", "figcaption",
    "li", "ul", "ol", "dl", "dt", "dd", "blockquote", "pre", "table", "thead", "tbody", "tfoot",
    "tr", "td", "th", "caption", "hr", "body",
}
_BLOCK_TAG_LIST = sorted(_BLOCK_TAGS)
_SKIP_TAGS = ["script", "style", "nav", "head", "svg", "math"]
_NAV_NAME = re.compile(r"(^|[_\-./])(toc|nav)([_\-.]|$)", re.IGNORECASE)


def parse_epub(path: Path) -> ParsedDocument:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            book = epub.read_epub(str(path), options={"ignore_ncx": True})
    except Exception as exc:  # ebooklib raises a variety of zip/xml/key errors
        raise ParseError(f"not a readable EPUB file: {exc}") from exc

    blocks: list[RawBlock] = []
    for idref, _linear in book.spine:
        item = book.get_item_with_id(idref)
        if item is None or item.get_type() != ebooklib.ITEM_DOCUMENT or _is_navigation(item):
            continue
        blocks.extend(_html_blocks(item.get_content()))

    promote_title(blocks)
    titles = book.get_metadata("DC", "title")
    return ParsedDocument("epub", blocks, metadata_title=titles[0][0] if titles else None)


def _is_navigation(item: epub.EpubItem) -> bool:
    return isinstance(item, epub.EpubNav) or "nav" in getattr(item, "properties", []) or bool(
        _NAV_NAME.search(Path(item.get_name()).stem)
    )


def _html_blocks(content: bytes) -> list[RawBlock]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(content, "lxml")
    for tag in soup.find_all(_SKIP_TAGS):
        tag.decompose()
    for br in soup.find_all("br"):
        br.replace_with(" ")
    out: list[RawBlock] = []
    _walk(soup.body or soup, None, out)
    return out


def _walk(container: Tag, kind: BlockKind | None, out: list[RawBlock]) -> None:
    """Emit one block per leaf block element; loose inline text between block children is its own paragraph."""
    inline: list[str] = []

    def flush() -> None:
        text = "".join(inline).strip()
        if text:
            out.append(RawBlock(kind or "paragraph", text))
        inline.clear()

    for child in container.children:
        if isinstance(child, Comment):
            continue
        if isinstance(child, NavigableString):
            inline.append(str(child))
        elif isinstance(child, Tag):
            if child.name in _BLOCK_TAGS:
                flush()
                _block(child, kind, out)
            else:
                inline.append(child.get_text())
    flush()


def _block(tag: Tag, kind: BlockKind | None, out: list[RawBlock]) -> None:
    if tag.name in _HEADINGS:
        out.append(RawBlock("heading", tag.get_text(), level=int(tag.name[1])))
        return
    if tag.name == "li":
        kind = "list_item"
    elif tag.name == "blockquote":
        kind = "quote"
    if tag.find(_BLOCK_TAG_LIST) is not None:
        _walk(tag, kind, out)
    else:
        out.append(RawBlock(kind or "paragraph", tag.get_text()))
