# Agent against the fixed rule, on the same shows

Written and committed before any run (22 Oct 2026). Script: `scripts/agent-vs-rule.mjs` with `SAME=1`. Results:
`docs/agent-vs-rule/results-same.json`. The first comparison (`PLAN.md`, `results.json`) stays as it is.

## Why a second run

In the first run the agent could pick shows we have no ad data for (22 of its picks), which can never count as a hit,
while top taste fit and top popularity were limited to shows in the ad data. A judge asked for the same eligible shows
for every policy (22 Oct).

## Setup

Same brands, same hidden answer, same model and replay as `PLAN.md` (deviation 1 included), with two changes:

- Every policy picks from the same shows: Qloo's 20 podcasts for the brand's audience, kept only when the show is in
  our ad data. The agent sees only those shows.
- The agent's tool result is the app's current one (22 Oct): each show's description and tags from Qloo are included,
  as a live run now gives them.

Policies: A the agent, R the fixed rule `askFirst`, T top taste fit, P top popularity, all on that list.

## Outcome and comparison

As in `PLAN.md`: a hit is a pick whose own notes name the brand; hits per brand among 3 picks; A minus R, A minus T and
A minus P, paired by brand, 95% bootstrap interval (10,000 resamples of brands, seed 1). "The agent chooses better than
X" only if the interval is above zero; below zero is reported as X doing better; otherwise no evidence of a difference.

## Known limits

- Past sponsorships, not results. Brands often buy where their rivals already are, and the agent and the rule are told
  to weigh category exclusivity, so this outcome can favour taste and popularity by design. Reported, not tuned away.
- One model call path per brand, no repeats.
