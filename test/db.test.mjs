// Smoke test for the db service (db/server.mjs): spawns it as a real child
// process against a throwaway SQLite file and exercises every route.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DB_PATH = path.join(HERE, ".tmp-db-test.sqlite");
const PORT = 18190;

let child;

function req(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: reqPath, method,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          let parsed;
          try { parsed = JSON.parse(buf.toString("utf8")); } catch { parsed = buf.toString("utf8"); }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitReady(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await req("GET", "/healthz"); if (r.status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("db service never became ready");
}

before(async () => {
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
  child = spawn(process.execPath, ["--no-warnings", "db/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, ENGINE_SRC_DIR: path.join(ROOT, "src"), DB_PATH, PORT: String(PORT) },
    stdio: "pipe",
  });
  await waitReady();
});

after(() => {
  if (child) child.kill();
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
});

test("uploads a new log and returns its id", async () => {
  const csv = readFileSync(path.join(ROOT, "fixtures", "sample-session.csv"), "utf8");
  const r = await req("POST", "/logs", { name: "sample-session.csv", text: csv });
  assert.equal(r.status, 201);
  assert.equal(r.body.duplicate, false);
  assert.equal(typeof r.body.id, "number");
});

test("re-uploading the same bytes is detected as a duplicate, not re-stored", async () => {
  const csv = readFileSync(path.join(ROOT, "fixtures", "sample-session.csv"), "utf8");
  const r = await req("POST", "/logs", { name: "renamed-copy.csv", text: csv });
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
  assert.equal(r.body.name, "sample-session.csv"); // the ORIGINAL name, not the new upload's
});

test("list returns the real ruleset's headline/severity, not a placeholder", async () => {
  const r = await req("GET", "/logs");
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(typeof r.body[0].headline, "string");
  assert.ok(["good", "neutral", "warning", "serious", "critical"].includes(r.body[0].severity));
});

test("raw fetch returns byte-identical content to what was uploaded", async () => {
  const csv = readFileSync(path.join(ROOT, "fixtures", "sample-session.csv"), "utf8");
  const list = await req("GET", "/logs");
  const id = list.body[0].id;
  const raw = await req("GET", "/logs/" + id + "/raw");
  assert.equal(raw.status, 200);
  assert.equal(raw.body, csv);
});

test("missing id returns 404", async () => {
  const r = await req("GET", "/logs/999999/raw");
  assert.equal(r.status, 404);
});

test("unparseable content is rejected, not silently stored", async () => {
  const r = await req("POST", "/logs", { name: "garbage.csv", text: "not\na\nvalid\nlog" });
  assert.equal(r.status, 422);
  const list = await req("GET", "/logs");
  assert.equal(list.body.length, 1); // still just the one good upload
});
