// Parser edge cases that the golden fixtures do not exercise. Each case builds a
// small log inline and checks one behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine } from "./harness.mjs";

const { parseLog } = loadEngine();
// parseLog runs in a vm sandbox (a different realm): round-trip before comparing
const parse = (text, name = "t.csv") => JSON.parse(JSON.stringify(parseLog(text, name)));

function rows(n, f) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(f(i).join(","));
  return out.join("\n");
}

test("a decimal comma in a tab-delimited file is read as a decimal mark", () => {
  const txt = "Time (sec)\tEngine RPM (RPM)\tVehicle speed (km/h)\n" +
    "0\t800\t0\n1\t800\t1,5\n2\t810\t2,5\n3\t820\t3,5\n";
  const L = parse(txt);
  assert.equal(L.error, undefined);
  assert.deepEqual(L.cols.vss, [0, 1.5, 2.5, 3.5]);
});

test("a thousands separator in a comma file is stripped, not read as a decimal", () => {
  const txt = 'Time (sec),Engine RPM (RPM),Vehicle speed (km/h)\n0,"1,200",5\n1,"1,250",6\n2,"1,300",7\n';
  const L = parse(txt);
  assert.deepEqual(L.cols.rpm, [1200, 1250, 1300]);
});

test("a missing road-speed value is never classed as idle", () => {
  const head = "Time (sec),Engine RPM (RPM),Vehicle speed (km/h),Engine coolant temperature (°C)\n";
  const body = rows(6, (i) => [i, 800, i % 2 ? "" : 0, 90]);
  const L = parse(head + body);
  assert.equal(L.error, undefined);
  L.state.forEach((st, i) => { if (i % 2) assert.notEqual(st, "idle", "frame " + i); });
  assert.equal(L.state[0], "idle");
});

test("a missing coolant value is classed as other, not warm-up", () => {
  const head = "Time (sec),Engine RPM (RPM),Vehicle speed (km/h),Engine coolant temperature (°C)\n";
  const body = rows(6, (i) => [i, 800, 0, i === 3 ? "" : 90]);
  const L = parse(head + body);
  assert.equal(L.state[3], "other");
  assert.equal(L.state[2], "idle");
});

test("a millisecond time column on a short log is rescaled to seconds", () => {
  const head = "Time (ms),Engine RPM (RPM),Vehicle speed (km/h)\n";
  const body = rows(5, (i) => [i * 1000, 800 + i, i]);
  const L = parse(head + body);
  assert.deepEqual(L.cols.t, [0, 1, 2, 3, 4]);
});

test("header-only, single-row and empty input do not throw", () => {
  assert.ok(parse("").error);
  assert.ok(parse("Time (sec),Engine RPM (RPM),Vehicle speed (km/h)\n").error);
  const one = parse("Time (sec),Engine RPM (RPM),Vehicle speed (km/h)\n0,800,0\n");
  assert.equal(one.error, undefined);
  assert.equal(one.n, 1);
});

test("rpm stability: the 2026-10-06 VEMO log shows two stalls; cranking and key-off are not counted", async () => {
  const { loadEngine } = await import("./harness.mjs");
  const { parseLog, analyze } = loadEngine();
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("../fixtures/CSVLog_20261006_084750.csv", import.meta.url), "utf8");
  const L = parseLog(text, "x.csv", false);
  analyze(L);
  const r = JSON.parse(JSON.stringify(L.metrics.rpmInfo));
  assert.equal(r.stalls, 2);
  assert.ok(r.dips >= r.stalls);
  assert.equal(r.lowest, 0);
  const ok = parseLog(readFileSync(new URL("../fixtures/CSVLog_20260930_131813.csv", import.meta.url), "utf8"), "y.csv", false);
  analyze(ok);
  assert.equal(ok.metrics.rpmInfo.stalls, 0);
});

// ---- channels added for the L59 profile ----

function oneRow(headers, vals, n = 6) {
  const out = [headers.join(",")];
  for (let i = 0; i < n; i++) out.push(vals.map((v) => (typeof v === "function" ? v(i) : v)).join(","));
  return out.join("\n");
}

test("GM-style trim names (Long Term FT B1, Short Term FT B2) map to the trim channels", () => {
  const txt = oneRow(["Time (sec)", "Short Term FT B1 (%)", "Long Term FT B1 (%)", "Short Term FT B2 (%)", "Long Term FT B2 (%)"],
    [(i) => i, 1, 2, 3, 4]);
  const L = parse(txt);
  assert.equal(L.error, undefined);
  assert.deepEqual([L.cols.stft1[0], L.cols.ltft1[0], L.cols.stft2[0], L.cols.ltft2[0]], [1, 2, 3, 4]);
});

