# Pre-registration 2: a prospective check (locked 21 Oct 2026, 17:14 UTC)

The first test (PREREGISTRATION.md) is retrospective: Qloo's data is measured today and sponsorships come from the past
year. This check looks forward. Qloo's ranking of the same held-out shows for each brand is frozen now; sponsorships
that appear AFTER this lock are the answer key.

## What is frozen

`prospective-frozen.json`, fingerprinted in `LOCK-2.sha256` together with this file and `scripts/podcast/prospective.py`:

- the 259 held-out shows (same as the first test), their Apple chart rank, genre and RSS feed;
- every episode id already in each feed at the lock (re-read at 17:08 to 17:14 UTC on 21 Oct 2026);
- the brands each show already reads in those episodes (strict rule of DEVIATION-1.md);
- each of the 76 scorable brands' Qloo percentile for every show (the same batches and scores as the first test).

## Collection

Once, on 29 or 30 October 2026 (before the hackathon deadline of 30 Oct, 23:45 EDT): `prospective.py collect` re-reads the
same feeds. A new episode is an item whose id was not in the feed at the lock and whose date, if given, is after the lock.

## Labels

A NEW placement of brand b on show s: s reads b (strict rule) in at least one new episode, and s did not read b in any
episode at the lock. Negatives for b: shows with at least one new episode that read b in neither.

## Measures and hypotheses

- Primary: the pair-weighted AUC of Qloo's frozen percentile, pooled over all brands with at least one new placement
  (positive and negative shows compared within each brand), with a 95% interval by resampling brands (10,000 draws).
- P1: Qloo's pooled AUC is above 0.5 (interval above 0.5).
- P2: Qloo's pooled AUC is above Apple chart rank's on the same pairs.
- Also reported: the mean of per-brand AUCs, the number of new placements, brands and shows with new episodes.

## Reporting

Reported in the submission and the repo whatever it shows. With fewer than 10 new placements the result is reported as
too few to conclude. No other analysis of the new episodes is run before this one.
