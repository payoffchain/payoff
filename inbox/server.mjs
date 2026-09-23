// A small inbox for messages visitors leave on the site.
// POST /messages  (x-inbox-key: INBOX_WRITE_KEY)  { name?, contact?, message }  -> stored
// GET  /messages  (x-inbox-key: INBOX_READ_KEY)                                   -> everything, newest first (team)
// GET  /public                                                                    -> the wall: names and messages only,
//                                                                                    links and addresses masked, hidden ones left out
// POST /hide      (x-inbox-key: INBOX_READ_KEY)  { id, hidden? }                  -> take a message off the wall (or put it back)
// Messages live in JSON-lines files on the Railway volume at /data.
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DIR = process.env.DATA_DIR || "/data";
const FILE = `${DIR}/messages.jsonl`;
const HIDDEN = `${DIR}/hidden.jsonl`;
const WRITE = process.env.INBOX_WRITE_KEY || "";
const READ = process.env.INBOX_READ_KEY || "";
const PORT = Number(process.env.PORT || 8080);
if (!WRITE || !READ) { console.error("INBOX_WRITE_KEY and INBOX_READ_KEY are required"); process.exit(1); }
mkdirSync(DIR, { recursive: true });

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

function lines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function hiddenIds() {
  const state = new Map();
  for (const h of lines(HIDDEN)) state.set(h.id, h.hidden !== false);
  return new Set([...state].filter(([, v]) => v).map(([k]) => k));
}

/**
 * What the public wall may show. A wall anyone can post to is the first place someone
 * pastes a fake contract address or a phishing link, so neither survives: addresses,
 * links and bare domains are replaced before anything leaves this service.
 */
function mask(text) {
  return text
    .replace(/0x[0-9a-fA-F]{6,}/g, "[address removed]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]")
    .replace(/\bt\.me\/\S+/gi, "[link removed]")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|xyz|app|tech|me|gg|co|finance|fi|so|link|site|online|top|vip|club|info|pro|ai)(?:\/\S*)?/gi, "[link removed]");
}

function readBody(req, cb) {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 8000) req.destroy(); });
  req.on("end", () => { let b; try { b = JSON.parse(raw || "{}"); } catch { b = null; } cb(b); });
}

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const key = req.headers["x-inbox-key"];
  if (url.pathname === "/health") return json(res, 200, { ok: true, count: lines(FILE).length });

  if (url.pathname === "/public" && req.method === "GET") {
    const hide = hiddenIds();
    const wall = lines(FILE).filter((m) => !hide.has(m.id)).reverse().slice(0, 200)
      .map((m) => ({ id: m.id, at: m.at, name: mask(m.name || "") || "anonymous", message: mask(m.message) }));
    return json(res, 200, { count: wall.length, messages: wall });
  }

  if (url.pathname === "/hide" && req.method === "POST") {
    if (key !== READ) return json(res, 401, { error: "unauthorized" });
    return readBody(req, (b) => {
      if (!b || typeof b.id !== "string") return json(res, 400, { error: "id required" });
      appendFileSync(HIDDEN, JSON.stringify({ id: b.id, hidden: b.hidden !== false, at: new Date().toISOString() }) + "\n");
      json(res, 200, { ok: true });
    });
  }

  if (url.pathname !== "/messages") return json(res, 404, { error: "not found" });
  if (req.method === "GET") {
    if (key !== READ) return json(res, 401, { error: "unauthorized" });
    const hide = hiddenIds();
    const all = lines(FILE).reverse().map((m) => ({ ...m, hidden: hide.has(m.id) }));
    return json(res, 200, { count: all.length, messages: all.slice(0, Math.min(Number(url.searchParams.get("limit")) || 500, 2000)) });
  }
  if (req.method === "POST") {
    if (key !== WRITE) return json(res, 401, { error: "unauthorized" });
    return readBody(req, (b) => {
      if (!b) return json(res, 400, { error: "bad json" });
      const message = clean(b.message, 1000);
      if (message.length < 2) return json(res, 400, { error: "message is empty" });
      const row = { id: randomUUID(), at: new Date().toISOString(), name: clean(b.name, 40), contact: clean(b.contact, 80), message, ip: clean(b.ip, 64) };
      appendFileSync(FILE, JSON.stringify(row) + "\n");
      json(res, 201, { ok: true, id: row.id });
    });
  }
  json(res, 405, { error: "method not allowed" });
}).listen(PORT, "0.0.0.0", () => console.log(`inbox on :${PORT}, data in ${DIR}`));
