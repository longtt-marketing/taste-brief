# Does the Meta check in the self-check make the tests launchable?

Written and committed before any run (22 Oct 2026). Script: `scripts/meta-loop-eval.mjs`. Results:
`docs/meta-loop/results.json`.

## Question

Since 22 Oct the agent's self-check also looks up each Meta interest in Meta's interest search, and sends the brief back
once when an interest is not there (`src/selfcheck.js`). Two judges had found the recorded brief proposing a targeting
test on interests Meta does not have. Does the loop fix that, and what does it cost in taste fit?

## Setup

- The same 10 benchmark products as `docs/selfcheck-eval.json` (`docs/benchmark/combined.json`, cases 3 to 12), plus
  the page's example (wool sneakers, New York, Allbirds): 11 runs, one live agent run each, no repeats.
- Each run uses the app's agent and self-check with the Meta lookup on (`metaLookup` in `src/worker.js`), as a live run
  of the app does.
- First brief = the brief before the self-check; final brief = after any rewrite. Both are read from the self-check's
  own reports, so no extra Meta lookups.

## Outcomes

1. Primary: targeting tests that name at least one interest Meta does not have (same word-boundary match as the page),
   counted in the first briefs and in the final briefs.
2. Share of each brief's Meta interests that exist in Meta as named, first against final.
3. Guard: share of picks at Qloo affinity 0.9 or more on the benchmark's held-out competitor, first against final, on
   runs where the agent's rival is not that same brand. A drop of more than 0.10 is reported as a cost.

## Reading

The loop "makes the tests launchable" only if the final briefs have no targeting test naming a missing interest in at
least 10 of 11 runs. Anything else is reported as it is. Exploratory: 11 runs, one model call path each.

## Known limits

- Meta's interest search is the only source for "exists in Meta"; it can miss an interest that Ads Manager shows under
  another name.
- The first brief was written without the Meta information, so first against final shows what the loop changes, not
  what a model told about Meta from the start would do.
