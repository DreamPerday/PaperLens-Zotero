"""Build a compact conference ranking index from CCFDDL's public catalog."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8"))
    entries = []
    for item in source:
        rank = item.get("rank") or {}
        ccf, core = rank.get("ccf") or "", rank.get("core") or ""
        if not ccf and not core:
            continue
        entries.append({
            "acronym": item.get("title") or "",
            "name": item.get("description") or "",
            "ccf": ccf,
            "core": core,
            "key": item.get("conference_key") or item.get("dblp") or "",
        })
    entries.sort(key=lambda entry: (entry["acronym"].lower(), entry["name"].lower()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(entries)} ranked conferences to {args.output}")


if __name__ == "__main__":
    main()
