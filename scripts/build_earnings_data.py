#!/usr/bin/env python3
"""
build_earnings_data.py -- Pharma Earnings Tracker page data builder.

Like build_pipeline_data.py, there is no live public database for company
earnings the way there is for FDA patent/exclusivity data -- quarterly
revenue, profit, and product-level call-outs come from each company's own
press releases and SEC/foreign-issuer filings, researched by hand (or by a
Claude session) each earnings season. This script simply validates and
republishes scripts/curated_earnings.json as site/data/earnings.json for the
front end to read.

Run this after editing scripts/curated_earnings.json to add a company, or
refresh figures for a new quarter.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "site" / "data" / "earnings.json"
SOURCE_PATH = Path(__file__).resolve().parent / "curated_earnings.json"

REQUIRED_FIELDS = [
    "company_name", "ticker", "exchange", "hq_country",
    "latest_quarter", "revenue", "profit", "tier",
]


def log(msg: str) -> None:
    print(f"[build_earnings_data] {msg}", file=sys.stderr)


def main() -> None:
    raw = json.loads(SOURCE_PATH.read_text())
    companies = raw["companies"]

    out_companies = []
    for company_id, entry in companies.items():
        missing = [f for f in REQUIRED_FIELDS if f not in entry]
        if missing:
            log(f"WARNING: {company_id} is missing fields {missing} -- check curated_earnings.json")
        entry = dict(entry)
        entry["id"] = company_id
        out_companies.append(entry)

    # Sort alphabetically by company name -- there's no single natural sort
    # key across mixed fiscal calendars/quarter labels the way there is for
    # LOE dates or pipeline launch years.
    out_companies.sort(key=lambda c: c.get("company_name") or "zzz")

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "disclaimer": (
            "Quarterly revenue, profit, and product-level figures are sourced from each company's "
            "own earnings press releases and regulatory filings, researched at a point in time -- "
            "not a live financial data feed. Companies on non-USD reporting currencies (EUR, GBP, "
            "CHF, DKK, JPY) have approximate USD conversions noted in each figure. Two tracked "
            "companies were acquired and delisted during 2026 (see each entry's status field) and "
            "show their last publicly reported quarter rather than a current one. Each company's "
            "'Quarter driver' badge highlights the single product with the largest estimated "
            "year-over-year dollar swing among its reported product-level call-outs -- this is "
            "computed on the front end from each product's disclosed revenue and YoY growth rate, "
            "not a decomposition the company itself discloses, and it's limited to whichever "
            "products a company chose to call out in its own earnings release. This is not "
            "investment advice -- verify anything decision-relevant against the source_url on each "
            "figure and the company's own investor relations page."
        ),
        "company_count": len(out_companies),
        "companies": out_companies,
    }

    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(data, indent=2))
    log(f"Wrote {data['company_count']} companies to {DATA_OUT}")


if __name__ == "__main__":
    main()
