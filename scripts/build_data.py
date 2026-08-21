#!/usr/bin/env python3
"""
build_data.py -- Rx Patent Expiration Tracker data pipeline.

Pulls live patent/exclusivity data from two public FDA sources and merges it
with a hand-curated competitive-intelligence overlay to produce the single
JSON file the static site reads: site/data/drugs.json.

Sources
-------
1. FDA Orange Book Data Files (small-molecule drugs).
   Download page: https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files
   Ships as a zip containing products.txt, patent.txt, exclusivity.txt
   ('~'-delimited, header row present). We resolve the exact zip URL by
   scraping the download page rather than hardcoding it, since FDA
   occasionally changes the filename.

2. FDA Purple Book data download (biologics / biosimilars).
   Monthly CSV published at a predictable URL pattern under
   https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/<year>/
   purplebook-search-<month>-data-download.csv
   We try the current month, then walk backwards up to 6 months if the
   current month's file isn't published yet.

Design notes
------------
* Matching FDA records back to the curated overlay is done by normalized
  brand name. This is a heuristic (brand names in Orange/Purple Book are
  sometimes stylized differently) -- unmatched curated entries are kept
  as-is with their manually-entered dates, and the run log says which ones
  didn't get a live-data match so a human can investigate.
* This script is written to run in a normal internet-connected environment
  (a laptop, or -- as configured in .github/workflows/update-data.yml -- a
  GitHub Actions runner). It degrades gracefully if network access is
  unavailable: it logs a warning and falls back to the curated overlay
  alone, so `site/data/drugs.json` is always produced.
* Nothing here is legal or investment advice. Loss-of-exclusivity dates are
  inherently uncertain (patents can be invalidated, extended, or settled
  around; exclusivity can be forfeited or granted late). Always treat the
  output as a monitoring aid, not a final answer.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:  # pragma: no cover
    print("This script requires the 'requests' package: pip install requests", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "site" / "data" / "drugs.json"
OVERRIDES_PATH = Path(__file__).resolve().parent / "curated_overrides.json"

ORANGE_BOOK_DOWNLOAD_PAGE = "https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files"
PURPLE_BOOK_URL_TEMPLATE = (
    "https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/{year}/"
    "purplebook-search-{month}-data-download.csv"
)
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]

REQUEST_TIMEOUT = 30
USER_AGENT = "rx-patent-expiration-tracker/1.0 (+https://github.com/; personal research tool)"


def log(msg: str) -> None:
    print(f"[build_data] {msg}", file=sys.stderr)


def norm_name(name: str) -> str:
    """Normalize a brand name for fuzzy matching (lowercase, strip punctuation/suffixes)."""
    name = name.lower()
    name = re.split(r"[/(]", name)[0]  # drop combo/parenthetical suffixes like "Janumet / XR"
    name = re.sub(r"[^a-z0-9]+", "", name)
    return name.strip()


# ---------------------------------------------------------------------------
# Orange Book (small molecules)
# ---------------------------------------------------------------------------

def fetch_orange_book(session: requests.Session) -> dict[str, Any] | None:
    """Download and parse the Orange Book zip. Returns dict keyed by normalized
    trade name -> {appl_no, patents: [...], exclusivity: [...]} or None on failure."""
    try:
        page = session.get(ORANGE_BOOK_DOWNLOAD_PAGE, timeout=REQUEST_TIMEOUT)
        page.raise_for_status()
        m = re.search(r'href="([^"]+\.zip)"', page.text, re.IGNORECASE)
        if not m:
            log("Could not find Orange Book zip link on download page; falling back to curated data only.")
            return None
        zip_url = m.group(1)
        if zip_url.startswith("/"):
            zip_url = "https://www.fda.gov" + zip_url
        log(f"Downloading Orange Book data from {zip_url}")
        resp = session.get(zip_url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
    except Exception as exc:  # noqa: BLE001 -- deliberately broad; this is a best-effort enrichment step
        log(f"Orange Book fetch failed ({exc}); falling back to curated data only.")
        return None

    def read_table(filename: str) -> list[dict[str, str]]:
        candidates = [n for n in zf.namelist() if n.lower().endswith(filename)]
        if not candidates:
            return []
        with zf.open(candidates[0]) as fh:
            text = io.TextIOWrapper(fh, encoding="latin-1")
            reader = csv.DictReader(text, delimiter="~")
            return [row for row in reader]

    products = read_table("products.txt")
    patents = read_table("patent.txt")
    exclusivity = read_table("exclusivity.txt")

    by_appl_no_patents: dict[str, list[dict]] = {}
    for row in patents:
        by_appl_no_patents.setdefault(row.get("Appl_No", ""), []).append(row)

    by_appl_no_excl: dict[str, list[dict]] = {}
    for row in exclusivity:
        by_appl_no_excl.setdefault(row.get("Appl_No", ""), []).append(row)

    result: dict[str, Any] = {}
    for row in products:
        trade_name = row.get("Trade_Name", "")
        appl_no = row.get("Appl_No", "")
        key = norm_name(trade_name)
        if not key or key in result:
            continue
        result[key] = {
            "appl_no": appl_no,
            "applicant": row.get("Applicant_Full_Name") or row.get("Applicant", ""),
            "patents": [
                {
                    "patent_no": p.get("Patent_No", ""),
                    "expires": p.get("Patent_Expire_Date_Text", ""),
                    "use_code": p.get("Patent_Use_Code", ""),
                    "substance": p.get("Drug_Substance_Flag", "") == "Y",
                    "product": p.get("Drug_Product_Flag", "") == "Y",
                }
                for p in by_appl_no_patents.get(appl_no, [])
            ],
            "exclusivity": [
                {
                    "code": e.get("Exclusivity_Code", ""),
                    "expires": e.get("Exclusivity_Date", ""),
                }
                for e in by_appl_no_excl.get(appl_no, [])
            ],
        }
    log(f"Orange Book: parsed {len(products)} product rows, {len(result)} unique trade names.")
    return result


# ---------------------------------------------------------------------------
# Purple Book (biologics / biosimilars)
# ---------------------------------------------------------------------------

def fetch_purple_book(session: requests.Session) -> dict[str, Any] | None:
    """Try the current month's Purple Book CSV, walking backwards a few months
    if not yet published. Returns dict keyed by normalized proprietary name."""
    now = datetime.now(timezone.utc)
    year, month_idx = now.year, now.month - 1  # 0-based into MONTH_NAMES
    for _ in range(6):
        if month_idx < 0:
            month_idx = 11
            year -= 1
        url = PURPLE_BOOK_URL_TEMPLATE.format(year=year, month=MONTH_NAMES[month_idx])
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200 and resp.content:
                log(f"Downloaded Purple Book data from {url}")
                text = resp.content.decode("utf-8-sig", errors="replace")
                reader = csv.DictReader(io.StringIO(text))
                rows = list(reader)
                result: dict[str, Any] = {}
                for row in rows:
                    prop_name = row.get("Proprietary Name") or row.get("Proper Name", "")
                    key = norm_name(prop_name)
                    if not key or key in result:
                        continue
                    result[key] = {
                        "bla_number": row.get("BLA Number", ""),
                        "biosimilar": row.get("Biosimilar", ""),
                        "interchangeable": row.get("Interchangeable", ""),
                        "exclusivity_expiration": (
                            row.get("Exclusivity Expiration Date")
                            or row.get("Reference Product Exclusivity Exp. Date", "")
                        ),
                        "marketing_status": row.get("Marketing Status", ""),
                        "raw": row,
                    }
                log(f"Purple Book: parsed {len(rows)} rows, {len(result)} unique proprietary names.")
                return result
        except Exception as exc:  # noqa: BLE001
            log(f"Purple Book fetch attempt for {url} failed ({exc}).")
        month_idx -= 1
    log("Could not find a recent Purple Book CSV; falling back to curated data only.")
    return None


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def parse_date_loose(value: str) -> str | None:
    """Best-effort parse of FDA date strings (various formats) to ISO YYYY-MM-DD."""
    if not value:
        return None
    value = value.strip()
    for fmt in ("%b %d, %Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def build(session: requests.Session | None) -> dict[str, Any]:
    overrides = json.loads(OVERRIDES_PATH.read_text())["drugs"]

    ob_data = fetch_orange_book(session) if session else None
    pb_data = fetch_purple_book(session) if session else None

    drugs = []
    unmatched = []
    for drug_id, entry in overrides.items():
        entry = dict(entry)  # shallow copy
        key = norm_name(entry["brand_name"])
        live_dates: list[str] = []

        if entry.get("type") == "small_molecule" and ob_data and key in ob_data:
            ob = ob_data[key]
            entry["application_number"] = entry.get("application_number") or ob["appl_no"]
            entry["patents"] = ob["patents"]
            entry["exclusivity"] = ob["exclusivity"]
            for p in ob["patents"]:
                d = parse_date_loose(p["expires"])
                if d:
                    live_dates.append(d)
            for e in ob["exclusivity"]:
                d = parse_date_loose(e["expires"])
                if d:
                    live_dates.append(d)
        elif entry.get("type") == "biologic" and pb_data and key in pb_data:
            pb = pb_data[key]
            entry["bla_number"] = pb["bla_number"] or entry.get("application_number")
            entry["marketing_status"] = pb["marketing_status"]
            d = parse_date_loose(pb["exclusivity_expiration"])
            if d:
                live_dates.append(d)
        else:
            unmatched.append(entry["brand_name"])

        if live_dates:
            entry["earliest_loss_of_exclusivity_date"] = min(live_dates)
            entry["loe_date_source"] = "fda_live_data"
        else:
            entry["loe_date_source"] = "curated_estimate"

        entry["id"] = drug_id
        drugs.append(entry)

    if unmatched:
        log(f"No live FDA match for {len(unmatched)} curated entries (kept curated dates): {', '.join(unmatched)}")

    drugs.sort(key=lambda d: d.get("earliest_loss_of_exclusivity_date") or "9999-12-31")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "orange_book": "https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files",
            "purple_book": "https://purplebooksearch.fda.gov/downloads",
        },
        "live_data_fetched": {"orange_book": ob_data is not None, "purple_book": pb_data is not None},
        "disclaimer": (
            "Loss-of-exclusivity dates are estimates for market-monitoring purposes only, not legal advice. "
            "Patents can be invalidated, extended, or settled; exclusivity can be forfeited, extended, or "
            "granted after this data was generated. Verify against primary FDA sources before making decisions."
        ),
        "drug_count": len(drugs),
        "drugs": drugs,
    }


def main() -> None:
    offline = "--offline" in sys.argv
    session = None
    if not offline:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})
    data = build(session)
    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(data, indent=2))
    log(f"Wrote {data['drug_count']} drugs to {DATA_OUT}")


if __name__ == "__main__":
    main()
