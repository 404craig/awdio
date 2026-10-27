from __future__ import annotations

from awdio.parsing.base import ParsedDocument, RawBlock
from awdio.parsing.structure import fallback_heading_level, finalize, normalize_text, prettify_stem


def test_normalize_whitespace_and_invisible_characters() -> None:
    assert normalize_text("  Hello,\t\tworld\n\nagain  ") == "Hello, world again"
    assert normalize_text("co­operate ​now please") == "cooperate now please"
    assert normalize_text("the ﬁrst ﬂight") == "the first flight"
    assert normalize_text("Café") == "Café"


def test_normalize_repairs_line_end_hyphenation_only_for_lowercase_words() -> None:
    assert normalize_text("an exam-\nple of it") == "an example of it"
    assert normalize_text("Exam-\n ple") == "Example"
    assert normalize_text("the Anglo-\nSaxon world") == "the Anglo-Saxon world"
    assert normalize_text("in 1914-\n1918") == "in 1914-1918"
    assert normalize_text("a well- known fact") == "a well- known fact"  # no line break: untouched


def test_fallback_heading_rule() -> None:
    assert fallback_heading_level("CHAPTER I.") == 1
    assert fallback_heading_level("Chapter 12: The Return") == 1
    assert fallback_heading_level("THE END OF THE BEGINNING") == 2
    assert fallback_heading_level("Down the Rabbit-Hole") == 2
    assert fallback_heading_level("Who Stole the Tarts?") == 2
    assert fallback_heading_level("Part of it was mine, and part was hers.") is None
    assert fallback_heading_level("It was a dark night.") is None
    assert fallback_heading_level("A Title Case Line That Goes On For Far Too Many Words To Be A Heading") is None


def test_prettify_stem() -> None:
    assert prettify_stem("pride_and_prejudice.epub") == "Pride and prejudice"
    assert prettify_stem("Annual-Report.2024.pdf") == "Annual Report 2024"
    assert prettify_stem("___.txt") == "Untitled"


def _words(n: int, word: str = "word") -> str:
    return " ".join([word] * n)


def test_synthetic_pages_never_split_blocks_and_break_on_chapters() -> None:
    blocks = [RawBlock("heading", "Chapter 1", level=1)]
    blocks += [RawBlock("paragraph", _words(100)) for _ in range(6)]  # 600 words → two pages
    blocks += [RawBlock("heading", "Chapter 2", level=1), RawBlock("paragraph", _words(50))]
    blocks += [RawBlock("heading", "Chapter 3", level=1), RawBlock("paragraph", _words(50))]
    doc = finalize(ParsedDocument("md", blocks), "book.md")
    sizes = [sum(b.word_count for b in p.blocks) for p in doc.pages]
    # ≥450 words closes page 1; chapter 2 joins page 2 (only 100 words so far); chapter 3 opens page 3 (>150)
    assert sizes == [502, 152, 52]
    assert [p.label for p in doc.pages] == ["Ch. 1 · 1", "Ch. 1 · 2", "Ch. 3 · 1"]
    assert all(len(p.blocks) > 0 for p in doc.pages)


def test_pages_without_chapters_use_plain_numbers() -> None:
    blocks = [RawBlock("paragraph", _words(300)) for _ in range(4)]
    doc = finalize(ParsedDocument("txt", blocks), "notes.txt")
    assert [p.label for p in doc.pages] == ["1", "2"]


def test_finalize_drops_empty_blocks_and_numbers_words_globally() -> None:
    blocks = [RawBlock("paragraph", "  "), RawBlock("paragraph", "one two"), RawBlock("paragraph", "\n"),
              RawBlock("list_item", "three  four\nfive")]
    doc = finalize(ParsedDocument("txt", blocks), "x.txt")
    assert [(b.index, b.text, b.word_count, b.word_start) for b in doc.blocks] == [
        (0, "one two", 2, 0), (1, "three four five", 3, 2)]
