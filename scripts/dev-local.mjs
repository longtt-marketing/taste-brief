// Local-only preview using the actual Worker handler; no Cloudflare account or deployment required.
// Default is labelled synthetic. --live reads existing ignored .dev.vars and uses the real providers.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import worker from "../src/worker.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");
const live = process.argv.includes("--live");
const port = Number(process.env.PORT || 8791);
const env = { MOCK: "1", FREE_DAILY: "25", CF_VERSION_METADATA: { id: "local-development" } };
if (live) {
  const content = await readFile(resolve(root, ".dev.vars"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
    if (m && m[2]) env[m[1]] = m[2];
  }
  if (!env.QLOO_API_KEY || !env.ANTHROPIC_API_KEY) throw new Error("Live preview requires both provider keys in .dev.vars.");
  env.MOCK = "0";
  // The preview is bound to loopback; it never writes the production replay or quota namespace.
  delete env.DEMO_CODE;
}
const kv = new Map();
env.QUOTA = { get: async (key) => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, value); } };
const replayFlag = process.argv.indexOf("--replay-file");
if (replayFlag >= 0) {
  const path = process.argv[replayFlag + 1];
  if (!path) throw new Error("--replay-file needs a saved live result path.");
  const saved = JSON.parse(await readFile(resolve(root, path), "utf8"));
  if (saved.mode !== "live" || !saved.brief || !saved.run?.at || saved.incomplete) throw new Error("Replay must be a completed saved live result.");
  const { quota, access, type, ...keep } = saved;
  kv.set("replay:example", JSON.stringify({ ...keep, mode: "replay", recorded: { at: saved.run.at, version: saved.run.version,
    inputs: { product: saved.product, market: saved.market, compare_market: saved.compare_market, references: saved.references, rivals: saved.rival_policy } } }));
}
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
env.ASSETS = { fetch: async (request) => {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const relative = pathname === "/" ? "index.html" : pathname === "/judge" ? "judge.html" : pathname.slice(1);
  const path = resolve(publicRoot, relative);
  if (!path.startsWith(publicRoot + sep)) return new Response("Forbidden", { status: 403 });
  try { return new Response(await readFile(path), { headers: { "content-type": types[extname(path)] || "application/octet-stream" } }); }
  catch { return new Response("Not found", { status: 404 }); }
} };

const server = createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413).end("Request too large"); return; }
      chunks.push(chunk);
    }
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
    const result = await worker.fetch(request, env);
    res.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body && req.method !== "HEAD") {
      for await (const chunk of result.body) if (!res.write(chunk)) await once(res, "drain");
    }
    res.end();
  } catch (err) {
    console.error("Preview request failed:", err.message);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Local preview request failed. See terminal.");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Taste Brief preview: http://127.0.0.1:${port} (${live ? "LIVE providers, local storage" : "SYNTHETIC fixtures"})`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
