# Local validation, 26 October 2026

Status: local revision, not a deployment or a Devpost submission. Codex performed this work without subagents. This is an implementation audit and self-review, not independent human buyer validation.

## Earlier revision: changes checked

- A targeting test must select explicit, cited Qloo entities and match each to a successful Meta lookup with an interest ID. Unknown, failed, unavailable and legacy selections are held. Supporting citations are not automatically targeting choices.
- UI, saved version-2 plan, Markdown and planning CSV share those selected targets. Version-1 receipts remain readable, but missing target selections cannot be inferred as verified.
- Loading an older saved plan uses its market, tests, rule and targets for exports, even when the current brief differs.
- Numeric evidence checks cover percentage, decimal and scientific notation, preserve demographic signs, and reject ambiguous entity identities. These are finite checks, not semantic verification of every sentence.
- Sponsor coverage and category coverage remain unknown when absent. A dated official contact route establishes where to ask, not rates, reach, inventory or exclusivity. Six records cover selected shows; one is explicitly general contact only.
- A provisional podcast shortlist can be read while Meta and comparison checks finish. It is labelled provisional and removed if the run later fails.
- Final draft warnings, Markdown, copy eligibility and model feedback share the same draft checks. Failed drafts remain visible for editing with copy disabled. Passing does not establish that every claim is true.

## Automated evidence

From the application directory:

| Check | Result |
|---|---|
| `npm test` | 103 passed, 0 failed |
| `node scripts/evidence-gate.mjs` | Synthetic London, Hanoi and Seoul: 15/15 structured claims each |
| `python scripts/podcast/verify_lock.py` | All six locked file fingerprints match |
| Extracted `public/index.html` module, `node --check` | Passed |
| `npm exec --offline -- wrangler deploy --dry-run --outdir .results/dry-run-2026-10-26` | Wrangler 4.152.0 build passed; 17 assets, 156.06 KiB bundle / 47.65 KiB gzip; no deployment |
| `git diff --check -- sites/qloo-taste-brief` from the parent workspace | Passed |

The synthetic gate is a regression check, not a measurement of live model quality. The new invalid-identity guards were tested with synthetic bad responses; there is no confirmed Qloo outage. Tool-displayed identifier masking was initially mistaken for an API defect and was corrected after checking the original saved text and in-process identity counts.

## Actual browser and live-provider evidence

One coffee brief used Blue Bottle as the reference, Austin as the market and Seattle as the comparison on 26 October:

- First provisional shortlist: **56 seconds**; complete result: **146 seconds**, **43 Qloo calls**, **8 model calls**. The primary result appeared 90 seconds before completion in this one run. This does not show lower total compute or a general latency improvement.
- Shows selected: 10% Happier with Dan Harris, Home Cooking and The Sporkful. One had sponsor notes in the dataset; two had unknown coverage. Contact sources are a separate directory.
- Two of three proposed tests passed. The targeting test selected Stumptown Coffee Roasters and Sylvan Esso. The test containing unavailable Warby Parker was held despite a successful lookup for Shake Shack.
- Browser-created local receipt **4676d06a**: downloaded JSON holds two tests; downloaded CSV has control plus two rows. The targeted Meta IDs are `6003197219926` and `391261564389969`; neither held interest appears in the exported sheet. The Markdown download also identifies the held test.
- Separate synthetic load test: save Austin plan **e131671d**, open a Chicago brief, reload the Austin JSON, download its sheet. The CSV retained the saved Austin market and Refill Shop creative. IAB completed the file upload after Chrome's file-URL permission prevented it.
- Desktop and 375-pixel checks were inspected. The live mobile viewport reported inner width 375, client width 360 and scroll width 360, with no horizontal overflow. The final draft-warning copy was checked again on synthetic data; the live-provider run preceded that final copy change.

Raw run screenshots, rendered text and downloaded test artifacts remain in the private working folder. They are not a new public dataset of raw Qloo responses. Historical evaluation files and all pre-registration locks are unchanged.

## What remains unproved or unpublished

No verified human buyer pilot, paid campaign result, time-saved study or conversion lift. The agent has not beaten the simple ranking baselines. The retrospective strict-label AUC remains 0.647; the forward collection has not run and must occur only once on 29 or 30 October under its existing registration.

The video, public screenshots and recorded example describe the 22 October version. Older targeting examples without explicit selected IDs will be held by the new contract; do not silently relabel them as current passing plans. The user subsequently authorized public deployment, repository sync and submission edits conditionally on a defensible score of at least 9.5/10. That threshold has not been met; public checks still have to follow an actual deployment. This record does not claim that local changes are already live.

