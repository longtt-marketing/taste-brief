# Product QA protocol, round two

## Parallel verification attempt — declared 26 October, after 16:00 UTC

Follow-up declared 27 October Vietnam time: the 16:17 UTC attempt completed all three within both timing targets, but coffee retained one audience-trait citation failure. The evidence gate exposed it; the revision feedback had only addressed interest quality. Combine citation failures with the existing one-review budget and require a full corrected brief when other sections need repair. Rerun coffee once after this change; the two passing cases do not need another paid run solely for reporting. A regression test covers both a successful repair and a model that ignores the repair request, whose claim remains unverified.

The preceding completed attempt (14:59:08 UTC) remains the comparison: 35/96, 51/127 and 36/122 seconds (shortlist/full). Overlap independent interest lookups, type-based scoring, both comparison graders and Meta/Qloo self-checks; keep the existing Qloo concurrency limit of two. Add elapsed step timestamps and per-model call durations to identify remaining latency. Run the same three cases once, preserve failures, and report raw differences as operational observations, not a causal speedup study. Model outputs and provider load can differ. The source hash now also includes src/grade.js. No new feed collection or changes to frozen labels.

Declared 26 October 2026 before these new runs. This is operational QA, not a new sponsorship benchmark or a human usability study. The registered forward study remains untouched.

Run each case once initially through the real Worker on loopback with live Qloo, Claude and Meta. Preserve every result, including failures. A fix and rerun must be a separate attempt, never a replacement of a failed record.

| Case | Product | Main / comparison market | Reference | Rival policy |
|---|---|---|---|---|
| coffee | Specialty coffee subscription, $25/month | Austin, TX / Seattle, WA | Blue Bottle Coffee | allow |
| sneakers | Wool running sneakers, $120 | New York, NY / London, UK | Allbirds | skip |
| turntable | Beginner turntable, $250 | Chicago, IL / Los Angeles, CA | Audio-Technica | allow |

Check complete vs incomplete output; actual time to provisional shortlist and full completion; chosen names are unique and belong to returned candidates; no selected show violates the skip policy; structured claims pass the evidence check or are explicitly held; targeting has explicit selected entities and verified Meta IDs; draft lint failures stay held; every show has an evidence-appropriate next research action. No inference of prices, geographic reach, availability or exclusivity from taste/popularity/contact routes.

Performance target: provisional shortlist within 45 seconds, total within 120 seconds. Report all timings whether the targets pass or fail. Runtime varies; three cases cannot establish a population latency distribution. Browser-check one live result, the exports, missing/error states and responsive layout separately. Raw responses stay in ignored local files; only derived QA summaries are candidates for publication.

The historical 48-brand agent-vs-rule result measures ranking performance, not this buying workflow. Do not relabel these three cases as improved prediction accuracy, buyer satisfaction, time saved or business outcomes.

## Revision attempt, declared before rerunning

The first attempt is retained at private `.results/qa-round2/2026-10-26T14-21-13-396Z/`. All three completed, but manual review found material problems despite the automatic structural checks: coffee copy inferred Houndstooth-equivalent quality; creative CSV could substitute the hypothesis; the turntable shortlist included archival Harmontown. Coffee and turntable also exceeded the 120-second target (124 and 138 seconds).

After fixing the exact-copy contract and buyer review, adding dated publishing-status evidence and enforcing archive exclusions only in the buying workflow, rerun all three cases once. The agent's revision tool now replaces only interests/tests so it cannot omit unrelated sections. New creative tests should remain held until a buyer reviews the exact copy; zero auto-ready creative tests is expected. Recheck the initial saved outputs against the new gate separately without relabeling them as newly generated output. Keep old and new timings, including any regression. No buyer review is fabricated by the model or QA runner.

The revision attempt at `2026-10-26T14-47-15-452Z` failed all three cases before inference: Anthropic rejected the combined strict-tool grammar as too large. Preserve these errors. The next attempt removes strict grammar from the small revision tool only; the full submission remains strict, and the merged result still passes application shape/evidence checks. Run the same three cases once after that provider compatibility fix.

Further provider findings, all retained: `14-48-27-466Z` and `14-50-10-325Z` also failed the grammar check (three cases each). The `14-52-54-573Z` attempt delivered provisional shortlists but failed all three at revision because changing the offered tools invalidated Claude's signed conversation prefix. The initial shortlists are not counted as completed runs.

Final compatibility change: reduce the full schema by deriving KPI/spend text from the fixed rule, keep the full submission strict, keep revision non-strict with application validation, and keep the exact tool list and signed message history unchanged throughout. A separate minimal schema probe returned HTTP 200 with this stable tool list. Rerun the same three cases once; no retry loop in the runner. Primary documentation: [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [thinking troubleshooting](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting).
