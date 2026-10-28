"""Build the compact offline English-Chinese dictionary from ECDICT.

The source CSV is not committed. See src/translation/OFFLINE_DICTIONARY.md.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*$")
CHINESE_RE = re.compile(r"[\u3400-\u9fff]")


def nonnegative_int(value: str | None) -> int:
    try:
        return max(0, int(value or 0))
    except ValueError:
        return 0


def rank_value(value: str | None) -> int:
    number = nonnegative_int(value)
    return number if number > 0 else 10**9


def compact_translation(value: str) -> str:
    lines = []
    seen = set()
    for line in value.replace("\\n", "\n").splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line or not CHINESE_RE.search(line) or line in seen:
            continue
        seen.add(line)
        lines.append(line)
    text = "；".join(line for line in lines[:4])
    return text[:320]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rank", type=int, default=60_000)
    args = parser.parse_args()

    words: dict[str, str] = {}
    with args.source.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            word = (row.get("word") or "").strip()
            if not WORD_RE.fullmatch(word):
                continue
            rank = min(rank_value(row.get("bnc")), rank_value(row.get("frq")))
            collins = nonnegative_int(row.get("collins"))
            tagged = bool((row.get("tag") or "").strip())
            oxford = (row.get("oxford") or "").strip() in {"1", "true", "True"}
            if rank > args.rank and collins < 2 and not tagged and not oxford:
                continue
            translation = compact_translation(row.get("translation") or "")
            if not translation:
                continue
            key = word.casefold()
            previous = words.get(key)
            if previous is None or len(translation) < len(previous):
                words[key] = translation

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(words, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {len(words):,} words to {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
