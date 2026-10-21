# Taste Brief

An agent for brands buying podcast and social ads. Give it a product, a market and your brand or a close competitor; it
reads the audience's taste in Qloo (brands, artists, shows, podcasts, places, age and gender) and returns the podcasts to
sponsor first, Meta interests, creative angles, partners and up to three ad tests, each changing one thing from an obvious
control and locked before spending. Every structured recommendation cites its Qloo sources, and code checks the cited ids
and values against what Qloo returned.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).

## Does Qloo pick what brands really pay for?

The answer key is money: sponsor reads that podcasts publish in their own episode notes (public RSS), never shown to
Qloo. Hypotheses were locked and pushed before any held-out show was read
([docs/podcast-check/PREREGISTRATION.md](docs/podcast-check/PREREGISTRATION.md)). On 259 held-out US podcasts and 76
brands, shown one show a brand paid for and one it didn't, Qloo ranked the paid one higher 66% of the time (AUC 0.663,
95% CI 0.630 to 0.697), against Apple chart rank 0.528, Qloo popularity 0.517 and ad volume 0.581; above chance for 65 of
76 brands, and within the same genre 0.63 against 0.53 (exploratory checks after an independent audit:
[robustness.json](docs/podcast-check/robustness.json)). With a stricter sponsor label (82/100 precise in a hand check, declared before analysis) it is 0.647 on 216
shows and 62 brands. Details and scripts: [docs/podcast-check](docs/podcast-check/), [scripts/podcast](scripts/podcast/).

A second set of benchmarks is graded by Qloo itself on a held-out competitor's audience (61% of Taste Brief's interests
score 0.9+ against 19% for the same model without data), by Meta's interest list (35% targetable and 0.9+ against 13%)
and by a negative control (62% on the right competitor against 27% on an unrelated brand). Details in
[docs/benchmark](docs/benchmark/README.md).

## How it works
- `src/agent.js`: tool-using agent loop on Claude. Tools: `search`, `insights`, `demographics`, `tags`, and
  `submit_brief` (the only way to finish, including the `test_plan`). The agent looks up tags for the product category and passes them next to
  the brand, so the brief reflects the product too. Every item must cite the Qloo `entity_id`s it rests on.
- `src/evidence.js`: the evidence gate. A claim counts as grounded only when the entity ids it cites were returned by a
  Qloo call in the same run; the seed entity grounds only claims about itself, or an age/gender claim whose numbers are
  Qloo's demographics for that seed; affinity numbers quoted in the text must match what Qloo returned; one Meta interest
  per line. The page shows the verified Qloo results (name, affinity, type) next to each line, and flags the rest. This
  proves where a line comes from, not that the marketing idea is right. `unbackedBy` lists what the no-data baseline would
  target that Qloo returned nowhere in the run.
- `src/meta.js`: Meta Marketing API interest search, the check that doesn't use Qloo (`scripts/benchmark-meta.mjs`).
- `src/receipt.js`: server receipts for locked plans (`POST /api/lock`, `GET /api/lock/<sha256>`), kept in KV with the server's
  time and not replaced later (KV has no conditional write, so this is consistency checking, not a notary); real results
  get verdicts only when the receipt matches.
- `public/verdict.js`: lock the test plan (SHA-256 of the control, tests and rule, with a timestamp), write the planning
  sheet named with the plan id, and read an Ads Manager export back with the locked rule. Pure functions, no model.
- `src/podcasts.js`: podcasts ranked by Qloo for the brand with `feature.explainability`, plus the advertisers each
  show's episode notes already run (`src/data/podcast-sponsors.json`, 662 shows; evidence only, never used to rank).
- `src/grade.js`: one grader for any list of picks: exact name lookup in Qloo, then the affinity Qloo gives that
  entity for the brand's audience in the market (`filter.results.entities`). Used by the page and the benchmark.
- `src/markets.js`: the second market, without a model in between. Places use `filter.location.query`, so each list is
  real places in that city. Brands, artists and TV use the same insights call per city; the city only nudges Qloo's
  ranking, so the top 12 of each list are compared (only in A, only in B, in both).
