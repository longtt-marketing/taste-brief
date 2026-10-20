// CI quality gate: run the agent (mock data unless QLOO_API_KEY + ANTHROPIC_API_KEY are set and GATE_LIVE=1),
// check every claim against what Qloo returned, and fail the pipeline if any claim is unsupported.
// Writes evidence-report.json (CI artifact) so a reviewer or agent can see which line failed and why.
import { writeFileSync } from "node:fs";
import { runAgent } from "../src/agent.js";
import { mockQloo } from "../src/mock-qloo.js";
import { makeQloo } from "../src/qloo.js";
import { mockLLM, anthropicLLM } from "../src/llm.js";
import { checkEvidence } from "../src/evidence.js";

const live = process.env.GATE_LIVE === "1" && process.env.QLOO_API_KEY && process.env.ANTHROPIC_API_KEY;
const MIN = Number(process.env.GATE_MIN_RATIO || 1);
const cases = [["Allbirds", "London"], ["Allbirds", "Hanoi"]];
const report = { mode: live ? "live" : "mock", min_ratio: MIN, cases: [] };
let ok = true;
for (const [product, market] of cases) {
  const llm = live ? anthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID }) : mockLLM();
  const qloo = live ? makeQloo({ apiKey: process.env.QLOO_API_KEY }) : mockQloo();
  const { brief, sources } = await runAgent({ llm, qloo, product, market });
  const r = checkEvidence(brief, sources);
  const pass = r.total > 0 && r.ratio >= MIN;
  ok &&= pass;
  report.cases.push({ product, market, pass, grounded: r.grounded, total: r.total, unsupported: r.rows.filter((x) => !x.grounded) });
  console.log(`${pass ? "PASS" : "FAIL"} ${product} / ${market}: ${r.grounded}/${r.total} claims grounded in Qloo results`);
}
writeFileSync("evidence-report.json", JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
