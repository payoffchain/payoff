/**
 * Local JSON-RPC pass-through for a network whose hostname the local ISP resolver
 * hijacks. Resolves the upstream over DNS-over-HTTPS once, then forwards every request
 * with the real hostname as TLS servername, so the certificate still verifies.
 *
 *   node scripts/rpc-proxy.mjs [upstream-host] [port]
 *   RPC_URL=http://127.0.0.1:8545 ...
 *
 * Development convenience only. It never sees a key: keys sign locally, only signed
 * transactions pass through it.
 *
 * Resilience: the upstream sits behind Cloudflare, which resets connections often from
 * here. Connections are kept alive and reused, every upstream IP from DNS is tried in
 * rotation, and each request is retried up to five times with backoff. That is safe for
 * JSON-RPC: reads are idempotent and re-broadcasting the same signed transaction is a
 * no-op (same hash).
 */
import { createServer } from "node:http";
import https from "node:https";

const HOST = process.argv[2] ?? "rpc.mainnet.chain.robinhood.com";
const PORT = Number(process.argv[3] ?? 8545);
const RETRIES = 5;

async function resolveDoH(host) {
  const res = await fetch(`https://dns.google/resolve?name=${host}&type=A`);
  const j = await res.json();
  const ips = (j.Answer ?? []).filter((x) => x.type === 1).map((x) => x.data);
  if (!ips.length) throw new Error(`DoH could not resolve ${host}`);
  return ips;
}

const ips = await resolveDoH(HOST);
let rotate = 0;
const agent = new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 10_000 });
console.log(`${HOST} -> ${ips.join(", ")}; listening on http://127.0.0.1:${PORT} (retries ${RETRIES}, keep-alive)`);

function forward(method, path, body, ip) {
  return new Promise((resolve, reject) => {
    const up = https.request(
      {
        host: HOST,
        servername: HOST,
        lookup: (_h, opts, cb) => (opts && typeof opts === "object" && opts.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
        port: 443,
        method,
        path,
        agent,
        timeout: 30_000,
        headers: { "content-type": "application/json", "content-length": body.length, host: HOST, connection: "keep-alive" },
      },
      (upRes) => {
        const chunks = [];
        upRes.on("data", (c) => chunks.push(c));
        upRes.on("end", () => resolve({ status: upRes.statusCode ?? 502, type: upRes.headers["content-type"] ?? "application/json", body: Buffer.concat(chunks) }));
        upRes.on("error", reject);
      }
    );
    up.on("timeout", () => up.destroy(new Error("upstream timeout")));
    up.on("error", reject);
    up.end(body);
  });
}

let failures = 0;
createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    let lastErr = null;
    const base = rotate;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      const ip = ips[(base + attempt - 1) % ips.length];
      try {
        const out = await forward(req.method, req.url, body, ip);
        res.writeHead(out.status, { "content-type": out.type });
        res.end(out.body);
        return;
      } catch (e) {
        lastErr = e;
        failures += 1;
        rotate += 1; // next request starts on the other IP
        if (attempt === 1 || attempt === RETRIES) console.error(`upstream ${ip} error (attempt ${attempt}/${RETRIES}, total ${failures}): ${e.message}`);
        await new Promise((r) => setTimeout(r, 200 * attempt + Math.random() * 200));
      }
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: lastErr?.message ?? "upstream failed" }));
  });
}).listen(PORT, "127.0.0.1");
