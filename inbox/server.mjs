// A small private inbox for messages visitors leave on the site.
// POST /messages  (x-inbox-key: INBOX_WRITE_KEY)  { name?, contact?, message }  -> stored
// GET  /messages  (x-inbox-key: INBOX_READ_KEY)                                   -> newest first
// Messages live in one JSON-lines file on the Railway volume at /data.
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DIR = process.env.DATA_DIR || "/data";
const FILE = `${DIR}/messages.jsonl`;
const WRITE = process.env.INBOX_WRITE_KEY || "";
const READ = process.env.INBOX_READ_KEY || "";
const PORT = Number(process.env.PORT || 8080);
if (!WRITE || !READ) { console.error("INBOX_WRITE_KEY and INBOX_READ_KEY are required"); process.exit(1); }
mkdirSync(DIR, { recursive: true });

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

function readAll() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return json(res, 200, { ok: true, count: readAll().length });
  if (url.pathname !== "/messages") return json(res, 404, { error: "not found" });
  const key = req.headers["x-inbox-key"];
  if (req.method === "GET") {
    if (key !== READ) return json(res, 401, { error: "unauthorized" });
    const all = readAll().reverse();
    return json(res, 200, { count: all.length, messages: all.slice(0, Math.min(Number(url.searchParams.get("limit")) || 500, 2000)) });
  }
  if (req.method === "POST") {
    if (key !== WRITE) return json(res, 401, { error: "unauthorized" });
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 8000) req.destroy(); });
    req.on("end", () => {
      let b; try { b = JSON.parse(raw || "{}"); } catch { return json(res, 400, { error: "bad json" }); }
      const message = clean(b.message, 1000);
      if (message.length < 2) return json(res, 400, { error: "message is empty" });
      const row = { id: randomUUID(), at: new Date().toISOString(), name: clean(b.name, 40), contact: clean(b.contact, 80), message, ip: clean(b.ip, 64) };
      appendFileSync(FILE, JSON.stringify(row) + "\n");
      json(res, 201, { ok: true, id: row.id });
    });
    return;
  }
  json(res, 405, { error: "method not allowed" });
}).listen(PORT, "0.0.0.0", () => console.log(`inbox on :${PORT}, data in ${DIR}`));
