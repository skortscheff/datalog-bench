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
const PORT = Number(process.env.PORT) || 8080;
// Must equal client_max_body_size on the /api/ location in docker/nginx-web.conf.
// One real OBD log is well under 1 MB.
const MAX_BODY_BYTES = 8 * 1024 * 1024;
// Upper bound on stored logs, so a runaway client can't fill the volume.
const MAX_LOGS = Number.parseInt(process.env.MAX_LOGS, 10) > 0 ? Number.parseInt(process.env.MAX_LOGS, 10) : 500;

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
    sessionStart: ((L.report.preamble || []).filter(function (x) { return /^#\s*StartTime\s*=/.test(x); })[0] || "").replace(/^#\s*StartTime\s*=\s*/, "") || null,
    headline: worst ? worst.h : "No findings",
    severity: worst ? worst.sev : "good",
  };
}

// Every response carries nosniff; API responses are never cacheable.
function baseHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
}

function send(res, status, body, extra) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json), ...extra });
  res.end(json);
}

// An error whose status and message are safe to show the client.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Oversize bodies get a 413 rather than a destroyed socket: the response is
// sent with "Connection: close" while the rest of the upload is discarded, so
// the client sees the status instead of a connection reset.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = req.headers["content-length"];
    if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
      req.resume();
      reject(new HttpError(413, "payload too large"));
      return;
    }
    const chunks = [];
    let size = 0, tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return; // keep draining, store nothing
      size += c.length;
      if (size > MAX_BODY_BYTES) { tooBig = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on("end", () => tooBig ? reject(new HttpError(413, "payload too large")) : resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Builds a Content-Disposition value that survives any stored name: an ASCII
// fallback for old clients plus an RFC 5987 UTF-8 form. Control characters
// (CR/LF especially) are stripped so a name can never inject headers.
function attachmentHeader(name) {
  const clean = String(name).replace(/[\x00-\x1f\x7f]/g, "").toWellFormed().trim() || "download.csv";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  const utf8 = encodeURIComponent(clean).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

function rowOut(r) {
  return { id: r.id, name: r.name, uploadedAt: r.uploaded_at, rows: r.rows,
           sessionStart: r.session_start, headline: r.headline, severity: r.severity };
}

const server = http.createServer(async (req, res) => {
  baseHeaders(res);
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const notAllowed = (...allow) => send(res, 405, { error: "method not allowed" }, { Allow: allow.join(", ") });

    if (p === "/healthz") {
      if (req.method !== "GET") return notAllowed("GET");
      return send(res, 200, { status: "ok" });
    }

    if (p === "/logs" && req.method === "POST") {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON" }); }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return send(res, 400, { error: "body must be a JSON object" });
      }
      const text = parsed.text, name = String(parsed.name || "upload.csv").slice(0, 200);
      if (typeof text !== "string" || !text.length) return send(res, 400, { error: "missing text" });

      const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
      const existing = db.prepare("SELECT id, name, uploaded_at FROM logs WHERE hash = ?").get(hash);
      if (existing) return send(res, 200, { duplicate: true, id: existing.id, name: existing.name, uploadedAt: existing.uploaded_at });

      const { n } = db.prepare("SELECT COUNT(*) AS n FROM logs").get();
      if (Number(n) >= MAX_LOGS) return send(res, 507, { error: "history is full; delete some logs" });

      const sum = summarize(text, name);
      if (sum.error) return send(res, 422, { error: sum.error });

      const uploadedAt = new Date().toISOString();
      const info = db.prepare(
        "INSERT INTO logs (hash,name,uploaded_at,rows,session_start,headline,severity,raw) VALUES (?,?,?,?,?,?,?,?)"
      ).run(hash, name, uploadedAt, sum.rows, sum.sessionStart, sum.headline, sum.severity, text);
      return send(res, 201, { duplicate: false, id: Number(info.lastInsertRowid), name, uploadedAt });
    }

    if (p === "/logs" && req.method === "GET") {
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
    if (p === "/logs") return notAllowed("GET", "POST");

    const del = p.match(/^\/logs\/(\d+)$/);
    if (del) {
      if (req.method !== "DELETE") return notAllowed("DELETE");
      const info = db.prepare("DELETE FROM logs WHERE id = ?").run(Number(del[1]));
      if (!info.changes) return send(res, 404, { error: "not found" });
      return send(res, 200, { deleted: true });
    }

    const m = p.match(/^\/logs\/(\d+)\/raw$/);
    if (m) {
      if (req.method !== "GET") return notAllowed("GET");
      const row = db.prepare("SELECT name, raw FROM logs WHERE id = ?").get(Number(m[1]));
      if (!row) return send(res, 404, { error: "not found" });
      const buf = Buffer.from(row.raw, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachmentHeader(row.name),
        "Content-Length": buf.length,
      });
      return res.end(buf);
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof HttpError) {
      return send(res, e.status, { error: e.message }, e.status === 413 ? { Connection: "close" } : undefined);
    }
    console.error(e); // detail stays in the server log, never in the response
    if (!res.headersSent) send(res, 500, { error: "internal error" });
    else res.destroy();
  }
});

// Slow-client limits: the whole request must arrive in 30 s (headers in 10 s),
// and idle keep-alive connections are dropped after 5 s.
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT);
