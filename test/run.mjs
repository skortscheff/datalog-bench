// Phase 1 Gate 5: fixture-driven regression tests over the parser and every rule,
// golden output per fixture.
//
//   node test/run.mjs            run all fixtures against their golden files
//   node test/run.mjs --update   (re)write golden files for every fixture
//
// Golden files never auto-write in CI, so a broken gate can't silently rewrite
// its own answer key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "..", "fixtures");
const GOLDEN_DIR = path.join(HERE, "golden");

const UPDATE = process.argv.includes("--update");
if (UPDATE && process.env.CI) {
  throw new Error("--update is disabled when CI is set — commit golden files reviewed by a human, never auto-write them in CI.");
}

const { parseLog, analyze } = loadEngine();

function reduce(L) {
  if (L.error) return { error: L.error };
  const findings = analyze(L);
  const result = {
    error: null,
    have: L.have,
    report: L.report,
    findings: findings.map((f) => ({ id: f.id, sev: f.sev, tag: f.tag, h: f.h })),
    metrics: L.metrics,
  };
  // parseLog/analyze run inside a vm sandbox with its own realm, so the plain
  // objects they return have a different Object.prototype than this file's —
  // deepStrictEqual treats that as unequal even when structurally identical.
  // Round-tripping through JSON (which we do for the golden files anyway)
  // normalises everything back into this realm's plain objects.
  return JSON.parse(JSON.stringify(result));
}

const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".csv"));

for (const name of fixtures) {
  test(name, () => {
    const text = readFileSync(path.join(FIXTURES_DIR, name), "utf8");
    const L = parseLog(text, name, false);
    const actual = reduce(L);
    const goldenPath = path.join(GOLDEN_DIR, name.replace(/\.csv$/, ".json"));

    if (UPDATE || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    assert.deepEqual(actual, golden);
  });
}
