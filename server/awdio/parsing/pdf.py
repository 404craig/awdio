"""PDF parser (PyMuPDF): rebuild headings and paragraphs from font sizes and line geometry."""

from __future__ import annotations

import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from .base import BlockKind, NoTextError, ParsedDocument, ParseError, RawBlock

MARGIN_BAND = 0.12  # top/bottom fraction of the page where running headers/footers live
RUNNING_MIN_SHARE = 0.4  # a running header/footer appears on at least this share of pages ...
RUNNING_MIN_PAGES = 3  # ... and on at least this many pages
RUNNING_Y_TOLERANCE = 0.03  # fraction of page height
HEADING_RATIO = 1.15
SMALL_RATIO = 0.85
MAX_HEADING_LEVEL = 3
MAX_HEADING_WORDS = 30
BOLD_HEADING_WORDS = 12

_SENTENCE_END = tuple('.!?:"”’)…')
_GLYPH_BULLET = re.compile(
    r"^\s*[\u2022\u25e6\u25aa\u25ab\u2023\u2043\u2219\u25cf\u25cb\u25a0\u25a1\u2013*\-\uf0b7\uf0a7]\s+"
)
_NUMBER_BULLET = re.compile(r"^\s*\d+[.)]\s+")
_PAGE_NUMBER = re.compile(
    r"^(page\s*)?(\d+|(?=[ivxlcdm])m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3}))(\s*(of|/)\s*\d+)?$",
    re.IGNORECASE,
)
_JUNK_TITLE = re.compile(r"(^microsoft (word|powerpoint) - )|(\.(docx?|pdf|tex|indd|odt|rtf)$)", re.IGNORECASE)


@dataclass
class _Row:
    """One visual line of text."""

    page: int
    text: str
    size: float
    bold: bool
    x0: float
    y0: float
    x1: float
    y1: float
    column: int = 0  # 0 = left/single, 1 = right, -1 = spans both columns

    @property
    def words(self) -> int:
        return len(self.text.split())


@dataclass
class _Block:
    kind: BlockKind
    page: int
    style: tuple[int, bool]
    rows: list[_Row] = field(default_factory=list)
    level: int | None = None

    @property
    def last(self) -> _Row:
        return self.rows[-1]

    @property
    def text(self) -> str:
        return "\n".join(r.text for r in self.rows)


def parse_pdf(path: Path) -> ParsedDocument:
    try:
        doc = pymupdf.open(path)
    except Exception as exc:  # PyMuPDF raises FileDataError/RuntimeError variants
        raise ParseError(f"not a readable PDF: {exc}") from exc
    with doc:
        if doc.needs_pass:
            raise ParseError("the PDF is password-protected")
        pdf_pages = [doc.load_page(i) for i in range(doc.page_count)]
        pages = [_page_rows(page, i) for i, page in enumerate(pdf_pages)]
        sizes = [(page.rect.width, page.rect.height) for page in pdf_pages]
        labels = [page.get_label() or str(i + 1) for i, page in enumerate(pdf_pages)]
        meta_title = (doc.metadata or {}).get("title") or None

    rows = [r for page in pages for r in page]
    if not rows:
        raise NoTextError("the PDF has no text layer (it may be scanned)")
    body = _body_size(rows)
    pages = _drop_running_lines(pages, sizes, body)
    pages = _order_pages(pages, sizes, body)
    heading_sizes = _heading_sizes([r for p in pages for r in p], body)
    blocks = _build_blocks(pages, body, heading_sizes)
    raw = _classify(blocks, heading_sizes)
    if meta_title and _JUNK_TITLE.search(meta_title.strip()):
        meta_title = None
    return ParsedDocument("pdf", raw, metadata_title=meta_title, page_labels=labels)


# --- extraction ------------------------------------------------------------------------------


