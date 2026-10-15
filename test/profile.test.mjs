// Engine profiles and the L59 rules. The golden suite (run.mjs) pins the full
// output per fixture; these tests state the intent in words, so a golden diff can
// be judged against what each fixture is supposed to show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "..", "fixtures");
const { parseLog, analyze, applyProfile } = loadEngine();

function load(name) {
  const L = parseLog(readFileSync(path.join(FIX, name), "utf8"), name, false);
  assert.equal(L.error, undefined, name);
  const findings = JSON.parse(JSON.stringify(analyze(L)));
  return { L, findings, byId: Object.fromEntries(findings.map((f) => [f.id, f])) };
}
const csvs = readdirSync(FIX).filter((f) => f.endsWith(".csv"));

test("every BMW fixture auto-detects the m54 profile and every L59 fixture the l59 profile", () => {
  for (const f of csvs) {
    const { L } = load(f);
    assert.equal(L.profileId, f.startsWith("L59_") ? "l59" : "m54", f + " detected " + L.profileId + " from " + L.profileWhy.join("; "));
  }
});

test("L59 rules do not run on the m54 profile and leave no trace in the skipped list", () => {
  const { findings, L } = load("CSVLog_20260907_143525.csv");   // BMW log that has throttle, fuel system, O2 voltage
  const extra = ["throttle", "map-idle", "map-airflow", "o2-switching", "closed-loop", "knock", "knock-inferred"];
  for (const id of extra) assert.ok(!findings.some((f) => f.id === id), id + " ran on m54");
  for (const id of extra) assert.ok(!L.metrics.skippedRules.some((s) => s.id === id), id + " listed as skipped on m54");
});

test("manual override switches the profile and re-enables the rules", () => {
  const { L } = load("CSVLog_20260907_143525.csv");
  assert.equal(L.profileId, "m54");
  L.profileOverride = "l59";
  applyProfile(L);
  assert.equal(L.profileId, "l59");
  assert.equal(L.profileAuto, "m54", "auto detection result is kept");
  const ids = JSON.parse(JSON.stringify(analyze(L))).map((f) => f.id);
  assert.ok(ids.includes("throttle"), "throttle rule runs under l59");
  L.profileOverride = null;
  applyProfile(L);
  assert.equal(L.profileId, "m54");
});

test("the healthy L59 log raises nothing above neutral", () => {
  const { findings } = load("L59_healthy.csv");
  const bad = findings.filter((f) => f.sev === "critical" || f.sev === "serious" || f.sev === "warning");
  assert.deepEqual(bad.map((f) => f.id + ":" + f.sev), []);
  for (const id of ["throttle", "map-idle", "map-airflow", "o2-switching", "closed-loop", "knock-inferred"])
    assert.equal(findings.find((f) => f.id === id)?.sev, "good", id);
});

test("a stuck-low bank 2 oxygen sensor with a 22 % lean bank is found", () => {
  const { byId } = load("L59_bank2_lean_stuck_o2.csv");
  assert.equal(byId["o2-switching"].sev, "warning");
  assert.match(byId["o2-switching"].h, /B2 stuck low/);
  assert.equal(byId["bank-balance"].sev, "serious");
  assert.equal(byId["trim-level"].sev, "critical");
});

test("weak idle vacuum and open loop while warm are found", () => {
  const { byId } = load("L59_vacuum_leak_open_loop.csv");
  assert.equal(byId["map-idle"].sev, "serious");
  assert.equal(byId["closed-loop"].sev, "warning");
});

test("a real knock retard channel is analysed and the inferred rule steps aside", () => {
  const { L, byId } = load("L59_knock_pid.csv");
  assert.ok(L.have.knock);
  assert.equal(byId.knock.sev, "serious");
  assert.match(byId.knock.h, /4 knock events, worst 9\.\d/);
  assert.equal(byId["knock-inferred"], undefined);
});

test("without a knock channel, sudden timing pulls at steady load are flagged as inferred", () => {
  const { L, byId } = load("L59_timing_pulls_no_knock_pid.csv");
  assert.ok(!L.have.knock);
  assert.equal(byId["knock-inferred"].sev, "warning");
  assert.match(byId["knock-inferred"].h, /inferred/);
  assert.equal(byId.knock, undefined);
});

test("profile thresholds drive the stall counts: a 420 rpm dip is a dip on m54 but not on l59", () => {
  const rows = ["Time (sec),Engine RPM (RPM),Vehicle speed (km/h),Engine coolant temperature (°C)"];
  for (let i = 0; i < 40; i++) rows.push([i, i < 20 ? 700 : (i < 25 ? 420 : 700), 0, 90].join(","));
  const make = (id) => {
    const L = parseLog(rows.join("\n"), "dip.csv", false);
    L.profileOverride = id; applyProfile(L); analyze(L);
    return JSON.parse(JSON.stringify(L.metrics.rpmInfo));
  };
  assert.equal(make("m54").dips, 1, "420 < 450");
  assert.equal(make("l59").dips, 0, "420 >= 400");
});
