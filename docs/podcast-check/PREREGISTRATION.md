# Pre-registration: does Qloo pick the podcasts brands actually pay to sponsor?

Written 2026-10-21, before any held-out data was collected. Its SHA-256 and the commit that adds it are the lock; the
analysis must follow this file, and any change after the lock is reported as a deviation.

## Question

Taste Brief's other benchmarks are graded by Qloo. This one is graded by money: which podcasts a brand paid to sponsor,
read from the sponsor reads that shows publish in their own episode notes (public RSS feeds). Qloo never sees the
feeds; the feeds never feed the prediction.

## Development set (already seen, not part of the test)

A pilot on 21 Oct used the RSS feeds of Apple's US top 200 podcasts (Expert 2's probe): Qloo affinity mean AUC 0.63
over 29 brands, chart rank 0.40, Qloo popularity 0.56, show ad volume 0.73. Those shows and numbers are the development
set. They are not counted in the results below.

## Held-out set (collected after this file is locked)

- Shows: Apple's US top podcasts in at least 8 genres (iTunes top podcasts by genre, up to 200 each), minus every show
  in the development set. Up to the 40 most recent episodes per show, episodes from the last 12 months only.
- Brands: the frozen dictionary `brands.json` (180 advertiser brands with fixed name patterns), not edited after the lock.
- A show "carries" a brand when the brand's pattern appears in the notes of at least 2 episodes.
- Shows enter the test only if they list sponsors at all (at least 3 dictionary brands carried) and resolve in Qloo by
  exact name match (case and punctuation ignored).
- Brands enter the test if they are carried by at least 3 held-out shows and resolve in Qloo as a brand by exact name.
- Shows are scored in fixed batches of at most 50, the same batches for every brand; Qloo affinity is turned into a
  percentile within each batch. A show Qloo does not score for a brand gets the lowest percentile.

## Measures

For each brand: AUC of ranking the held-out shows by Qloo affinity (`/v2/insights`, `filter.type=urn:entity:podcast`,
`signal.interests.entities=<brand>`, `filter.results.entities=<batch>`), against the label "carries the brand".

Baselines, each scored the same way:
- B1 chart: the show's Apple chart rank within its genre (better rank = higher score).
- B2 popularity: Qloo's own popularity of the show (not specific to the brand).
- B3 ad volume: number of OTHER dictionary brands the show carries (leave-this-brand-out).
- B4 random: 0.5.
Combination: Qloo + ad volume = sum of the two within-test ranks (no fitting).

## Hypotheses and pass rules (alpha 0.05)

- H1: Qloo mean AUC > 0.5 (one-sided sign test over brands, and bootstrap 95% interval of the mean above 0.5).
- H2: Qloo beats B1 and beats B2 (paired bootstrap over brands, 10,000 resamples, 95% interval of the mean difference
  above 0).
- H3: Qloo + ad volume beats ad volume alone (paired bootstrap, 95% interval above 0).
- H4 (exploratory, reported whatever it shows): brands for which Qloo's scores across the held-out shows have a spread
  (interquartile range of affinity) above the median spread do better than the rest.

## Reporting

All four results are reported in the submission whatever they show, with the brand-level table, the number of shows
and brands, and the precision of the sponsor extraction from a hand check of 100 random matches. Raw Qloo responses are
not published; scores, labels and code are.

## Known limits, stated in advance

- Sponsor reads in episode notes miss dynamically inserted ads, so "not carried" can mean "carried but not listed".
- Qloo's affinity is measured today; some sponsorships may have shaped Qloo's data. A leakage check predicts a brand's
  shows from a direct competitor's Qloo audience (pairs fixed now): DraftKings / FanDuel, BetterHelp / Talkspace,
  HelloFresh / Factor, Mint Mobile / Visible, NordVPN / ExpressVPN, Eight Sleep / Helix Sleep.
- US shows only; the result says nothing about other markets.
