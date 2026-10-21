// Read-only health check of the public judge landing page; no Qloo/Claude API credits consumed.
// Runs on CI. Exits nonzero if the deployed site cannot be used for live judging.
const origin = process.env.TASTE_BRIEF_DEMO_URL || "https://taste-brief.thelongmarketing.workers.dev";
const get = async (path) => {
  const url = new URL(path, origin);
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000),
    headers: { Accept: path === "/api/health" ? "application/json" : "text/html" } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
};

try {
  const home = await get("/");
  const html = await home.text();
  if (!/<title>[^<]*Taste Brief/i.test(html) || !html.includes('id="f"')) {
    throw new Error("GET / returned a page without the Taste Brief form");
  }
  console.log("PASS GET /: landing page and input form accessible");

  const healthResponse = await get("/api/health");
  const health = await healthResponse.json();
  if (health?.ok !== true) throw new Error("Health endpoint is not OK");
  // Never print environment variables, secrets, access codes, or quota identifiers.
  console.log(`HEALTH flags: live_qloo=${Boolean(health.live_qloo)}, live_llm=${Boolean(health.live_llm)}, code_required=${Boolean(health.code_required)}`);
  if (!health.live_qloo || !health.live_llm) {
    throw new Error("Production does not advertise Qloo and Claude as live");
  }
  if (!health.code_required) {
    throw new Error("Production does not advertise a judge access-code mechanism");
  }
  console.log("PASS GET /api/health: live integration and private judge code available");
} catch (error) {
  console.error("PUBLIC DEMO SMOKE FAILED:", error?.message || String(error));
  process.exitCode = 1;
}
