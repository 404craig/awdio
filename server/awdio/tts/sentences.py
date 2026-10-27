"""Conservative sentence splitting of single-spaced block text, for sentence-by-sentence synthesis."""

from __future__ import annotations

import re

MIN_SENTENCE_WORDS = 4
LONG_SENTENCE_WORDS = 40  # longer sentences are also split at ";" / ":" so pre-emption points stay close
MIN_CLAUSE_WORDS = 8

# Words that end with a period without ending a sentence (compared lower-case, without the final period).
_ABBREVIATIONS = {
    "mr",
    "mrs",
    "ms",
    "mx",
    "dr",
    "prof",
    "st",
    "sr",
    "jr",
    "rev",
    "hon",
    "gen",
    "col",
    "capt",
    "lt",
    "sgt",
    "mt",
    "ft",
    "no",
    "nos",
    "vol",
    "vols",
    "fig",
    "figs",
    "ch",
    "chap",
    "sec",
    "pp",
    "p",
    "ed",
    "eds",
    "est",
    "vs",
    "etc",
    "cf",
    "approx",
    "ca",
    "inc",
    "ltd",
    "co",
    "corp",
    "dept",
    "univ",
    "assn",
    "ave",
    "rd",
    "blvd",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
}
_CLOSERS = "\"'”’)]»"
_TERMINAL = re.compile(r"[.!?…]+[" + re.escape(_CLOSERS) + r"]*$")
_STARTS_SENTENCE = re.compile(r"^[\"'“‘(\[«]*[A-Z0-9À-Ý]")


def split_sentences(text: str) -> list[str]:
    """Split into sentences, each a substring of `text`; fragments under MIN_SENTENCE_WORDS words are
    merged into a neighbour. A period after an abbreviation, an initial or a dotted acronym never splits.
    Sentences over LONG_SENTENCE_WORDS words are further split after ";" or ":" when both sides keep
    at least MIN_CLAUSE_WORDS words."""
    words = text.split(" ")
    groups: list[list[str]] = [[]]
    for i, word in enumerate(words):
        groups[-1].append(word)
        if i + 1 < len(words) and _ends_sentence(word) and _STARTS_SENTENCE.match(words[i + 1]):
            groups.append([])
    merged: list[list[str]] = []
    for group in groups:
        if merged and len(merged[-1]) < MIN_SENTENCE_WORDS:
            merged[-1].extend(group)
        else:
            merged.append(group)
    if len(merged) > 1 and len(merged[-1]) < MIN_SENTENCE_WORDS:
        merged[-2].extend(merged.pop())
    return [" ".join(part) for group in merged for part in _split_long(group)]


def _split_long(words: list[str]) -> list[list[str]]:
    if len(words) <= LONG_SENTENCE_WORDS:
        return [words]
    parts: list[list[str]] = [[]]
    for i, word in enumerate(words):
        parts[-1].append(word)
        remaining = len(words) - i - 1
        if (
            word.rstrip(_CLOSERS).endswith((";", ":"))
            and len(parts[-1]) >= MIN_CLAUSE_WORDS
            and remaining >= MIN_CLAUSE_WORDS
        ):
            parts.append([])
    return parts


def _ends_sentence(word: str) -> bool:
    if not _TERMINAL.search(word):
        return False
    core = word.rstrip(_CLOSERS)
    if not core.endswith(".") or core.endswith(".."):
        return True  # ! ? … and ellipses end sentences on their own terms
    stem = core[:-1].lstrip("\"'“‘([«")
    if "." in stem:
        return False  # e.g. U.S. i.e. e.g.
    if len(stem) == 1 and stem.isalpha():
        return False  # an initial: J. K. Rowling
    return stem.lower() not in _ABBREVIATIONS
