# Agent against the fixed rule, when the agent also sees popularity

Written and committed before any run (22 Oct 2026). Script: `scripts/agent-vs-rule.mjs` with `SAME=1 POP=1`. Results:
`docs/agent-vs-rule/results-pop.json`. `PLAN.md` and `PLAN-2.md` and their results stay as they are.

## Why

On the same shows (`PLAN-2`), top popularity found 24 real sponsorships, top taste fit 23, the agent 20 and the fixed
rule 19. The agent was never told each show's popularity. Since 22 Oct the app's `podcasts` tool gives it (Qloo's 0 to
1 popularity), and the agent's prompt asks it to weigh popularity as the nearest thing to reach. A judge asked whether
the agent at least matches the most popular pick once it has that number.

## Setup

Exactly `PLAN-2` (same brands, same list of shows in the ad data for every policy, same hidden answer, same model and
replay), with the app's current tool result and prompt: popularity is included for every show.

## Outcome and reading

As in `PLAN-2`: hits per brand among 3 picks; A minus R, A minus T and A minus P, paired by brand, 95% bootstrap
interval (10,000 resamples, seed 1). "Better" only if the interval is above zero; "worse" only if below; otherwise no
evidence of a difference. We also report whether the agent's total is at least the top popularity total, the number
the judge asked about, without reading it as significant.

## Known limits

As in `PLAN-2`. One run per brand. The prompt change was made before this run and is the app's current prompt; it was
not tuned on these brands.

## Note added after the run (22 Oct)

"A judge" above means an AI judge we ran to review the entry, not a hackathon judge. Nothing else in this plan was changed.
