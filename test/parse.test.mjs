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

test("a missing throttle value is never classed as idle", () => {
  const head = "Time (sec),Engine RPM (RPM),Absolute throttle position (%),Engine coolant temperature (°C)\n";
  const body = rows(6, (i) => [i, 800, i % 2 ? "" : 5, 90]);
  const L = parse(head + body);
  assert.equal(L.error, undefined);
  L.state.forEach((st, i) => { if (i % 2) assert.notEqual(st, "idle", "frame " + i); });
  assert.equal(L.state[0], "idle");
});

test("a missing coolant value is classed as other, not warm-up", () => {
  const head = "Time (sec),Engine RPM (RPM),Absolute throttle position (%),Engine coolant temperature (°C)\n";
  const body = rows(6, (i) => [i, 800, 5, i === 3 ? "" : 90]);
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
