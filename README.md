# Taste Brief

An agent for performance marketers. Give it a product and a market; it asks Qloo's taste graph whose tastes overlap with
the product, what else that audience loves (brands, artists, shows, podcasts, places) and how it skews by age and gender,
then writes a campaign brief: audience portrait, Meta Ads interests, creative angles, a landing-page headline,
partnership ideas and up to three exploratory ad tests, each changing one thing from an obvious control. Every structured
recommendation cites its Qloo sources, and code checks the cited ids and quoted values against what Qloo returned; the
summary stays the model's reading. A second market is compared on Qloo's own numbers, so the brief can be checked instead
of trusted.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).

## Does Qloo make a difference?

On 20 briefs, each graded on the audience of a competitor the agent never saw (written from Allbirds, graded on Veja),
61% of the Meta interests Taste Brief suggests score an affinity of 0.9 or more on Qloo. The same model with no data
reaches 19% when told to name specific brands and shows, and 1% as the app asks it. Taste Brief is ahead in 19 of 20 briefs
(+42 points, 95% bootstrap interval +32 to +53); on the reference brand's own audience it is 73% against 18%. Graded by
Qloo, so it measures fit with the category's audience, not ad results; details in [docs/benchmark](docs/benchmark/README.md).
The page shows the same scoring for every run.

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
