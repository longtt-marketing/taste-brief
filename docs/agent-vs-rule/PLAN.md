# Does the agent choose better shows than a fixed rule?

Written and pushed before any run (22 Oct 2026). Script: `scripts/agent-vs-rule.mjs`. Results: `docs/agent-vs-rule/results.json`.

## Question

In a live run the agent picks the three podcasts to ask first (`draft_outreach`). The page could instead apply a fixed
rule (`askFirst` in `public/rank.js`: shows that sell ads with no brand of the category found, by taste fit). Does the
agent's choice land where real brands spend more often than the rule's?

## Setup

- Brands: the 62 brands of the strict podcast check (`docs/podcast-check/results-strict.json`), each with its category
  from `src/data/categories.json`.
- For each brand: the 20 podcasts Qloo ranks for that brand's audience (the same call the app makes), with the ad data
  of `src/data/podcast-sponsors.json`. The brand's own name is removed from every show's advertiser list before anyone
  sees it, so the answer is hidden.
- The agent's step is replayed with the app's own system prompt and tools: the `podcasts` result exactly as the app
  returns it, then the model must call `draft_outreach`. The product line names only the category ("a sleep and
  bedding brand"), never the brand, so the model cannot recall where that brand advertises.
- Same 20 shows and same hidden data for every policy:
  - A: the agent's three shows.
  - R: the fixed rule `askFirst`.
  - T: top three by Qloo taste fit alone, among shows in the ad data.
  - P: top three by Qloo popularity (a stand-in for a chart), among shows in the ad data.
- A hit can only be known for a show in the ad data. A pick outside it counts as no hit; how often each policy does
  that is reported.

## Outcome

A hit is a pick whose own episode notes name the brand (the hidden answer). Score per brand: hits among its 3 picks.

## Primary comparison

A against R, paired by brand: mean hits per brand, the difference A minus R, and a 95% bootstrap interval (10,000
resamples of brands, seed 1). "The agent chooses better" only if the interval is above zero. If it includes zero,
the result is reported as no evidence of a difference; if below zero, as the rule doing better, and the story says so.

## Also reported

T and P against R; how often A and R pick the same three shows; the shows where they differ and the agent's reason;
brands with no Qloo match or no shows with ad data are counted and left out.

## Known limits

- The hidden answer is past sponsorships, not results. A show a brand bought is not proof it paid off.
- The rule prefers shows where no brand of the category is found yet. A brand's own shows often carry its rivals too,
  so the rule may score low on this outcome by design. That is reported, not tuned away.
- The agent does not see the rule's choice: `suggested_first` was removed from the tool result on 22 Oct, before this
  test, so the choice is its own.
- One model call per brand, no repeats.
