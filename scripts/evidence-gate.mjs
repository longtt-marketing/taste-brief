// CI quality gate: run the agent (synthetic data unless QLOO_API_KEY + ANTHROPIC_API_KEY are set and GATE_LIVE=1),
// check every claim against the Qloo results of that run (src/evidence.js: cited entity ids must have been returned, the
// seed only grounds claims about itself, quoted affinities must match), and fail if any claim is unsupported.
// Writes evidence-report.json (CI artifact) so a reviewer or agent can see which line failed and why.
import { writeFileSync } from "node:fs";
import { runAgent } from "../src/agent.js";
import { mockQloo } from "../src/mock-qloo.js";
import { makeQloo } from "../src/qloo.js";
import { mockLLM, anthropicLLM } from "../src/llm.js";

const live = process.env.GATE_LIVE === "1" && process.env.QLOO_API_KEY && process.env.ANTHROPIC_API_KEY;
const MIN = Number(process.env.GATE_MIN_RATIO || 1);
const cases = [
  ["Wool running sneakers, $120", "London", "Allbirds"],
  ["Wool running sneakers, $120", "Hanoi", "Allbirds"],
  ["Specialty coffee subscription", "Seoul", "Blue Bottle Coffee"],
];
const report = { mode: live ? "live" : "synthetic", min_ratio: MIN, cases: [] };
let ok = true;
const qloo = live ? makeQloo({ apiKey: process.env.QLOO_API_KEY }) : mockQloo();
for (const [product, market, references] of cases) {
  const llm = live ? anthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID }) : mockLLM();
  const { check } = await runAgent({ llm, qloo, product, market, references });
  const pass = check.total > 0 && check.ratio >= MIN;
  ok &&= pass;
  report.cases.push({ product, market, references, pass, grounded: check.grounded, total: check.total, flagged: check.flagged });
  console.log(`${pass ? "PASS" : "FAIL"} ${product} / ${market}: ${check.grounded}/${check.total} claims verified against Qloo results`);
  for (const f of check.flagged) console.log(`   - ${f.field} "${f.label}": ${f.problems.join("; ")}`);
}
writeFileSync("evidence-report.json", JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
