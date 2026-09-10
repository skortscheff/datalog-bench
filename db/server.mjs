// Simple database service: a small HTTP API in front of a SQLite file, so the
// browser (which can't speak SQLite directly) has somewhere to persist logs
// and check for duplicates. No framework, no ORM — node:http + node:sqlite,
// both built into Node, matching this project's zero-runtime-dependency stance.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = process.env.ENGINE_SRC_DIR || path.join(HERE, "engine-src");
const DB_PATH = process.env.DB_PATH || "/data/datalogs.db";
const PORT = process.env.PORT || 8080;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // one real OBD log is well under 1 MB

// Loads parseLog/analyze from the app's own source, the same vm-sandbox
// pattern used by test/harness.mjs, so duplicate detection and the history
// list's headline/severity are produced by the exact same rule engine the
// browser runs — never a second, drifting implementation.
function loadEngine() {
  const src = ["02-parse.js", "03-analyze.js"]
    .map((f) => fs.readFileSync(path.join(SRC_DIR, f), "utf8"))
    .join("\n");
  const wrapped = `(function () {\n${src}\nreturn { parseLog, analyze };\n})()`;
  const ctx = vm.createContext({ console });
  return vm.runInContext(wrapped, ctx, { filename: "engine.js" });
}
const { parseLog, analyze } = loadEngine();

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  rows INTEGER,
  session_start TEXT,
  headline TEXT,
  severity TEXT,
  raw TEXT NOT NULL
)`);

function summarize(text, name) {
  const L = parseLog(text, name, false);
  if (L.error) return { error: L.error };
  const findings = analyze(L); // sorted worst-first
  const worst = findings[0];
  return {
    rows: L.n,
    sessionStart: (L.report.preamble[0] || "").replace("# StartTime = ", "") || null,
    headline: worst ? worst.h : "No findings",
    severity: worst ? worst.sev : "good",
  };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); reject(new Error("payload too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function rowOut(r) {
  return { id: r.id, name: r.name, uploadedAt: r.uploaded_at, rows: r.rows,
           sessionStart: r.session_start, headline: r.headline, severity: r.severity };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");

    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { status: "ok" });

    if (req.method === "POST" && url.pathname === "/logs") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const text = parsed.text, name = String(parsed.name || "upload.csv").slice(0, 200);
      if (typeof text !== "string" || !text.length) return send(res, 400, { error: "missing text" });

      const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
      const existing = db.prepare("SELECT id, name, uploaded_at FROM logs WHERE hash = ?").get(hash);
      if (existing) return send(res, 200, { duplicate: true, id: existing.id, name: existing.name, uploadedAt: existing.uploaded_at });

      const sum = summarize(text, name);
      if (sum.error) return send(res, 422, { error: sum.error });

      const uploadedAt = new Date().toISOString();
      const info = db.prepare(
        "INSERT INTO logs (hash,name,uploaded_at,rows,session_start,headline,severity,raw) VALUES (?,?,?,?,?,?,?,?)"
      ).run(hash, name, uploadedAt, sum.rows, sum.sessionStart, sum.headline, sum.severity, text);
      return send(res, 201, { duplicate: false, id: Number(info.lastInsertRowid), name, uploadedAt });
    }

    if (req.method === "GET" && url.pathname === "/logs") {
      const rows = db.prepare(
        "SELECT id,name,uploaded_at,rows,session_start,headline,severity FROM logs"
      ).all();
      // Sort by the drive's own recorded start time, not upload order — a log
      // opened out of sequence (re-adding an older fixture, backfilling a
      // missed session) should still land in its real chronological spot.
      // session_start is the CSV's raw "StartTime" text (e.g. "09/10/2026
      // 08:55:27.7171 AM"); Date parses that directly. Fall back to
      // uploaded_at when it's missing or unparseable.
      function sortKey(r) {
        const t = r.session_start ? Date.parse(r.session_start) : NaN;
        return Number.isNaN(t) ? Date.parse(r.uploaded_at) : t;
      }
      rows.sort((a, b) => sortKey(b) - sortKey(a));
      return send(res, 200, rows.map(rowOut));
    }

    const m = url.pathname.match(/^\/logs\/(\d+)\/raw$/);
    if (req.method === "GET" && m) {
      const row = db.prepare("SELECT name, raw FROM logs WHERE id = ?").get(Number(m[1]));
      if (!row) return send(res, 404, { error: "not found" });
      const buf = Buffer.from(row.raw, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="' + row.name.replace(/"/g, "") + '"',
        "Content-Length": buf.length,
      });
      return res.end(buf);
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT);