def _page_rows(page: pymupdf.Page, index: int) -> list[_Row]:
    rows: list[_Row] = []
    data = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    for block in data["blocks"]:
        for line in block.get("lines", []):
            if abs(line["dir"][1]) > 0.1:  # rotated / vertical text
                continue
            spans = [s for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue
            weight: Counter[float] = Counter()
            for s in spans:
                weight[round(s["size"] * 2) / 2] += len(s["text"].strip())
            x0, y0, x1, y1 = line["bbox"]
            rows.append(
                _Row(
                    page=index,
                    text="".join(s["text"] for s in line["spans"]).strip(),
                    size=weight.most_common(1)[0][0],
                    bold=all(_is_bold(s) for s in spans),
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                )
            )
    return rows


def _is_bold(span: dict) -> bool:
    font = span["font"].lower()
    return bool(span["flags"] & 16) or any(w in font for w in ("bold", "black", "heavy", "semibold"))


def _body_size(rows: list[_Row]) -> float:
    weight: Counter[float] = Counter()
    for r in rows:
        weight[r.size] += len(r.text)
    return weight.most_common(1)[0][0]


# --- running headers / footers ---------------------------------------------------------------


def _running_key(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", text.lower())).strip()


def _in_margin(row: _Row, height: float) -> bool:
    return row.y1 < height * MARGIN_BAND or row.y0 > height * (1 - MARGIN_BAND)


def _drop_running_lines(pages: list[list[_Row]], sizes: list[tuple[float, float]], body: float) -> list[list[_Row]]:
    candidates: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for rows in pages:
        for r in rows:
            height = sizes[r.page][1]
            if _in_margin(r, height) and r.size < body * HEADING_RATIO:
                candidates[_running_key(r.text)].append((r.page, (r.y0 + r.y1) / 2 / height))

    needed = max(RUNNING_MIN_PAGES, RUNNING_MIN_SHARE * len(pages))
    running: dict[str, float] = {}
    for key, hits in candidates.items():
        centre = statistics.median(y for _, y in hits)
        on_pages = {page for page, y in hits if abs(y - centre) <= RUNNING_Y_TOLERANCE}
        if len(on_pages) >= needed:
            running[key] = centre

    def keep(r: _Row) -> bool:
        height = sizes[r.page][1]
        if not _in_margin(r, height):
            return True
        if _PAGE_NUMBER.match(r.text.strip()):
            return False
        centre = running.get(_running_key(r.text))
        return centre is None or abs((r.y0 + r.y1) / 2 / height - centre) > RUNNING_Y_TOLERANCE

    return [[r for r in rows if keep(r)] for rows in pages]


# --- reading order ---------------------------------------------------------------------------


def _is_two_column(rows: list[_Row], width: float, body: float) -> bool:
    body_rows = [r for r in rows if abs(r.size - body) < 0.6]
    if len(body_rows) < 6:
        return False
    mid, slack = width / 2, width * 0.02
    left = sum(1 for r in body_rows if r.x1 < mid + slack)
    right = sum(1 for r in body_rows if r.x0 > mid - slack)
    spanning = len(body_rows) - left - right
    return left >= 3 and right >= 3 and spanning <= 0.2 * len(body_rows)


def _order_pages(pages: list[list[_Row]], sizes: list[tuple[float, float]], body: float) -> list[list[_Row]]:
    flags = [_is_two_column(rows, sizes[i][0], body) for i, rows in enumerate(pages)]
    text_pages = sum(1 for rows in pages if rows)
    two_column_doc = text_pages > 0 and sum(flags) > 0.5 * text_pages
    ordered = []
    for i, rows in enumerate(pages):
        if two_column_doc and flags[i]:
            ordered.append(_two_column_order(rows, sizes[i][0]))
        else:
            ordered.append(_merge_rows(sorted(rows, key=lambda r: ((r.y0 + r.y1) / 2, r.x0))))
    return ordered


def _two_column_order(rows: list[_Row], width: float) -> list[_Row]:
    """Spanning rows (titles, footnotes) split the page into bands; each band reads left column, then right."""
    mid, slack = width / 2, width * 0.02
    for r in rows:
        r.column = 0 if r.x1 < mid + slack else 1 if r.x0 > mid - slack else -1
    out: list[_Row] = []
    band: list[_Row] = []
    for r in sorted(rows, key=lambda r: (r.y0 + r.y1) / 2):
        if r.column == -1:
            out.extend(_flush_band(band))
            band = []
            out.append(r)
        else:
            band.append(r)
    out.extend(_flush_band(band))
    return out


def _flush_band(band: list[_Row]) -> list[_Row]:
    left = _merge_rows(sorted((r for r in band if r.column == 0), key=lambda r: ((r.y0 + r.y1) / 2, r.x0)))
    right = _merge_rows(sorted((r for r in band if r.column == 1), key=lambda r: ((r.y0 + r.y1) / 2, r.x0)))
    return left + right


def _merge_rows(rows: list[_Row]) -> list[_Row]:
    """Join fragments that sit on the same visual line (e.g. separately drawn spans, list numbers)."""
    merged: list[_Row] = []
    for r in rows:
        prev = merged[-1] if merged else None
        centre = (r.y0 + r.y1) / 2
        if prev is not None and prev.y0 <= centre <= prev.y1 and r.x0 >= prev.x0:
            sep = " " if r.x0 > prev.x1 + 0.15 * r.size else ""
            text = prev.text + sep + r.text
            dominant = prev if len(prev.text) >= len(r.text) else r
            merged[-1] = _Row(
                prev.page,
                text,
                dominant.size,
                prev.bold and r.bold,
                prev.x0,
                min(prev.y0, r.y0),
                max(prev.x1, r.x1),
                max(prev.y1, r.y1),
                prev.column,
            )
        else:
            merged.append(r)
    return merged


# --- blocks ----------------------------------------------------------------------------------


def _heading_sizes(rows: list[_Row], body: float) -> list[float]:
    """Distinct heading font sizes, largest first; their position + 1 is the heading level."""
    return sorted({r.size for r in rows if r.size >= body * HEADING_RATIO}, reverse=True)


def _style(row: _Row, body: float, heading_sizes: list[float]) -> tuple[int, bool]:
    if row.size in heading_sizes:
        size_class = heading_sizes.index(row.size) + 1
    else:
        size_class = -1 if row.size < body * SMALL_RATIO else 0
    return size_class, row.bold


def _normal_gap(pages: list[list[_Row]], body: float) -> float:
    """Typical whitespace between consecutive lines of one paragraph (a low percentile of observed gaps)."""
    gaps = []
    for rows in pages:
        for a, b in zip(rows, rows[1:], strict=False):
            if a.column == b.column and abs(a.size - body) < 0.6 and abs(b.size - body) < 0.6:
                gap = b.y0 - a.y1
                if -body <= gap <= 2 * body:
                    gaps.append(gap)
    if len(gaps) < 4:
        return 0.0
    return statistics.quantiles(gaps, n=4)[0]


def _build_blocks(pages: list[list[_Row]], body: float, heading_sizes: list[float]) -> list[_Block]:
    normal_gap = _normal_gap(pages, body)
    blocks: list[_Block] = []
    for rows in pages:
        column_left: dict[int, float] = {}
        for r in rows:
            column_left[r.column] = min(column_left.get(r.column, r.x0), r.x0)
        current = blocks[-1] if blocks else None
        for i, row in enumerate(rows):
            style = _style(row, body, heading_sizes)
            prev = rows[i - 1] if i > 0 else None
            indented = row.x0 - column_left[row.column] > 0.8 * body
            bullet = _GLYPH_BULLET.match(row.text) is not None or (
                _NUMBER_BULLET.match(row.text) is not None
                and not indented
                and (current is None or current.kind == "list_item" or current.last.text.endswith(_SENTENCE_END))
            )
            if bullet:
                row.text = _GLYPH_BULLET.sub("", row.text, count=1)
                current = _Block("list_item", row.page, style, [row])
                blocks.append(current)
                continue
            if current is not None and _continues(current, row, prev, style, indented, body, normal_gap):
                current.rows.append(row)
                continue
            current = _Block("paragraph", row.page, style, [row])
            blocks.append(current)
    return blocks


def _continues(
    block: _Block, row: _Row, prev: _Row | None, style: tuple[int, bool], indented: bool, body: float, normal_gap: float
) -> bool:
    if block.style != style:
        return False
    last = block.last
    ends_sentence = last.text.endswith(_SENTENCE_END)
    if prev is None or row.y0 < last.y0 - 1:  # new page or new column: a soft break
        return not ends_sentence and not indented and block.kind != "list_item"
    gap = row.y0 - last.y1
    if gap - normal_gap > 0.5 * last.size:
        return False
    if block.kind == "list_item":
        return row.x0 > block.rows[0].x0 + 1
    return not (ends_sentence and indented)


def _classify(blocks: list[_Block], heading_sizes: list[float]) -> list[RawBlock]:
    raw: list[RawBlock] = []
    title_assigned = False
    bold_level = min(len(heading_sizes) + 1, MAX_HEADING_LEVEL)
    for b in blocks:
        size_class, bold = b.style
        words = sum(r.words for r in b.rows)
        kind: BlockKind = b.kind
        level: int | None = None
        if kind == "paragraph" and size_class >= 1 and words <= MAX_HEADING_WORDS:
            kind, level = "heading", min(size_class, MAX_HEADING_LEVEL)
            if size_class == 1 and not title_assigned and b.page <= 1:
                kind, level = "title", 1
        elif kind == "paragraph" and bold and size_class == 0 and len(b.rows) <= 2 and words <= BOLD_HEADING_WORDS:
            kind, level = "heading", bold_level
        if kind == "title" or (kind == "heading" and size_class == 1):
            title_assigned = True
        raw.append(RawBlock(kind, b.text, level=level, page=b.page))
    return raw