test("throttle, MAP, fuel system status and knock retard are recognised by their OBD Fusion names", () => {
  const txt = oneRow(["Time (sec)", "Absolute throttle position (%)", "Intake manifold absolute pressure (kPa)",
    "Fuel system 1 status", "Knock retard (deg)"], [(i) => i, (i) => 10 + i, (i) => 35 + i, 2, (i) => (i === 2 ? 4.5 : 0)]);
  const L = parse(txt);
  for (const k of ["tps", "map", "fuelsys", "knock"]) assert.ok(L.have[k], k);
  assert.equal(L.cols.knock[2], 4.5);
});

test("manifold pressure in psi or inHg is converted to kPa", () => {
  const psi = parse(oneRow(["Time (sec)", "Engine RPM (RPM)", "Intake manifold absolute pressure (psi)"], [(i) => i, 800, 10]));
  assert.ok(Math.abs(psi.cols.map[0] - 68.95) < 0.05);
  const hg = parse(oneRow(["Time (sec)", "Engine RPM (RPM)", "MAP (inHg)"], [(i) => i, 800, 10]));
  assert.ok(Math.abs(hg.cols.map[0] - 33.86) < 0.05);
});

test("O2 voltage maps by bank and sensor, and never takes a wideband lambda or current column", () => {
  const txt = oneRow(["Time (sec)", "O2 voltage (Bank 1  Sensor 1) (V)", "O2 voltage (Bank 2  Sensor 1) (V)",
    "O2 voltage (Bank 1  Sensor 2) (V)", "O2 sensor current wide range (Bank 1  Sensor 1) (mA)",
    "O2 sensor lambda wide range (current probe)  (Bank 1  Sensor 1)"],
  [(i) => i, (i) => 0.1 + i / 10, (i) => 0.2 + i / 10, 0.65, 3, 1]);
  const L = parse(txt);
  assert.ok(Math.abs(L.cols.o2b1s1[1] - 0.2) < 1e-9);
  assert.ok(Math.abs(L.cols.o2b2s1[1] - 0.3) < 1e-9);
  assert.equal(L.cols.o2b1s2[1], 0.65);
  assert.equal(L.cols.lam1[0], 1, "wideband lambda stays on lam1");
  assert.ok(L.head[L.mapping.o2b1s1].includes("voltage"));
});

test("an O2 voltage column that reads 0 V all log is dropped as unsupported", () => {
  const txt = oneRow(["Time (sec)", "Engine RPM (RPM)", "O2 voltage (Bank 1  Sensor 1) (V)"], [(i) => i, 800, 0], 12);
  const L = parse(txt);
  assert.equal(L.have.o2b1s1, undefined);
  assert.ok(L.unitWarnings.some((w) => /read zero for the whole log/.test(w)));
});

test("with no road speed, throttle position decides idle from the log's own closed-throttle level", () => {
  // Absolute throttle position idles near 10 % rather than 0 %: idle must still be found.
  const head = ["Time (sec)", "Engine RPM (RPM)", "Absolute throttle position (%)", "Engine coolant temperature (°C)"];
  const rows = [head.join(",")];
  for (let i = 0; i < 60; i++) rows.push([i, i < 30 ? 750 : 1300, i < 30 ? 10.2 : 25, 90].join(","));
  const L = parse(rows.join("\n"));
  assert.equal(L.state[5], "idle");
  assert.equal(L.state[50], "driving");
});

test("with road speed present, throttle position does not change the state classification", () => {
  const head = ["Time (sec)", "Engine RPM (RPM)", "Vehicle speed (km/h)", "Absolute throttle position (%)", "Engine coolant temperature (°C)"];
  const rows = [head.join(",")];
  for (let i = 0; i < 40; i++) rows.push([i, 800, 0, i < 20 ? 10 : 60, 90].join(","));
  const L = parse(rows.join("\n"));
  assert.equal(L.state[30], "idle", "stationary stays idle regardless of throttle");
});

test("profile detection scores wideband lambda against MAP and narrow-band O2 voltage", () => {
  const gm = parse(oneRow(["Time (sec)", "Intake manifold absolute pressure (kPa)", "O2 voltage (Bank 1  Sensor 1) (V)"],
    [(i) => i, 35, (i) => 0.2 + i / 20]));
  assert.equal(gm.profileId, "l59");
  const bmw = parse(oneRow(["Time (sec)", "O2 sensor lambda wide range (current probe)  (Bank 1  Sensor 1)", "Mass air flow rate (g/s)"],
    [(i) => i, 1, 5]));
  assert.equal(bmw.profileId, "m54");
  assert.equal(parse(oneRow(["Time (sec)", "Engine RPM (RPM)", "Vehicle speed (km/h)"], [(i) => i, 800, 0]), "silverado-idle.csv").profileId, "l59", "file name hint");
});
