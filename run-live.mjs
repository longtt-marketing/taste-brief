// One real run from the command line, no browser or deploy needed:
//   node run-live.mjs "Wool running sneakers, $120" "London, UK" "Allbirds, Veja"
// Reads keys from .dev.vars (git-ignored). With a Claude key but no Qloo key: real Claude + synthetic Qloo data.
// The full result goes to .results/ (git-ignored: Qloo's terms do not allow publishing their data). Keys are never printed.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { runAgent, runBaseline, BASELINE_SYSTEM, TOOLS } from "./src/agent.js";
import { makeQloo } from "./src/qloo.js";
import { mockQloo } from "./src/mock-qloo.js";
import { anthropicLLM } from "./src/llm.js";

const vars = {};
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
    if (m && m[2]) vars[m[1]] = m[2];
  }
}
if (!vars.ANTHROPIC_API_KEY) {
  console.error("No ANTHROPIC_API_KEY in .dev.vars: add the key after the = sign and save the file.");
  process.exit(2);
}
const [product = "Wool running sneakers, $120, sustainable", market = "London, UK", references = "Allbirds"] = process.argv.slice(2);
const model = vars.MODEL || undefined;
const ws = vars.ANTHROPIC_WORKSPACE_ID || undefined;
const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: ws, model });
const baseLLM = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: ws, model, system: BASELINE_SYSTEM,
  tools: TOOLS.filter((t) => t.name === "submit_brief") }); // the model does not accept a forced tool_choice
const qloo = vars.QLOO_API_KEY ? makeQloo({ apiKey: vars.QLOO_API_KEY }) : mockQloo();
const mode = vars.QLOO_API_KEY ? "live Claude + live Qloo" : "live Claude + SYNTHETIC Qloo (no Qloo key)";

console.log(`Mode: ${mode}\nProduct: ${product} | Market: ${market}\n`);
const t0 = Date.now();
let out, baseline;
try {
  [out, baseline] = await Promise.all([
    runAgent({ llm, qloo, product, market, references }),
    runBaseline({ llm: baseLLM, product, market, references }).catch((e) => ({ error: String(e.message || e) })),
  ]);
} catch (e) {
  const msg = String(e.message || e);
  console.error("ERROR:", msg.slice(0, 400));
  if (/workspace/i.test(msg)) console.error("-> Add ANTHROPIC_WORKSPACE_ID=wrkspc_... to .dev.vars (Console > Settings > Workspaces).");
  process.exitCode = 1;
}
if (out) {
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("What the agent asked Qloo:");
  for (const t of out.trace) console.log(`  - ${t.tool}${t.n !== undefined ? ` -> ${t.n} results` : ""}${t.error ? `  ERROR: ${t.error}` : ""}`);
  console.log("\nAudience summary:", out.brief.audience_summary);
  console.log("Meta interests:", (out.brief.meta_interests || []).map((i) => i.interest).join(" | "));
  console.log("Without Qloo, the model guessed:", (baseline.meta_interests || []).map((i) => i.interest).join(" | ") || baseline.error);
  const u = [llm.usage, baseLLM.usage].reduce((a, b) => ({ calls: a.calls + b.calls, input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens }));
  console.log(`\n${seconds} s · ${u.calls} Claude calls · ${u.input_tokens} input tokens · ${u.output_tokens} output tokens`);
  mkdirSync(".results", { recursive: true });
  const f = `.results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(f, JSON.stringify({ mode, product, market, references, seconds, usage: u, ...out, baseline }, null, 1));
  console.log("Full result:", f);
}
