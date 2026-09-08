# Datalog Bench — source

Single-file OBD-II datalog analyser for the **BMW M54**, reading standard
OBD-II / EOBD data only (OBD Fusion over an ELM327).

Design document: `../Datalog-Bench-Architecture.html`

## Layout

    src/                 the six numbered parts, concatenated in filename order
      01-shell.html      tokens, component CSS, page skeleton, empty state
      02-parse.js        channel spec, parser, unit normalisation, derived channels
      03-analyze.js      rule registry and statistics
      04-render.js       chart engine, panels, shared crosshair, readout
      05-map.js          Mercator projection, tile layer, event pins
      06-shell.js        KPIs, findings, mapping UI, file intake, orchestration
    fixtures/            real logs used as the bundled sample and as test inputs
    dist/                build output (not the published copy)
    build.py             assembler and structural gate
    make-test-fixtures.py  generates synthetic logs in other shapes

The split is for authoring only. There is no module system at runtime — the
build concatenates the parts and inlines `fixtures/sample-session.csv` into the
`<script id="sample-csv">` placeholder.

## Build

    python build.py                              # -> dist/Datalog-Bench.html
    python build.py --out ../Datalog-Bench.html  # the published copy
    python build.py --check                      # validate only, write nothing

No third-party packages. Python 3 only, and only at build time — the output has
zero runtime dependencies.

Every path defaults to a location relative to `build.py`, so the same command
works on a workstation and inside a container build stage. Override with
`--src`, `--sample`, `--out`.

## The gate

`build.py` exits non-zero if the assembled document fails any structural check:

- a source part is missing
- the sample placeholder is absent, or the sample contains `</script`
- there are not exactly two `<script>` elements
- there is no `<title>`
- the document authors `<!doctype>`, `<html>`, `<body>` or `</head>`
  (the artifact host supplies those; authoring them breaks the page)
- HTML elements are unbalanced or unclosed

This is a structural gate, not a test suite. A behavioural suite over the
parser and the rules is Phase 1 Gate 5 in the design document, and the
container build gate in Phase 2 is specified to run it — so that suite has to
exist before the Phase 2 gate means anything.

## Ordering constraint

`04-render.js` and `05-map.js` reference `refresh()` and `activate()`, which are
declared in `06-shell.js`. Function declarations hoist within the single IIFE,
so this works — but only because all parts share one scope. Keep the filename
order, and keep everything inside the one `(function () { ... })()` that
`01-shell.html` opens and `06-shell.js` closes.

## Known non-portable items for containerisation

- The map's tile URL is hardcoded to the Esri imagery host in `05-map.js`.
  Serving tiles through a first-party proxy needs that to become configurable;
  the app has no config-injection mechanism today. See the design document,
  §10.3.
- There is no version control in this tree yet. The Phase 2 build is specified
  to tag images with a git SHA, which requires a repository first.
