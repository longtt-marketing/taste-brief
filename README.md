# Taste Brief

An agent for performance marketers. Give it a product and a market; it asks Qloo's taste graph whose tastes overlap with
the product, what else that audience loves (brands, artists, shows, podcasts, places) and how it skews by age and gender,
then writes a campaign brief: audience portrait, Meta Ads interests, creative angles, a landing-page headline and
partnership ideas. Every line is checked against the Qloo results it cites, and a second market is compared on Qloo's own
numbers, so the brief can be checked instead of trusted.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).

## How it works
- `src/agent.js`: tool-using agent loop on Claude. Tools: `search`, `insights`, `demographics`, `tags`, and
  `submit_brief` (the only way to finish). Every item of the brief must cite the Qloo `entity_id`s it rests on.
- `src/evidence.js`: the evidence gate. A claim counts as grounded only when the entity ids it cites were returned by a
  Qloo call in the same run; the seed entity grounds only claims about itself, or an age/gender claim whose numbers are
  Qloo's demographics for that seed; affinity numbers quoted in the text must match what Qloo returned; one Meta interest
  per line. The page shows the verified Qloo results (name, affinity, type) next to each line, and flags the rest.
- `src/markets.js`: the second market, without a model in between: the same Qloo insights call on the agent's seed
  entities for each market, compared by rank and affinity (what is only in A, only in B, in both).
- `src/qloo.js`: Qloo client for `https://hackathon.api.qloo.com` (GET + `X-Api-Key`), trims verbose fields, keeps at
  most two requests in flight, retries HTTP 429 with backoff, times out hung calls.
- `src/llm.js`: Claude adapter (Messages API tool use) and a scripted stand-in model for tests and synthetic mode.
- `src/mock-qloo.js`: synthetic data with the same shapes. No real Qloo responses are stored here (Qloo's terms).
- `src/worker.js` + `public/`: Cloudflare Worker serving the page and `POST /api/brief`. The agent and a no-data baseline
  (same question, no Qloo) run side by side; every step is streamed to the page as NDJSON while it happens.

## Live demo
https://taste-brief.thelongmarketing.workers.dev (Cloudflare Worker). A live run calls Qloo and Claude, so the public
page allows a limited number of free live runs per day; judges also have an access code in the submission for unlimited
live runs. When neither applies the page runs on synthetic data and says so in a banner.

![Brief with the verified Qloo results behind every line](docs/screenshots/1-brief.png)
![Two markets compared on Qloo's own numbers, and the same question without Qloo](docs/screenshots/2-compare.png)

## Run
Requires Node 20 or newer.
```bash
npm test                          # 19 tests, no network
node scripts/evidence-gate.mjs    # agent end to end on synthetic data; fails if any claim is unsupported
npm run dev                       # local Worker on synthetic data (MOCK=1)
```
Real run: create `.dev.vars` (git-ignored) with `ANTHROPIC_API_KEY=...` and `QLOO_API_KEY=...`, then either
`npm run live -- "Wool running sneakers, $120" "London, UK" "Allbirds"` (command line, result in `.results/`) or
`npx wrangler dev --var MOCK:0`. `GATE_LIVE=1 node scripts/evidence-gate.mjs` runs the evidence gate on live data.
Deploy: `npx wrangler secret put` for both keys (and `DEMO_CODE` for the access code), create a KV namespace for the
daily free-run counter (`npx wrangler kv namespace create QUOTA`, id into `wrangler.jsonc`), then `npm run deploy`.
Keys stay server-side; never commit them.

## CI on GitLab
The repository also carries a GitLab pipeline: `.gitlab-ci.yml` runs the unit tests and the evidence gate (report as an
artifact), secret detection, dependency scanning and SAST, deploys the Worker from the default branch and smoke-tests the
live URL. `.gitlab/duo/flows/` holds two GitLab Duo flows: an MR reviewer that flags changes that could let an unsupported
claim through, and a pipeline-failure triage that never lowers the evidence threshold or deletes tests.

## Limitations
- Qloo describes aggregate taste affinities of groups, not purchases and not what any one person will do; a brief is a
  hypothesis to test with ads, not a forecast.
- Qloo's demographics are for the seed entities and are not location-specific; the market comparison uses insights.
- Creative angles and the landing page are the model's interpretation of the cited results, and are labelled so.
- Interest names must be checked in Meta Ads Manager before use.
- When Qloo returns a wrong match (e.g. a magazine for a shoe brand) the agent is told to skip it and say so; it may miss.

Built by a marketer with AI coding assistance (Claude Code); every change reviewed and tested. License: MIT.
