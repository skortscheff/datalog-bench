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

test("every fixture auto-detects its own profile: BMW m54, L59 l59, EvoScan evo", () => {
  for (const f of csvs) {
    const { L } = load(f);
    assert.equal(L.profileId, f.startsWith("L59_") ? "l59" : f.startsWith("EvoScan_") ? "evo" : "m54", f + " detected " + L.profileId + " from " + L.profileWhy.join("; "));
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

// ---- Mitsubishi Evo (EvoScan) ----
const EVO = "EvoScan_2016-03-03.csv";

test("the EvoScan log maps its MUT channels and reads °F and mph from the data", () => {
  const { L } = load(EVO);
  assert.equal(L.report.format, "EvoScan");
  const src = Object.fromEntries(Object.entries(L.mapping).map(([k, i]) => [k, L.head[i]]));
  assert.deepEqual(src, { t: "LogEntrySeconds", rpm: "RPM", vss: "Speed", load: "Load1B", spark: "TimingAdv",
    ect: "CoolantTemp", iat: "AirTemp", tps: "TPS", knocksum: "KnockSum", mafhz: "AirFlow", injdc: "InjDutyCycle", batt: "Battery" });
  assert.equal(L.noTime, false);
  const ect = L.cols.ect.filter((v) => v != null);
  assert.ok(Math.max(...ect) < 100 && Math.max(...ect) > 90, "206.6 °F peak is about 97 °C");
  assert.ok(Math.abs(Math.max(...L.cols.vss.filter((v) => v != null)) - 58) < 0.1, "36.04 mph peak is 58 km/h");
});

test("all-zero trims, MAP and wideband from the EvoScan log are dropped, not analysed", () => {
  const { L } = load(EVO);
  for (const k of ["stft1", "ltft1", "map", "lam1"]) assert.ok(!L.have[k], k);
  assert.ok(!L.unitWarnings.some((w) => /converted to lambda/.test(w)), "no AFR note for a dropped wideband");
});

test("the Evo rules run on the EvoScan log and the 9-minute logging pause is a key-off, not a stall", () => {
  const { L, byId } = load(EVO);
  assert.equal(byId["knock-sum"].sev, "neutral");
  assert.match(byId["knock-sum"].h, /worst knock sum 3/);
  assert.equal(byId["inj-duty"].sev, "good");
  assert.equal(byId.charging.sev, "good");
  assert.equal(L.metrics.rpmInfo.stalls, 0);
  assert.equal(L.metrics.rpmInfo.keyOffs, 1);
  assert.ok(L.metrics.rpmInfo.idleSd < 200, "free revs at standstill are not idle");
});

test("Evo rules do not run on other profiles", () => {
  const { findings } = load("CSVLog_20260907_143525.csv");
  for (const id of ["knock-sum", "inj-duty", "charging"]) assert.ok(!findings.some((f) => f.id === id), id);
});

function evoRows(ect, speed) {
  const rows = ["LogID,LogEntryDate,LogEntryTime,LogEntrySeconds,RPM,Speed,CoolantTemp"];
  for (let i = 0; i < 60; i++) rows.push([i + 1, "2016-03-03", "13:00:00", i * 0.2, 900, speed(i), ect].join(","));
  return parseLog(rows.join("\n"), "evo.csv", false);
}

test("an EvoScan log set to metric units is left in °C and km/h", () => {
  const L = evoRows(90, (i) => (i % 10) * 2);
  assert.equal(L.profileId, "evo");
  assert.equal(L.cols.ect[0], 90);
  assert.equal(L.cols.vss[3], 6);
  assert.ok(!L.unitWarnings.some((w) => /°F|mph/.test(w)));
});

test("an EvoScan log in °F with unquantised speed assumes mph", () => {
  const L = evoRows(190, (i) => (i % 10) * 1.5);
  assert.ok(Math.abs(L.cols.ect[0] - 87.78) < 0.01);
  assert.ok(Math.abs(L.cols.vss[2] - 3 * 1.609344) < 1e-9);
});

test("the vehicle override puts an EvoScan log on another profile and back", () => {
  const { L } = load(EVO);
  L.profileOverride = "m54"; applyProfile(L);
  assert.equal(L.profileId, "m54");
  assert.ok(!JSON.parse(JSON.stringify(analyze(L))).some((f) => f.id === "knock-sum"));
  L.profileOverride = null; applyProfile(L);
  assert.equal(L.profileId, "evo");
});

test("flat-zero trims raise a warning that names both causes, and are not listed as missing", () => {
  const { byId } = load(EVO);
  assert.equal(byId["trim-flat"].sev, "warning");
  assert.match(byId["trim-flat"].p, /O2FeedbackTrim, FuelTrim_InUse/);
  assert.match(byId["trim-flat"].p, /never entered closed loop/);
  assert.match(byId["trim-flat"].p, /O2Sensor/);
  assert.match(byId.coverage.h, /^2 diagnostic channels/, "only O2Sensor and OctaneFlag are missing");
  assert.doesNotMatch(byId.coverage.p, /fuel trim/);
});

test("timing near zero under load is flagged on the Evo log and points at OctaneFlag", () => {
  const { byId } = load(EVO);
  assert.equal(byId["timing-load"].sev, "warning");
  assert.match(byId["timing-load"].h, /median 0°/);
  assert.match(byId["timing-load"].p, /Log OctaneFlag/);
});

function evoLoad(timing, octane) {
  const head = "LogID,LogEntryDate,LogEntryTime,LogEntrySeconds,RPM,Speed,CoolantTemp,Load1B,TimingAdv,KnockSum" + (octane != null ? ",OctaneFlag" : "");
  const rows = [head];
  for (let i = 0; i < 60; i++) rows.push([i + 1, "2016-03-03", "13:00:00", i * 0.2, 3000, 40, 190, 150, timing, 0].concat(octane != null ? [octane] : []).join(","));
  const L = parseLog(rows.join("\n"), "evo.csv", false);
  return Object.fromEntries(JSON.parse(JSON.stringify(analyze(L))).map((f) => [f.id, f]));
}

test("timing under load: healthy timing passes, and a low octane flag is reported as the low-octane map", () => {
  assert.equal(evoLoad(12)["timing-load"].sev, "good");
  const low = evoLoad(0, 40)["timing-load"];
  assert.equal(low.sev, "warning");
  assert.match(low.p, /moved toward its low-octane map/);
  assert.match(evoLoad(0, 100)["timing-load"].p, /does not suggest the low-octane map/);
});

test("flat-zero trims are reported on an OBD log too", () => {
  const rows = ["Time (sec),Engine RPM (RPM),Short term fuel trim Bank 1 (%),Long term fuel trim Bank 1 (%)"];
  for (let i = 0; i < 150; i++) rows.push([i, 800, 0, 0].join(","));
  const L = parseLog(rows.join("\n"), "obd.csv", false);
  const f = JSON.parse(JSON.stringify(analyze(L))).find((x) => x.id === "trim-flat");
  assert.equal(f.sev, "warning");
  assert.doesNotMatch(f.p, /EvoScan/);
});
