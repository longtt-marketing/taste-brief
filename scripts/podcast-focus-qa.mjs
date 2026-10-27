import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { archivedShows } from "../public/contacts.js";
import { policyBlocks } from "../public/rank.js";
import { reviewDraft } from "../public/draft-checks.js";
if (!process.argv.includes("--live")) throw new Error("Explicit --live required");
const base = new URL(process.argv.find((x) => x.startsWith("http")) || "http://127.0.0.1:8797");
if (base.hostname !== "127.0.0.1" || base.protocol !== "http:") throw new Error("Loopback only");
const root = new URL("../", import.meta.url), at = new Date().toISOString();
const dir = new URL(`.results/podcast-focus/${at.replace(/[:.]/g, "-")}/`, root);
await mkdir(dir, { recursive: true });
const hash = createHash("sha256");
for (const p of ["src/agent.js", "src/worker.js", "src/llm.js", "src/outreach.js", "src/podcasts.js", "public/draft-checks.js", "public/data/podcast-contacts.js"]) hash.update(p).update(await readFile(new URL(p, root)));
const report = { at, protocol: "docs/podcast-focus-qa.md", source_sha256: hash.digest("hex"), cases: [] };
const cases = [
  { key: "coffee", product: "Specialty coffee subscription, $25/month", market: "Austin, TX", references: "Blue Bottle Coffee", rivals: "allow" },
  { key: "sneakers", product: "Wool running sneakers, $120", market: "New York, NY", references: "Allbirds", rivals: "skip" },
  { key: "turntable", product: "Beginner turntable, $250", market: "Chicago, IL", references: "Audio-Technica", rivals: "allow" },
];
const chosen = process.argv.find((x) => x.startsWith("--case="))?.slice(7);
if (chosen && !cases.some((x) => x.key === chosen)) throw new Error("Unknown declared case");
for (const { key, ...input } of cases.filter((x) => !chosen || x.key === chosen)) {
  console.log(`START ${key}`);
  const start = Date.now(); let result, error, buffer = "";
  try {
    const response = await fetch(new URL("/api/brief", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, focus: "podcasts", stream: true }), signal: AbortSignal.timeout(190000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      const text = decoder.decode(chunk, { stream: true });
      await appendFile(new URL(`${key}.ndjson`, dir), text); buffer += text;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const event = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (event.type === "result") result = event;
        if (event.type === "error") error = event.error;
      }
    }
    if (!result) throw new Error(error || "No result");
    await writeFile(new URL(`${key}.json`, dir), JSON.stringify(result, null, 2));
    const drafts = result.podcasts?.outreach?.shows || [], candidates = result.podcasts?.shows || [];
    const selected = drafts.map((d) => candidates.find((x) => x.name === d.show));
    const problems = [];
    if (result.mode !== "live" || result.scope !== "podcasts") problems.push("wrong mode or scope");
    if (!drafts.length || drafts.length > 3 || new Set(drafts.map((d) => d.show)).size !== drafts.length || selected.some((x) => !x)) problems.push("invalid shortlist");
    if (drafts.some((d, i) => !reviewDraft(d, { product: input.product, fit: selected[i]?.affinity, rivals: selected[i]?.rivals }).passed)) problems.push("held drafts");
    if (archivedShows(selected.filter(Boolean)).length || policyBlocks(selected.filter(Boolean), input.rivals).length) problems.push("policy violation");
    if (result.baseline || result.meta_check || result.markets || result.brief?.test_plan?.length) problems.push("unexpected optional work");
    report.cases.push({ key, input, completed: true, run: result.run, observed_seconds: Math.round((Date.now() - start) / 1000), selected: drafts.map((d) => d.show), problems, timing_target_pass: result.run?.seconds <= 45 });
  } catch (e) { report.cases.push({ key, input, completed: false, seconds: Math.round((Date.now() - start) / 1000), error: e.message }); }
  await writeFile(new URL("summary.json", dir), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.cases.at(-1)));
}
console.log(`Private results: ${dir.pathname}`);
if (report.cases.some((x) => !x.completed || x.problems.length)) process.exitCode = 1;