## Round two: buying decisions, copy review and live compatibility

The protocol was written before the runs: [QA plan](qa-round2-plan.md). [All six attempts](qa-round2-results.json) preserve 18 case outcomes across changing development revisions. Six completed; nine failed during schema compilation and three failed at the revision step due to a changed signed conversation prefix. These are development outcomes, not an estimate of production reliability. The final revision completed all three declared cases:

| Case | Draft-ready shortlist | Full result | Qloo / model calls | Draft checks | Timing target |
|---|---:|---:|---:|---:|---|
| Coffee, Austin / Seattle | 35 s | 96 s | 33 / 7 | 3/3 | pass |
| Wool sneakers, New York / London, skip rivals | 51 s | 127 s | 31 / 7 | 3/3 | fail |
| Turntable, Chicago / Los Angeles | 36 s | 122 s | 39 / 9 | 3/3 | fail |

All three final runs had complete structured briefs, matching evidence, distinct choices from the returned candidates and no selected rival-policy violations. No claim that all natural-language product claims were automatically verified. The final turntable selection was The Kinda Funny Podcast, The Legacy Music Hour Video Game Music Podcast and Giant Bombcast; the previous Harmontown recommendation was removed. A score in Qloo does not establish a current publishing schedule or available inventory.

Specific corrections after manual review:

- Each show now has an evidence-appropriate next research action and buying questions covering audience geography, reporting window, delivery, price, format, dates and exclusivity. Eight sourced contact records: six advertising, two general. Publishing observations are separate: four archival shows excluded from new host-read outreach, two with recently observed episodes; everything else remains unknown. No locked sponsor label was changed.
- Independent Qloo reads overlap within a turn, bounded by the existing client limit. Podcast work is prioritized. The revision tool changes only interests/tests, preserving other sections while rechecking the result. Fixed KPI and spend-rule text come from code. The adapter keeps the exact tools/system/history prefix stable; full submissions use a compact strict schema, and revision payloads are validated in application code.
- An initial coffee creative inferred Houndstooth-equivalent quality from audience affinity. The new exact-copy contract separates product-claim review from Qloo evidence. Every creative test starts held, including a model-supplied review field which is stripped. A buyer must review the exact text; bracketed placeholders must be resolved. Editing either text or product invalidates that review. This is a buyer attestation, not an automated semantic proof.
- New receipts are v3 and carry the exact reviewed creative text. Hypotheses and free-text ad-set descriptions are never guessed into CSV copy. Older v1/v2 receipts remain readable; creative export without exact reviewed copy is held. Unavailable or unknown Meta targets remain held.
- A final saved sneakers test was initially held only because Qloo returned “Herschel Supply Co” and the verified Meta lookup used a final period. A later formatting-only check accepts that punctuation difference, preserves accents and all words, and rejects ambiguous IDs. Rechecking the saved result gives one eligible targeting test; generation and timings were not rerun. Other tests remain held for missing Meta interests or unresolved creative review.

Final local verification: **118 tests passed**, six frozen hashes unchanged, extracted HTML module syntax passed, git diff whitespace check passed. Wrangler 4.152.0 dry-run built 18 assets, 167.87 KiB bundle / 50.96 KiB gzip, with no deployment. The mobile introduction was shortened. The new textarea and review checkbox were corrected to use the existing field styling; no page layout was redesigned.

Browser evidence: the old turntable replay now displays archive exclusions and holds all of its legacy test proposals; its downloaded 20-row podcast CSV retains the publishing source and leaves Harmontown's ask-first/code/link fields empty. A synthetic review/edit/lock test produced local receipt **e2e92fde**: editing previously reviewed copy immediately restored the hold; JSON v3 and the two-row CSV (control plus one test) contained the same exact revised sentence and product. The editor is disabled after lock. These interactions were performed by Codex for QA, not by a human buyer.

The final real coffee browser lock produced local receipt **6b31966c** at 15:27 UTC: downloaded JSON v3 has two targeting tests; the CSV has control plus two tests, retains Austin and all three exact Meta IDs, and excludes the unreviewed creative. This is an observed local receipt, not production KV.

The new recorded coffee result was inspected on desktop and at 375 px. Widths were 375 viewport / 360 client / 360 scroll, without horizontal overflow. The review control was checked visually and the viewport restored. Deeply nested test details are still verbose on mobile; no claim of perfect usability. Source questions and unverified fields remain visible. Raw responses, screenshots and downloaded QA plans remain local. There has been no new deployment, public repo sync or Devpost edit in this round, and the forward collection has not run.

