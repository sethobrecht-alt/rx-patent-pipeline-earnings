#!/usr/bin/env python3
"""
build_pipeline_data.py -- Specialty Pipeline page data builder.

Unlike build_data.py (which merges live FDA Orange Book / Purple Book data
with a curated overlay), there is no live public database of *unapproved*
drugs to pull from -- a drug in Phase 3 trials isn't in the Orange Book or
Purple Book yet. So this script simply validates and republishes
scripts/curated_pipeline.json as site/data/pipeline.json for the front end
to read. It exists as its own script (rather than folding into
build_data.py) so the "no live source, needs periodic manual/AI research
refresh" nature of this data stays obvious and separate from the FDA
pipeline's automation story.

Run this after editing scripts/curated_pipeline.json to add, update, or
remove a pipeline drug (e.g. once it's approved, graduate it off this list
and, if relevant, onto scripts/curated_overrides.json instead).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "site" / "data" / "pipeline.json"
SOURCE_PATH = Path(__file__).resolve().parent / "curated_pipeline.json"

REQUIRED_FIELDS = [
    "drug_name", "developer", "modality", "indication",
    "development_phase", "expected_launch", "administration",
]


def log(msg: str) -> None:
    print(f"[build_pipeline_data] {msg}", file=sys.stderr)


def main() -> None:
    raw = json.loads(SOURCE_PATH.read_text())
    drugs = raw["drugs"]

    out_drugs = []
    for drug_id, entry in drugs.items():
        missing = [f for f in REQUIRED_FIELDS if f not in entry]
        if missing:
            log(f"WARNING: {drug_id} is missing fields {missing} -- check curated_pipeline.json")
        entry = dict(entry)
        entry["id"] = drug_id
        out_drugs.append(entry)

    # Sort by expected launch text where possible (loose -- these are mostly
    # year/half-year estimates, not ISO dates, so alphabetical-ish grouping
    # by the raw string is the best we can do without over-parsing fuzzy text).
    out_drugs.sort(key=lambda d: d.get("expected_launch") or "zzz")

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "disclaimer": (
            "These are drugs in active clinical development that have NOT been approved by the FDA. "
            "Development-stage drugs frequently fail trials, get delayed, or change indications -- "
            "none of this is guaranteed to reach market, and expected launch dates and peak sales "
            "figures are estimates, not commitments. Not investment advice. Verify against primary "
            "sources (company press releases, ClinicalTrials.gov, FDA.gov) before making decisions."
        ),
        "drug_count": len(out_drugs),
        "drugs": out_drugs,
    }

    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(data, indent=2))
    log(f"Wrote {data['drug_count']} pipeline drugs to {DATA_OUT}")


if __name__ == "__main__":
    main()