- `src/qloo.js`: Qloo client for `https://hackathon.api.qloo.com` (GET + `X-Api-Key`), trims verbose fields, keeps at
  most two requests in flight, retries HTTP 429 with backoff, times out hung calls.
- `src/llm.js`: Claude adapter (Messages API tool use) and a scripted stand-in model for tests and synthetic mode.
- `src/mock-qloo.js`: synthetic data with the same shapes. No real Qloo responses are stored here (Qloo's terms).
- `src/worker.js` + `public/`: Cloudflare Worker serving the page and `POST /api/brief`. The agent and a no-data baseline
  (same question, no Qloo) run side by side; every step is streamed to the page as NDJSON while it happens.

## Live demo
https://taste-brief.thelongmarketing.workers.dev (Cloudflare Worker). **See a recorded live run now** shows the last real run
of the page's example instantly (kept in KV, only for that exact example, never for what a visitor types). A live run calls Qloo and Claude, so the public
page allows a limited number of free live runs per day; judges also have an access code in the submission for unlimited
live runs. When neither applies the page runs on synthetic data and says so in a banner.

![The same question with and without Qloo, both lists scored by Qloo for the audience](docs/screenshots/0-with-and-without.png)
![What to test first: each test changes one thing from the obvious ad set, with the Qloo results it rests on](docs/screenshots/1-what-to-test.png)
![The brief, with the Qloo result each item cites](docs/screenshots/2-brief.png)
![Lock it, run it, read it back: the plan is locked with a SHA-256 fingerprint, then the Ads Manager export is judged by the locked rule (sample numbers, labelled)](docs/screenshots/3-lock-run-read-back.png)

## Run
Requires Node 20 or newer.
```bash
npm test                          # the full offline test suite, no network
node scripts/evidence-gate.mjs    # agent end to end on synthetic data; fails if any claim is unsupported
npm run dev                       # local Worker on synthetic data (MOCK=1)
```
Real run: create `.dev.vars` (git-ignored) with `ANTHROPIC_API_KEY=...` and `QLOO_API_KEY=...`, then either
`npm run live -- "Wool running sneakers, $120" "London, UK" "Allbirds"` (command line, result in `.results/`) or
`npx wrangler dev --var MOCK:0`. `GATE_LIVE=1 node scripts/evidence-gate.mjs` runs the evidence gate on live data.
Deploy: `npx wrangler secret put` for both keys (and `DEMO_CODE` for the access code), create a KV namespace for the
daily free-run counter (`npx wrangler kv namespace create QUOTA`, id into `wrangler.jsonc`), then `npm run deploy`.
Keys stay server-side; never commit them.

## Blind check
`docs/blind-check/` holds a blind comparison of a Qloo plan and a plain AI plan from the same live run, judged by ChatGPT and
Claude in both orders, with the prompts and every answer. Result in short: 3 of 4 would fund the plain runner plan first,
all 4 rated the Qloo plan more distinctive and all 4 picked one of its tests to run first. The test plan now always runs
against the obvious ad set as the control.

## CI on GitLab
The repository also carries a GitLab pipeline: `.gitlab-ci.yml` runs the unit tests and the evidence gate (report as an
artifact), secret detection, dependency scanning and SAST, deploys the Worker from the default branch and smoke-tests the
live URL. `.gitlab/duo/flows/` holds two GitLab Duo flows: an MR reviewer that flags changes that could let an unsupported
claim through, and a pipeline-failure triage that never lowers the evidence threshold or deletes tests.

## Limitations
- Qloo describes aggregate taste affinities of groups, not purchases and not what any one person will do; a brief is a
  hypothesis to test with ads, not a forecast.
- Qloo's demographics are for the seed entities and are not location-specific; the market comparison uses insights.
- Creative angles, the landing page, the summary and the test plan are the model's interpretation of the cited results,
  and are labelled so.
- The city comparison looks at each city's top 12; a name missing from one top 12 may still rank lower there.
- Interest names must be checked in Meta Ads Manager before use.
- When Qloo returns a wrong match (e.g. a magazine for a shoe brand) the agent is told to skip it and say so; it may miss.

Built by a marketer with AI coding assistance (Claude Code); every change reviewed and tested. License: MIT.