Contact and publishing research incidentally exposed newer episode excerpts in search results, including A Beautiful Mess. They were not added to the locked sponsor labels or used to change the registered sample, hypotheses or analysis. This review must not be described as a blinded manual forward audit. The registered collection remains scheduled for 29 or 30 October only.

## Follow-up, 27 October Vietnam time

The parallel-verification attempt began at 16:17 UTC on 26 October. All three cases met the previously declared timing targets, but coffee retained one unsupported audience-trait citation. The gate flagged it correctly; the existing model feedback addressed interest quality only. Citation failures now enter the same single-review budget and request a full corrected brief when the interest-only tool cannot repair another section. Regression tests cover a successful repair and a model that ignores it. Unsupported claims remain flagged in the latter case.

| Attempt / case | Shortlist / full result | Qloo / model calls | Citation check | Draft checks |
|---|---:|---:|---:|---:|
| 16:17 attempt, coffee | 37 / 99 s | 38 / 7 | 18/19, flagged | 3/3 |
| 16:17 attempt, sneakers | 35 / 103 s | 34 / 7 | all passed | 3/3 |
| 16:17 attempt, turntable | 36 / 96 s | 38 / 8 | all passed | 3/3 |
| 18:09 follow-up, coffee | 44 / 101 s | 36 / 7 | 17/17 | 3/3 |

Coffee alone was rerun after that repair, as declared before the call. Its selected shows were The Sporkful, Home Cooking and 10% Happier with Dan Harris; it had two eligible targeting tests and one unreviewed creative. The final run demonstrates a usable result, but the trace does not establish that a citation failure occurred on its first submission: the regression tests, not this live run, demonstrate the repair branch. All eight attempts / 22 cases are preserved in `qa-round2-results.json`, including earlier provider and quality failures. The latest passing result for each case meets 45/120 seconds; this is not a latency guarantee, a controlled speedup experiment, or a buyer outcome.

Independent grading/name lookups and Meta/Qloo self-checks overlap within the existing Qloo limit of two. Duplicate names share one pending lookup; returned grading rows preserve input order. A run records step elapsed times and agent/baseline/outreach model durations. In the final coffee run, the agent phase took 95,142 ms and final grading 4,735 ms. The 30,588 ms outreach model call remains a substantial part of waiting for a draft. No additional paid reruns were made solely to improve the report. A later prompt clarification says catalogue popularity is not downloads/local reach and explicitly permits a full citation repair; these wording changes were not given another paid live run.

Browser replay of the 18:11:31 UTC coffee result produced local receipt **0f012dd8**, 18:28 UTC. The downloaded JSON has v3 and two targeting tests; the CSV has control plus two tests, the three selected Meta IDs, and no unreviewed creative. This is local storage, not production. Exact reviewed-copy behavior was already tested above. Mobile spacing in the existing nested test controls was corrected: at 375 px the textarea was 266 px wide rather than 172 px, with 16 px text and no horizontal page overflow. Desktop and mobile screenshots were inspected; no redesign was claimed.

Primary-source coverage now has nine contact records (six advertising, three general), four archive exclusions and three recent-publishing observations. The added [Giant Bomb domain profile](https://bsky.app/profile/giantbomb.com) lists business inquiries, not verified podcast ad sales. [The Legacy Music Hour](https://www.legacymusichour.com/) lists a 21 October mixtape and 7 October full episode, without establishing inventory. Both were checked on 27 October Vietnam time. Looking at these pages exposed current episode descriptions; none were collected into or used to alter the locked sponsorship labels or forward analysis.

Verification: 121 unit tests passed, synthetic evidence checks passed 15/15 in each of three cases, all six frozen hashes matched, and Wrangler 4.153.0 dry-run built 18 assets without deploying. The final dry-run bundle was 170.32 KiB / 51.58 KiB gzip, including the two extra directory records. The final directory changes are included in the 121-test check. Extracted HTML module syntax, submission/story synchronization and diff whitespace checks passed.

A new local, captioned walkthrough is prepared in ignored `video/v29/`, using actual browser screenshots of this recorded result and synthetic narration. It is a still-screen walkthrough, not continuous footage of API execution or a buyer pilot. Narration is tracked at `docs/demo-update-2026-10-27.json`; the reproducible assembly tool is `scripts/build-demo-update.py`. The older public video remains the historical 22 October recording. No public upload, deployment, git push or Devpost edit has been made in this follow-up; forward collection remains unrun.
