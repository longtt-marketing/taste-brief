# Deviation 1: a stricter sponsor label, declared before any analysis

Written 2026-10-21 after the held-out data was collected and while Qloo scores were being fetched, before any score or
AUC was looked at.

## Why

The pre-registered hand check of 100 random matches of the dictionary (`brands.json`) found 43 real sponsor reads.
The other 57 were word collisions ("advantage" matching Vanta, "lowest" matching Lowe's, "a masterclass in") and real
mentions that are not ads (news, guest credits, "stream it on Hulu"). Labels that noisy can only blur a real effect, but
they should not be the only reported result.

## What changes

Both analyses are run and both are reported.

- Primary, exactly as pre-registered: the dictionary match, at least 2 episodes.
- Strict (this deviation): a match counts only when the brand pattern matches as a whole word and a sponsor cue appears
  within 150 characters of it: sponsor, sponsored, brought to you by, support for (this show|the show) comes from,
  promo code, use code, offer code, code [a-z0-9]+, % off, free trial, go to <word>.com, visit <word>.com, <word>.com/<word>.
  The rest of the pre-registration (at least 2 episodes, at least 3 dictionary brands for a show to enter, at least 3
  carrying shows for a brand, batches, measures, baselines, H1 to H4, the leakage pairs) is unchanged.
- A second hand check of 100 random strict matches is reported next to the first.
