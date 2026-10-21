# Benchmark: 20 briefs, with and without Qloo

Run 21 Oct 2026. Same model (Claude Sonnet 5.5) for every arm, 20 products and cities (`CASES` in `scripts/benchmark.mjs`).

## Graded on a held-out competitor (`scripts/benchmark-heldout.mjs`, `heldout.json`)

Each brief was written from one reference brand; its picks are graded on the audience of a competitor the agent never saw,
in the same city (Allbirds to Veja, Blue Bottle Coffee to Intelligentsia Coffee, Lululemon to Alo Yoga, White Claw to
Truly Hard Seltzer, the full map is `HELD_OUT` in the script). This removes the main circularity: Taste Brief's picks came
from the reference brand's Qloo results, not the held-out brand's.

| Who wrote the Meta interests | Found and scored on Qloo | Affinity 0.9 or more |
|---|---|---|
| Taste Brief | 115 of 140 (82%) | 86 of 140 (61%) |
| Same model, no data, told to name specific entities | 45 of 133 (34%) | 25 of 133 (19%) |
| Same model, no data, as the app asks it | 6 of 115 (5%) | 1 of 115 (1%) |

Ahead of the named-entity baseline in 19 of 20 briefs (one tie): +42 points, 95% bootstrap interval +32 to +53. The
named-entity baseline was asked again for this run, so its lists differ slightly from the run below.

## Graded on the reference brand's own audience (`summary.json`)

| Who wrote the Meta interests | Found and scored on Qloo | Affinity 0.9 or more |
|---|---|---|
| Taste Brief (agent with Qloo tools) | 118 of 143 (83%) | 105 of 143 (73%) |
| Same model, no data, told to name specific brands, artists and shows (`scripts/benchmark-strong.mjs`) | 54 of 140 (39%) | 25 of 140 (18%) |
| Same model, no data, as the app asks it (the page's comparison column) | 6 of 117 (5%) | 3 of 117 (3%) |

Per brief, Taste Brief's share at 0.9 or more is higher than the stronger baseline in 19 of 20 (one tie): +55 points on
average, 95% bootstrap interval +43 to +67 (10,000 resamples of the 20 briefs). Against the app's own baseline: +71 points,
interval +60 to +80, ahead in 19 of 20.

## How each interest is graded (`src/grade.js`)

1. Look the name up in Qloo search; accept only an exact name match ("Parkrun" must not become a place in Poland). A name
   like "Veja or On Running" is tried as a whole and as its parts.
2. Ask Qloo insights for that entity's type, with the reference brand as the signal and the city as location, restricted
   to that one entity (`filter.results.entities`). The affinity Qloo returns is the score.
3. A name Qloo can't find is "not in Qloo"; a name Qloo finds but doesn't score for this audience is "no score". Both count
   as below 0.9. The reference brand itself is left out of both lists.

## Limits

- The grader is Qloo. For Taste Brief's picks this is partly circular, because they come from Qloo results. It measures
  how far each pick is from Qloo's view of the audience, not how an ad performs.
- The stronger baseline's seed is the reference brand as found in Qloo search; the agent may also use the product tags, so
  the two arms are scored against close but not always identical audiences.
- One run per brief. Model wording and Qloo rankings vary between runs.

`summary.json` holds the totals and per brief counts. Raw runs, with Qloo responses, stay out of git (Qloo's terms).
