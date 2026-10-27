// Live operational QA on a loopback preview only. Full responses remain in ignored .results/.
// See docs/qa-round2-plan.md. Never collects new sponsor feeds or writes production state.
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { archivedShows } from "../public/contacts.js";
import { policyBlocks } from "../public/rank.js";
import { readyTests } from "../public/verdict.js";
import { reviewDraft } from "../public/draft-checks.js";
import { buyerDecision } from "../public/buyer-decision.js";

if (!process.argv.includes("--live")) throw new Error("Use --live to acknowledge live-provider calls through the local preview.");
const base = new URL(process.argv.find((a) => a.startsWith("http")) || "http://127.0.0.1:8793");
if (base.hostname !== "127.0.0.1" || base.protocol !== "http:") throw new Error("QA endpoint must be an HTTP loopback preview.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const attempt = new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve(root, ".results", "qa-round2", attempt);
await mkdir(dir, { recursive: true });
const files = ["src/agent.js", "src/llm.js", "src/worker.js", "src/outreach.js", "src/evidence.js", "public/buyer-decision.js", "public/verdict.js", "public/draft-checks.js", "public/contacts.js", "public/data/podcast-contacts.js", "public/rank.js", "src/selfcheck.js", "src/grade.js"];
const source = createHash("sha256");
for (const file of files) source.update(file).update(await readFile(resolve(root, file)));
const report = { attempt, at: new Date().toISOString(), protocol: "docs/qa-round2-plan.md", source_sha256: source.digest("hex"), cases: [] };
const cases = [
  { key: "coffee", product: "Specialty coffee subscription, $25/month", market: "Austin, TX", compare_market: "Seattle, WA", references: "Blue Bottle Coffee", rivals: "allow" },
  { key: "sneakers", product: "Wool running sneakers, $120", market: "New York, NY", compare_market: "London, UK", references: "Allbirds", rivals: "skip" },
  { key: "turntable", product: "Beginner turntable, $250", market: "Chicago, IL", compare_market: "Los Angeles, CA", references: "Audio-Technica", rivals: "allow" },
];
const choice = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
if (choice && !cases.some((c) => c.key === choice)) throw new Error("Unknown declared case");
const selectedCases = choice ? cases.filter((c) => c.key === choice) : cases;
console.log(`QA attempt ${attempt}. ${selectedCases.length} declared case(s), all results retained.`);
for (const { key, ...input } of selectedCases) {
  const start = Date.now();
  console.log(`START ${key}`);
  let result = null, failure = null, buffer = "", partialSeconds = null;
  try {
    const response = await fetch(new URL("/api/brief", base), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, stream: true }), signal: AbortSignal.timeout(220000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      const text = decoder.decode(chunk, { stream: true });
      await appendFile(resolve(dir, `${key}.ndjson`), text);
      buffer += text;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "shortlist") { partialSeconds ??= event.seconds; console.log(`SHORTLIST ${key}: ${event.seconds}s`); }
        if (event.type === "result") result = event;
        if (event.type === "error") failure = event.error;
      }
    }
    if (!result) throw new Error(failure || "No final result");
    await writeFile(resolve(dir, `${key}.json`), JSON.stringify(result, null, 2));
    const pods = result.podcasts, candidates = pods?.shows || [], drafts = pods?.outreach?.shows || [];
    const selected = drafts.map((d) => candidates.find((s) => s.name === d.show));
    const problems = [];
    if (result.mode !== "live") problems.push("not live");
    if (result.incomplete) problems.push(`incomplete: ${result.incomplete}`);
    if (result.check?.ratio !== 1) problems.push("some structured claims failed the evidence gate");
    if (!drafts.length || drafts.length > 3) problems.push("missing or excessive shortlist");
    if (selected.some((s) => !s)) problems.push("selection outside returned candidates");
    if (drafts.some((d) => !reviewDraft(d, { product: input.product, fit: candidates.find((s) => s.name === d.show)?.affinity, rivals: candidates.find((s) => s.name === d.show)?.rivals }).passed)) problems.push("some outreach drafts remain held");
    if (new Set(drafts.map((d) => d.show)).size !== drafts.length) problems.push("duplicate selected shows");
    if (archivedShows(selected.filter(Boolean)).length) problems.push("archived show chosen for new host reads");
    if (policyBlocks(selected.filter(Boolean), input.rivals).length) problems.push("rival policy violated");
    const checks = drafts.map((d) => { const s = candidates.find((x) => x.name === d.show); const r = reviewDraft(d, { product: input.product, fit: s?.affinity, rivals: s?.rivals });
      return { show: d.show, passed: r.passed, issues: r.issues, next: buyerDecision(s, { market: input.market, category: pods?.category, policy: input.rivals }).status }; });
    const row = { key, input, completed: true, run: result.run, observed_seconds: Math.round((Date.now() - start) / 1000),
      provisional_seconds: partialSeconds, candidates: candidates.length, selected: drafts.map((d) => d.show),
      grounded: result.check, ready_tests: readyTests(result.brief?.test_plan, result.meta_check, input.product).length,
      proposed_tests: result.brief?.test_plan?.length || 0, drafts: checks, problems,
      timing_target_pass: partialSeconds != null && partialSeconds <= 45 && result.run?.seconds <= 120 };
    report.cases.push(row);
    console.log(JSON.stringify({ key, run: row.run, selected: row.selected, ready_tests: row.ready_tests, draft_passes: checks.filter((d) => d.passed).length, problems, timing_target_pass: row.timing_target_pass }));
  } catch (e) {
    report.cases.push({ key, input, completed: false, seconds: Math.round((Date.now() - start) / 1000), error: String(e.message || e) });
    console.log(`FAILED ${key}: ${String(e.message || e)}`);
  }
  await writeFile(resolve(dir, "summary.json"), JSON.stringify(report, null, 2));
}
console.log(`QA report saved privately: ${dir}`);
if (report.cases.some((x) => !x.completed || x.problems.length)) process.exitCode = 1;
