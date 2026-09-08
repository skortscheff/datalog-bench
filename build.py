#!/usr/bin/env python3
"""Assemble Datalog Bench into a single self-contained HTML file.

No absolute paths: every default is resolved relative to this script, so the
same command works on a workstation and inside a container build stage.

    python build.py                          # -> dist/Datalog-Bench.html
    python build.py --out ../Datalog-Bench.html
    python build.py --check                  # validate only, write nothing

Exit status is non-zero on any structural failure, so a container build can
gate on it.
"""
import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

PARTS = [
    "01-shell.html",   # tokens, component CSS, page skeleton, empty state
    "02-parse.js",     # channel spec, parser, unit normalisation, derived channels
    "03-analyze.js",   # rule registry and statistics
    "04-render.js",    # chart engine, panels, crosshair, readout
    "05-map.js",       # Mercator projection, tile layer, event pins
    "06-shell.js",     # KPIs, findings, mapping UI, file intake, orchestration
]

SAMPLE_TOKEN = "/*__SAMPLE_CSV__*/"
TILE_TOKEN = "__TILE_BASE__"
DEFAULT_TILE_BASE = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
                      "World_Imagery/MapServer/tile/{z}/{y}/{x}")


def build(src_dir, sample_path, out_path, check_only=False, tile_base=DEFAULT_TILE_BASE):
    missing = [p for p in PARTS if not os.path.isfile(os.path.join(src_dir, p))]
    if missing:
        sys.exit("missing source part(s) in %s: %s" % (src_dir, ", ".join(missing)))

    doc = "\n".join(
        io.open(os.path.join(src_dir, p), encoding="utf-8").read() for p in PARTS
    )

    if SAMPLE_TOKEN not in doc:
        sys.exit("sample placeholder %s not found in 01-shell.html" % SAMPLE_TOKEN)

    if not os.path.isfile(sample_path):
        sys.exit("sample log not found: %s" % sample_path)
    sample = io.open(sample_path, encoding="utf-8-sig").read()

    # The sample is embedded inside <script type="text/plain">. Anything that can
    # close that element early would break the page and inject markup.
    if "</script" in sample.lower():
        sys.exit("sample log contains '</script' and would break out of its element")

    doc = doc.replace(SAMPLE_TOKEN, sample)

    if TILE_TOKEN not in doc:
        sys.exit("tile-base placeholder %s not found in 05-map.js" % TILE_TOKEN)
    doc = doc.replace(TILE_TOKEN, tile_base)

    # --- structural checks: cheap, and they catch the failures that matter ---
    problems = []

    n_open = len(re.findall(r"<script[\s>]", doc))
    n_close = doc.count("</script>")
    if n_open != 2 or n_close != 2:
        problems.append("expected exactly 2 script elements, found %d open / %d close"
                        % (n_open, n_close))

    if "<title>" not in doc:
        problems.append("no <title> element")

    # The artifact host wraps the fragment; authoring these ourselves breaks it.
    for tag in ("<!doctype", "<html", "<body", "</head>"):
        if tag in doc.lower():
            problems.append("document must not contain %r" % tag)

    void = {"meta", "link", "br", "hr", "img", "input", "source",
            "polygon", "line", "rect", "circle", "path", "text", "marker", "use"}
    stack = []
    for m in re.finditer(r"<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>", doc):
        closing, tag, _, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if tag in void or selfclose == "/":
            continue
        if not closing:
            stack.append((tag, m.start()))
        elif stack and stack[-1][0] == tag:
            stack.pop()
        else:
            problems.append("unbalanced </%s> at offset %d" % (tag, m.start()))
            break
    if stack:
        problems.append("unclosed element(s): %s" % ", ".join(t for t, _ in stack[:5]))

    # Tag balance says nothing about whether the code inside <script> is valid
    # JS — a mismatched quote inside a string literal balances every tag fine
    # while corrupting everything parsed after it. Node is already required
    # for the Gate 5 suite in this same build context, so use it here too.
    script_bodies = re.findall(r"<script(?:\s+id=\"sample-csv\"[^>]*)?>(.*?)</script>", doc, re.S)
    app_script = script_bodies[-1] if len(script_bodies) == 2 else None
    if app_script is not None:
        node = shutil.which("node")
        if node is None:
            sys.stderr.write("WARN  node not found on PATH; skipping JS syntax check\n")
        else:
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".js")
            try:
                with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                    f.write(app_script)
                r = subprocess.run([node, "--check", tmp_path], capture_output=True, text=True)
                if r.returncode != 0:
                    problems.append("app script fails node --check:\n" + r.stderr.strip())
            finally:
                os.unlink(tmp_path)

    if problems:
        for p in problems:
            sys.stderr.write("FAIL  %s\n" % p)
        sys.exit(1)

    rows = sample.count("\n") - 2  # preamble + header
    size_kb = len(doc.encode("utf-8")) / 1024.0

    if check_only:
        print("OK  %d parts, sample %d rows, would write %.0f KB" % (len(PARTS), rows, size_kb))
        return 0

    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    io.open(out_path, "w", encoding="utf-8", newline="\n").write(doc)
    print("OK  wrote %s  (%.0f KB, sample %d rows)" % (out_path, size_kb, rows))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=os.path.join(HERE, "src"),
                    help="directory holding the numbered source parts")
    ap.add_argument("--sample", default=os.path.join(HERE, "fixtures", "sample-session.csv"),
                    help="log embedded as the bundled sample")
    ap.add_argument("--out", default=os.path.join(HERE, "dist", "Datalog-Bench.html"),
                    help="output HTML file")
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    ap.add_argument("--tile-base", default=DEFAULT_TILE_BASE,
                    help="tile URL template substituted for %s in 05-map.js "
                         "(default: the current Esri World Imagery URL)" % TILE_TOKEN)
    a = ap.parse_args()
    return build(a.src, a.sample, a.out, a.check, a.tile_base)


if __name__ == "__main__":
    sys.exit(main())
