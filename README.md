# Datalog Bench — source

Single-file OBD-II datalog analyser for the **BMW M54**, reading standard
OBD-II / EOBD data only (OBD Fusion over an ELM327).

Design document: `../Datalog-Bench-Architecture.html`

## Layout

    src/                 the six numbered parts, concatenated in filename order
      01-shell.html      tokens, component CSS, page skeleton, empty state, history panel
      02-parse.js        channel spec, parser, unit normalisation, derived channels
      03-analyze.js      rule registry and statistics
      04-render.js       chart engine, panels, shared crosshair, readout
      05-map.js          Mercator projection, tile layer, event pins
      06-shell.js        KPIs, findings, mapping UI, file intake, history, orchestration
    fixtures/            real logs used as the bundled sample and as test inputs
    test/                Phase 1 Gate 5 regression suite (parser + rules + db service)
    db/                  the "simple database service": node:http + node:sqlite API
    docker/              nginx configs and the tiles-proxy Dockerfile
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
- the `__TILE_BASE__` placeholder is missing from `05-map.js`
- there are not exactly two `<script>` elements
- there is no `<title>`
- the document authors `<!doctype>`, `<html>`, `<body>` or `</head>`
  (the artifact host supplies those; authoring them breaks the page)
- HTML elements are unbalanced or unclosed
- the assembled `<script>` fails `node --check` — added after a mismatched
  quote in one function corrupted the rest of the script's parsing and shipped
  past every other check, since none of them touch the DOM-facing files
  (`04-render.js`/`05-map.js`/`06-shell.js`) that Gate 5 deliberately excludes

This is a structural gate, not a test suite. `test/run.mjs` is the behavioural
suite Phase 1 Gate 5 called for — fixture-driven, golden output per fixture,
zero dependencies (Node's built-in `node:test`) — and the container build gate
in Phase 2 runs it, failing the image build if either gate fails. `npm test`
runs it directly; `npm test -- --update` (re)writes golden files after an
intentional change. `test/db.test.mjs` (`npm run test:db`) does the same for
the `db` service.

## Ordering constraint

`04-render.js` and `05-map.js` reference `refresh()` and `activate()`, which are
declared in `06-shell.js`. Function declarations hoist within the single IIFE,
so this works — but only because all parts share one scope. Keep the filename
order, and keep everything inside the one `(function () { ... })()` that
`01-shell.html` opens and `06-shell.js` closes.

## Containerisation

Phase 2's blockers (no version control, no config-injection mechanism for the
tile URL, no Gate 5 suite) are closed. `docker compose up` brings up three
services from the project root:

- **`web`** — the assembled static file behind nginx, non-root, read-only root
  filesystem, `/healthz` and `/readyz`, image labelled with the build's git SHA.
  `05-map.js`'s tile URL is no longer hardcoded — it's a `__TILE_BASE__` token
  `build.py --tile-base` substitutes at build time (default: the same Esri URL
  as before, so plain `python build.py` is unchanged).
- **`tiles`** — a caching reverse proxy in front of Esri World Imagery
  (`docker/Dockerfile.tiles`), sized for one LAN, not a production tile
  service. `web` reaches it through its own `/tiles/` location, not by the
  `tiles` hostname directly — that hostname only resolves inside the compose
  network, and the browser rendering the page needs a same-origin URL it can
  actually load images from.
- **`db`** — the "simple database service" (`db/`): `node:http` + `node:sqlite`
  (both built into Node, no extra dependency), storing every log the app opens
  with a SHA-256 content hash for duplicate detection. `/data` is a named
  volume — the one thing in this stack meant to survive a container recreate.
  Reached through `web`'s `/api/` location for the same same-origin reason as
  `tiles`. Has its own test suite (`test/db.test.mjs`, `npm run test:db`),
  gating its own image's build the same way.

This means the app's claim of pure client-side analysis no longer holds when
served through this stack: every opened log is also persisted server-side.
The dropzone copy and page footer say so.

The **History** panel (button in the app bar) lists everything `db` has saved
and reopens any of them. Checking two to four saved sessions and clicking
**Compare selected** opens a side-by-side table of idle/driving trim per bank,
closed-loop share, peak coolant/intake air, module voltage, and a rule-by-rule
findings grid — computed with the exact same rule engine the single-log view
uses, not a second implementation.
