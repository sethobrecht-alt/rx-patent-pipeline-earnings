#!/usr/bin/env python3
"""
build_standalone.py -- inlines a site page (HTML + shared CSS + its JS + its
JSON data) into a single self-contained HTML file that works by double-
clicking, no server required. Used for the quick-look deliverables sent to
the user directly (as opposed to the full site/ folder, which is what
actually gets deployed).

Data is embedded as a JS global (window.__INLINE_DATA__) and the page's own
fetch() call is monkey-patched so the exact same app.js / pipeline.js files
work unmodified whether they're running from the real site/ folder (fetch
hits data/*.json over HTTP) or from a standalone file (fetch is intercepted
and resolves the embedded data instead) -- avoids maintaining a second copy
of the front-end logic just for the standalone build.

Usage: python3 build_standalone.py <page.html> <js-file> <data-json> <out.html>
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"


def main():
    if len(sys.argv) != 5:
        print("usage: build_standalone.py <page.html> <js-file> <data-json> <out.html>", file=sys.stderr)
        sys.exit(1)

    page_path = SITE / sys.argv[1]
    js_path = SITE / sys.argv[2]
    data_path = SITE / sys.argv[3]
    out_path = Path(sys.argv[4])

    html = page_path.read_text()
    css = (SITE / "assets" / "styles.css").read_text()
    js = js_path.read_text()
    data_json = data_path.read_text()
    data_url = "data/" + sys.argv[3].split("/")[-1] if "/" not in sys.argv[3] else sys.argv[3]
    # The data file the page's own JS fetches -- e.g. "data/drugs.json" or "data/pipeline.json".
    fetch_path = "data/" + Path(sys.argv[3]).name

    # Inline the stylesheet <link>. (Replacement passed via a function, not a
    # string, so backslashes/dollar-signs in the CSS/JS/JSON can't be
    # misread as regex backreferences by re.sub.)
    html = re.sub(
        r'<link rel="stylesheet" href="assets/styles\.css" />',
        lambda m: "<style>\n" + css + "\n</style>",
        html,
    )

    # Intercept fetch() for this page's specific data file and resolve it from
    # an embedded JSON blob instead of hitting the network -- lets app.js /
    # pipeline.js run unmodified from a file:// URL.
    shim = (
        "<script>\n"
        "window.__INLINE_DATA__ = " + data_json.strip() + ";\n"
        "(function () {\n"
        "  var realFetch = window.fetch;\n"
        "  window.fetch = function (url) {\n"
        "    if (String(url).indexOf(" + repr(fetch_path) + ") !== -1) {\n"
        "      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(window.__INLINE_DATA__); } });\n"
        "    }\n"
        "    return realFetch.apply(window, arguments);\n"
        "  };\n"
        "})();\n"
        "</script>\n"
    )

    # Inline the page's own JS <script src="...">, prefixed by the fetch shim.
    js_script_tag_re = re.compile(r'<script src="assets/[^"]+\.js"></script>')
    html = js_script_tag_re.sub(lambda m: shim + "<script>\n" + js + "\n</script>", html)

    out_path.write_text(html)
    print(f"[build_standalone] Wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
