# Judge-facing evidence and decision case — 20 October 2026

**Status:** Reviewer draft. Do not represent this document as live-verified by an independent person. Repository source inspection performed on commit `0f067e58529f05f35669d4fbdba4e18719668e09`; production behavior and user-supplied Qloo run numbers require independent reproduction before final submission.

## The decision this product changes

**Problem:** A performance marketer launching $120 wool running sneakers needs a *testable* audience/creative angle. A generic LLM may assume its market is performance runners and suggest Strava, parkrun or competitor running brands, but this is not evidence that those interests over-index for the seed brand's audience.

**Controlled contrast:** Use the same product and prompt for (1) plain AI without Qloo and (2) a Qloo-backed agent, with **Allbirds as a comparable-brand seed** and **London as the location signal**. Compare a second market, Hanoi, separately. The product itself is *not known to Qloo*, and audiences for Allbirds are a proxy, not proven purchasers of the proposed wool shoes.

**Observed in the owner's 20 Oct 2026 live run (must be reproduced independently):**
- The owner reports 21/21 generated rows citing IDs returned by Qloo during the same London/Hanoi run.
- The plain model's unguided suggestions included Strava, parkrun and On/Hoka. The Qloo outputs supported a different initial hypothesis, oriented toward studio fitness and wellness, with entities such as ClassPass, Peloton, Outdoor Voices and Tracksmith.
- Qloo's **seed demographic index**, NOT London-only demographics, was female +0.33 and ages 30–34 +0.42. Neither number means 33% women or 42% of customers are 30–34.
- These are aggregate taste signals. They do **not** prove demand, Meta targeting availability, or positive advertising ROI.

**One decision worth testing:** Instead of committing the campaign exclusively to "serious runner" creative, add a competing **studio-fitness / wellness-lifestyle** treatment whose names/associations match retrieved Qloo entities. Do not suppress the runner treatment because Qloo did not return it in one query. Lack of a result is *not* evidence that a target is wrong.

### Proposed small and falsifiable experiment (not run)

| Group | Audience / creative treatment | KPI | Stopping and interpretation |
|---|---|---|---|
| A (control) | Running-performance message, same product and landing page | Link CTR and cost per qualified landing-page view | Use as reference; platform interest targeting must first be checked in Ads Manager |
| B (Qloo hypothesis) | Studio-fitness / wellness-lifestyle message, same product and landing page | Same metrics, measured in the same period | Pause B if costs materially exceed A after a predeclared minimum sample; do not claim significance from tiny samples |

Hold creative production quality, budget, product price and landing page as constant as practical. Choose exact spend, impressions and thresholds **before launch**; no advertising or human study has yet established uplift. Qloo is a **hypothesis generator**, not an experiment result.

## What the code does, and what it does not

- `src/qloo.js`: GET `/search`, `/v2/tags`, `/v2/insights` with location and demographic signals; Qloo key stays server-side; limited concurrency and 429 retry.
- `src/agent.js`: Claude tool-use loop finds seeds/tags, requests cross-domain affinities, submits structured brief and ad-test plan.
- `src/evidence.js`: verifies that cited IDs were observed during that run; checks reported affinity values, seed demographic values and that named Meta interests/partners match cited entities. This is **provenance / attribution checking**, not semantic truth or causal validation.
- `src/markets.js`: compares top 12 ranked results in each market. "Only in London's top 12" does **not** mean "does not exist in Hanoi"; cities nudge rankings for non-place types, rather than providing resident-level demographics.
- `src/worker.js`: live Qloo/Claude for valid judge code; public free-run quota with explicit synthetic-data mode after exhaustion. A judge must have a functioning access code; live availability on the deployed service has **not** been reproduced during this independent review.
- `scripts/evidence-gate.mjs`: synthetic by default; `GATE_LIVE=1` with credentials is needed to verify real API behavior. Owner reports live-gate counts London 20/20, Hanoi 18/18, Seoul 21/21; no raw run trace or independent live verification was provided in this review.

**Critical boundary:** No claim is currently made about Meta Ads conversions, sales, audience size or demand. Matching citations proves source lineage, not correctness of the advertising strategy.

## Submission and eligibility checks (owner / Claude to verify)

- [ ] In Devpost text, show the exact **before → Qloo signal → changed testable decision** above; do not overclaim conversion impact.
- [ ] Verify judge access code at the deployed URL from a browser session without prior authentication and check the response says `mode:live`; never publish the code to GitHub.
- [ ] Verify the Devpost entry's links really point to this repository and deployment, and the video shows the *current* live workflow. Avoid any statement that the judge **must** run the demo; rules allow judging by text/video only.
- [ ] Provide a redacted screenshot/report of one real run with Qloo request types, cited entities, evidence ratio, fallback state and chosen decision; **do not commit restricted raw Qloo API payloads** or credentials.
- [ ] Confirm the public MIT license is visible from GitHub's repository summary/About, not only as a file.
- [ ] Confirm no employer IP, customer data, private API credentials, copyrighted media without license or misleading demographic statements are in the entry.
- [ ] Re-run `npm test`, then `GATE_LIVE=1 node scripts/evidence-gate.mjs` using private credentials and the three predeclared examples. Record aggregate pass/fail and which errors occurred, **without publishing private data**.
- [ ] Ensure there are no new regressions under 429/timeout, free daily quota exhaustion or baseline failure; ordinary users must see explicit source-mode labels.
- [ ] Verify submitted entry edits before Oct 30, 2026 23:45 EDT (Oct 31 10:45 UTC+7), and save the Devpost submission receipt; do not assume the GitHub push updates Devpost text.

## Competitive positioning — important discovery

A **different entrant**, credited on Devpost to *Hoa Nguyen*, appears to have an unrelated project also titled **Taste Brief** (https://devpost.com/software/taste-brief). It targets Vietnamese hospitality operators and cultural tourist affinities, with a different codebase and market-comparison approach. This does not prove any copied work or violation.

**Action:** Distinguish the submission title/tagline clearly, e.g. **“Taste Brief — Evidence-Gated Ad Experiments”** (owner should approve and edit Devpost directly). Explain that the differentiator is **auditable evidence-to-test workflows for performance marketers**, not generic itinerary recommendations or simply writing copy from a Qloo list. Do not claim exclusivity or that no other project addresses marketing.

## Suggested concise Devpost passage (draft, not published)

> **One decision Qloo changed.** For $120 wool running shoes, a plain LLM suggested runner targeting such as Strava and parkrun. Using Allbirds as a comparable-brand seed, our live Qloo run surfaced a different testable angle: studio fitness and wellness, including ClassPass, Peloton and Outdoor Voices. Taste Brief did not proclaim runners wrong. It created a controlled ad-test hypothesis that a marketer could run next to the original idea. Every recommended test cites the Qloo entity IDs used; the evidence gate checks returned IDs and quoted affinity numbers, and shows unsupported lines explicitly. The +0.33 female and +0.42 age 30–34 indexes come from Qloo's seed demographics, not from London residents. We have not run ads or proven conversion lift. The value is making a better-grounded decision about **what to test**, not predicting who will buy.

**Reward note:** Official rules state the prize depends on judges, compliance, winner identity verification and required forms; prize delivery may take up to 60 days after completed forms. No engineering work can guarantee winning or bank receipt. https://qloo.devpost.com/rules
