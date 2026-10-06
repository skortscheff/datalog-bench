// Smoke test for the db service (db/server.mjs): spawns it as a real child
// process against a throwaway SQLite file and exercises every route.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DB_PATH = path.join(HERE, ".tmp-db-test.sqlite");
const PORT = 18190;

let child;

function req(method, reqPath, body, port = PORT) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: "127.0.0.1", port, path: reqPath, method,
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          let parsed;
          try { parsed = JSON.parse(buf.toString("utf8")); } catch { parsed = buf.toString("utf8"); }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// Sends an arbitrary string body (not necessarily JSON), optionally with a
// forged Content-Length, and resolves with the status and parsed JSON body.
function rawReq(method, reqPath, payload, headers = {}, port = PORT) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: reqPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        let parsed;
        const text = Buffer.concat(chunks).toString("utf8");
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    r.on("error", reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

function startServer(port, dbPath, extraEnv = {}) {
  if (existsSync(dbPath)) rmSync(dbPath);
  return spawn(process.execPath, ["--no-warnings", "db/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, ENGINE_SRC_DIR: path.join(ROOT, "src"), DB_PATH: dbPath, PORT: String(port), ...extraEnv },
    stdio: "pipe",
  });
}

async function waitReady(tries = 50, port = PORT) {
  for (let i = 0; i < tries; i++) {
    try { const r = await req("GET", "/healthz", undefined, port); if (r.status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("db service never became ready");
}

before(async () => {
  child = startServer(PORT, DB_PATH);
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

test("list is ordered by the drive's own recorded start time, not upload order", async () => {
  // sample-session.csv (uploaded before either of these) sits between them
  // chronologically, so a plain upload-order sort would misplace it.
  const newer = readFileSync(path.join(ROOT, "fixtures", "CSVLog_20260909_091057.csv"), "utf8"); // 2026-09-09
  const older = readFileSync(path.join(ROOT, "fixtures", "CSVLog_20260907_170504.csv"), "utf8"); // 2026-09-07
  await req("POST", "/logs", { name: "newer.csv", text: newer }); // uploaded first
  await req("POST", "/logs", { name: "older.csv", text: older }); // uploaded second, but drove earlier
  const list = await req("GET", "/logs");
  const names = list.body.map((r) => r.name);
  assert.ok(names.indexOf("newer.csv") < names.indexOf("older.csv"),
    "the 09/09 drive should list above the 09/07 drive even though it was uploaded first");
});

const sample = () => readFileSync(path.join(ROOT, "fixtures", "sample-session.csv"), "utf8");

test("invalid JSON, a null body and a missing text field are all 400", async () => {
  const hdr = { "Content-Type": "application/json" };
  assert.equal((await rawReq("POST", "/logs", "{not json", hdr)).status, 400);
  assert.equal((await rawReq("POST", "/logs", "null", hdr)).status, 400);
  assert.equal((await rawReq("POST", "/logs", "[1,2]", hdr)).status, 400);
  const r = await req("POST", "/logs", { name: "x.csv" });
  assert.equal(r.status, 400);
  assert.equal(typeof r.body.error, "string");
  assert.equal((await req("POST", "/logs", { name: "x.csv", text: 5 })).status, 400);
});

test("oversize body gets 413 (declared and streamed) and the server keeps working", async () => {
  const big = "x".repeat(8 * 1024 * 1024 + 1024);
  const declared = await rawReq("POST", "/logs", big, { "Content-Length": String(Buffer.byteLength(big)) });
  assert.equal(declared.status, 413);
  assert.deepEqual(declared.body, { error: "payload too large" });
  // No Content-Length: chunked transfer, so only the streaming guard can catch it.
  const streamed = await rawReq("POST", "/logs", big, { "Transfer-Encoding": "chunked" });
  assert.equal(streamed.status, 413);
  assert.equal((await req("GET", "/healthz")).status, 200);
});

test("unknown method on a known path is 405 with Allow; unknown path is 404", async () => {
  const r = await req("PUT", "/logs");
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, "GET, POST");
  assert.equal((await req("POST", "/logs/1/raw")).status, 405);
  assert.equal((await req("GET", "/logs/1")).status, 405);
  assert.equal((await req("GET", "/nope")).status, 404);
});

test("responses carry nosniff and no-store", async () => {
  const r = await req("GET", "/logs");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["cache-control"], "no-store");
});

test("raw route sends a safe attachment header for quote/unicode/newline names", async () => {
  const name = 'Ünï"cødé\r\nX-Evil: 1 ✓.csv';
  const up = await req("POST", "/logs", { name, text: readFileSync(path.join(ROOT, "fixtures", "CSVLog_20260908_081033.csv"), "utf8") });
  assert.equal(up.status, 201);
  const r = await req("GET", "/logs/" + up.body.id + "/raw");
  assert.equal(r.status, 200);
  const cd = r.headers["content-disposition"];
  assert.ok(cd.startsWith("attachment;"), cd);
  assert.match(cd, /filename\*=UTF-8''/);
  assert.ok(!/[\r\n]/.test(cd));
  assert.equal(r.headers["x-evil"], undefined);
  assert.ok(!cd.slice(0, cd.indexOf("filename*")).includes("Ü"), "ASCII fallback must be ASCII");
});

test("DELETE removes a log (200), then it is gone (404); unknown id is 404", async () => {
  const csv = readFileSync(path.join(ROOT, "fixtures", "CSVLog_20260909_115249.csv"), "utf8");
  const up = await req("POST", "/logs", { name: "to-delete.csv", text: csv });
  assert.equal(up.status, 201);
  const del = await req("DELETE", "/logs/" + up.body.id);
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { deleted: true });
  assert.equal((await req("GET", "/logs/" + up.body.id + "/raw")).status, 404);
  assert.equal((await req("DELETE", "/logs/" + up.body.id)).status, 404);
  assert.equal((await req("DELETE", "/logs/999999")).status, 404);
  // The deleted bytes can be uploaded again as a fresh log, not a duplicate.
  assert.equal((await req("POST", "/logs", { name: "to-delete.csv", text: csv })).body.duplicate, false);
});

test("MAX_LOGS cap: 507 when full, duplicates still answered, delete frees a slot", async () => {
  const port = PORT + 1, dbPath = DB_PATH + ".cap";
  const c = startServer(port, dbPath, { MAX_LOGS: "2" });
  try {
    await waitReady(50, port);
    const fx = (n) => readFileSync(path.join(ROOT, "fixtures", n), "utf8");
    const a = await req("POST", "/logs", { name: "a.csv", text: fx("sample-session.csv") }, port);
    const b = await req("POST", "/logs", { name: "b.csv", text: fx("CSVLog_20260907_170504.csv") }, port);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const full = await req("POST", "/logs", { name: "c.csv", text: fx("CSVLog_20260909_091057.csv") }, port);
    assert.equal(full.status, 507);
    assert.deepEqual(full.body, { error: "history is full; delete some logs" });
    const dup = await req("POST", "/logs", { name: "a2.csv", text: fx("sample-session.csv") }, port);
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    assert.equal((await req("DELETE", "/logs/" + a.body.id, undefined, port)).status, 200);
    assert.equal((await req("POST", "/logs", { name: "c.csv", text: fx("CSVLog_20260909_091057.csv") }, port)).status, 201);
  } finally {
    c.kill();
    if (existsSync(dbPath)) rmSync(dbPath);
  }
});

test("an internal failure returns a generic 500 that does not leak the cause", async () => {
  const port = PORT + 2, dbPath = DB_PATH + ".err";
  const c = startServer(port, dbPath);
  try {
    await waitReady(50, port);
    const side = new DatabaseSync(dbPath);
    side.exec("DROP TABLE logs"); // makes every query fail with "no such table: logs"
    side.close();
    const r = await req("GET", "/logs", undefined, port);
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: "internal error" });
  } finally {
    c.kill();
    if (existsSync(dbPath)) rmSync(dbPath);
  }
});

test("PATCH sets, trims, caps and clears a note; list returns it; bad bodies are 400, unknown id 404", async () => {
  const csv = readFileSync(path.join(ROOT, "fixtures", "CSVLog_20260910_140052.csv"), "utf8");
  const up = await req("POST", "/logs", { name: "note-me.csv", text: csv });
  assert.equal(up.status, 201);
  const id = up.body.id;
  const row = async () => (await req("GET", "/logs")).body.find((r) => r.id === id);
  assert.equal((await row()).note, "");
  const r = await req("PATCH", "/logs/" + id, { note: "  AC on\n used OEM MAF  " });
  assert.equal(r.status, 200);
  assert.equal(r.body.note, "AC on  used OEM MAF");
  assert.equal((await row()).note, "AC on  used OEM MAF");
  assert.equal((await req("PATCH", "/logs/" + id, { note: "x".repeat(900) })).body.note.length, 500);
  assert.equal((await req("PATCH", "/logs/" + id, { note: "" })).status, 200);
  assert.equal((await row()).note, "");
  assert.equal((await req("PATCH", "/logs/" + id, { note: 5 })).status, 400);
  assert.equal((await req("PATCH", "/logs/" + id, [1])).status, 400);
  assert.equal((await req("PATCH", "/logs/999999", { note: "x" })).status, 404);
});
