from __future__ import annotations

from pathlib import Path

import pytest

from awdio.parsing import NoTextError, ParseError, StructuredDocument, detect_source_type, parse_document

from . import corpus
from .conftest import assert_document_invariants


def parse(path: Path) -> StructuredDocument:
    source_type = detect_source_type(path.name, None)
    assert source_type is not None
    return parse_document(path, source_type, path.name)


def as_json(doc: StructuredDocument) -> dict:
    return {
        "pages": [p.to_json() for p in doc.pages],
        "wordCount": doc.word_count,
        "blockCount": doc.block_count,
        "pageCount": len(doc.pages),
    }


def kinds(doc: StructuredDocument) -> list[tuple[str, str]]:
    return [(b.kind, b.text) for b in doc.blocks]


@pytest.mark.parametrize("name", ["alice.pdf", "pride.docx", "pride.epub", "pride.txt", "pride.md"])
def test_contract_invariants(fixtures_dir: Path, name: str) -> None:
    assert_document_invariants(as_json(parse(fixtures_dir / name)))


def test_pdf_structure(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "alice.pdf")
    assert doc.title == corpus.ALICE_TITLE
    blocks = doc.blocks
    assert blocks[0].kind == "title" and blocks[0].text == corpus.ALICE_TITLE

    headings = [b.text for b in blocks if b.kind == "heading"]
    assert headings == [h for h, _ in corpus.ALICE]
    assert {b.level for b in blocks if b.kind == "heading"} == {2}

    paragraphs = [b.text for b in blocks if b.kind == "paragraph"]
    expected = [corpus.ascii_quotes(p) for _, paras in corpus.ALICE for p in paras]
    assert paragraphs == expected  # nothing lost or duplicated, cross-page paragraph re-joined
    assert [b.text for b in blocks if b.kind == "list_item"] == corpus.ALICE_BULLETS


def test_pdf_removes_running_header_and_page_numbers(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "alice.pdf")
    texts = [b.text for b in doc.blocks]
    assert texts.count(corpus.RUNNING_HEADER) == 1  # only the real title block remains
    assert not any(t.isdigit() for t in texts)


def test_pdf_repairs_hyphenation(fixtures_dir: Path) -> None:
    first = parse(fixtures_dir / "alice.pdf").blocks[2].text
    assert first.count(corpus.HYPHENATED_WORD) == 2
    assert "conver-" not in first


def test_pdf_pages_keep_printed_labels(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "alice.pdf")
    assert [p.label for p in doc.pages] == ["i", "1", "2", "3"]
    long_paragraph = next(b for b in doc.blocks if b.text.startswith("There was nothing"))
    assert long_paragraph in doc.pages[0].blocks  # a paragraph continued over a page break stays on its first page


def test_pdf_without_text_layer(fixtures_dir: Path) -> None:
    with pytest.raises(NoTextError):
        parse(fixtures_dir / "blank.pdf")


def test_corrupt_files_raise_parse_error(tmp_path: Path) -> None:
    for name in ("broken.pdf", "broken.docx", "broken.epub"):
        path = tmp_path / name
        path.write_bytes(b"this is not really a document")
        with pytest.raises(ParseError):
            parse(path)


def test_docx_styles(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "pride.docx")
    assert doc.title == corpus.PRIDE_TITLE
    blocks = doc.blocks
    assert (blocks[0].kind, blocks[0].text) == ("title", corpus.PRIDE_TITLE)
    assert [(b.text, b.level) for b in blocks if b.kind == "heading"] == [("Chapter 1", 1), ("Chapter 2", 1)]
    assert [b.text for b in blocks if b.kind == "paragraph"][
        : len(corpus.pride_paragraphs())
    ] == corpus.pride_paragraphs()
    assert [b.text for b in blocks if b.kind == "quote"] == [corpus.PRIDE_QUOTE]
    assert [b.text for b in blocks if b.kind == "list_item"] == corpus.PRIDE_LIST
    assert [b.text for b in blocks][-2:] == ["Longbourn", "Netherfield"]  # table cells, row by row


def test_epub_chapters_in_spine_order(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "pride.epub")
    assert doc.title == corpus.PRIDE_TITLE  # package <dc:title>
    blocks = doc.blocks
    assert [(b.text, b.level) for b in blocks if b.kind == "heading"] == [("Chapter 1", 1), ("Chapter 2", 1)]
    assert [
        b.text for b in blocks if b.kind == "paragraph" and b.text in corpus.pride_paragraphs()
    ] == corpus.pride_paragraphs()
    assert [b.text for b in blocks if b.kind == "quote"] == [corpus.PRIDE_QUOTE]
    assert [b.text for b in blocks if b.kind == "list_item"] == corpus.PRIDE_LIST
    assert "Kitty and Lydia" in [b.text for b in blocks]  # <br> becomes a space
    assert not any("hidden" in b.text for b in blocks)  # <script> skipped
    assert not any(b.text == "Chapter 1 Chapter 2" for b in blocks)  # nav document skipped
    assert doc.pages[0].label == "Ch. 1 · 1"


def test_txt_headings_and_joined_lines(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "pride.txt")
    blocks = doc.blocks
    assert (blocks[0].kind, blocks[0].text) == ("title", corpus.PRIDE_TITLE.upper())
    assert doc.title == corpus.PRIDE_TITLE.upper()
    assert [b.text for b in blocks if b.kind == "heading" and b.level == 1] == ["Chapter 1", "Chapter 2"]
    assert [b.text for b in blocks if b.kind == "paragraph"] == corpus.pride_paragraphs()


def test_md_markup(fixtures_dir: Path) -> None:
    doc = parse(fixtures_dir / "pride.md")
    blocks = doc.blocks
    assert (blocks[0].kind, blocks[0].text) == ("title", corpus.PRIDE_TITLE)
    assert [(b.text, b.level) for b in blocks if b.kind == "heading"] == [("Chapter 1", 2), ("Chapter 2", 2)]
    assert blocks[1].text == "By Jane Austen"
    assert [b.text for b in blocks if b.kind == "quote"] == [corpus.PRIDE_QUOTE]
    assert [b.text for b in blocks if b.kind == "list_item"] == [f"{n} Bennet" for n in corpus.PRIDE_LIST]
    assert blocks[-1].text == "See the novel and chapter_one."


def test_title_falls_back_to_prettified_filename(tmp_path: Path) -> None:
    path = tmp_path / "my_reading-notes.txt"
    path.write_text("just a plain paragraph of notes, nothing more.\n")
    assert parse(path).title == "My reading notes"


def test_detect_source_type() -> None:
    assert detect_source_type("Book.EPUB", None) == "epub"
    assert detect_source_type("notes.markdown", None) == "md"
    assert detect_source_type("download", "application/pdf") == "pdf"
    assert detect_source_type("image.png", "image/png") is None
