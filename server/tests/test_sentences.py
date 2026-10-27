from __future__ import annotations

from awdio.tts.sentences import split_sentences


def test_splits_on_sentence_punctuation_and_keeps_substrings() -> None:
    text = "The rabbit ran past her. Alice followed it at once! Would she ever get out again?"
    sentences = split_sentences(text)
    assert sentences == ["The rabbit ran past her.", "Alice followed it at once!", "Would she ever get out again?"]
    assert " ".join(sentences) == text


def test_does_not_split_abbreviations_numbers_initials_or_acronyms() -> None:
    text = "Dr. Smith paid £3.50 for two coffees at St. Pancras. J. K. Rowling met Mr. Bean in the U.S. on Monday."
    assert split_sentences(text) == [
        "Dr. Smith paid £3.50 for two coffees at St. Pancras.",
        "J. K. Rowling met Mr. Bean in the U.S. on Monday.",
    ]


def test_needs_a_capitalised_start_and_handles_quotes() -> None:
    assert split_sentences("It was 3 p.m. and dark... but then it was not dark at all.") == [
        "It was 3 p.m. and dark... but then it was not dark at all."
    ]
    assert split_sentences("“I shall be late!” said the Rabbit to itself. “Oh my ears and whiskers!”") == [
        "“I shall be late!” said the Rabbit to itself.",
        "“Oh my ears and whiskers!”",
    ]


def test_short_fragments_merge_into_a_neighbour() -> None:
    assert split_sentences("Yes. No. Perhaps it will rain later today. Fine.") == [
        "Yes. No. Perhaps it will rain later today. Fine."
    ]
    assert split_sentences("She sat down by the fire. Then she slept. The end.") == [
        "She sat down by the fire.",
        "Then she slept. The end.",
    ]
    assert split_sentences("Chapter One") == ["Chapter One"]
