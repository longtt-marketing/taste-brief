# Devpost entry update — reviewer-ready copy (draft, not submitted)

**Proposed subtitle:** Evidence-gated ad experiments from Qloo taste signals, not just another AI-generated marketing brief.

**Owner action:** Review and paste selectively into the existing Devpost entry before **30 October 2026, 11:45 pm EDT (31 October 10:45 ICT)**. Do not create a duplicate submission. Keep existing video, repository and demo links unless they have genuinely changed. Do not paste the judge access code into a public field.

## The problem

A performance marketer launching a new product must choose whom to test before spending on advertising. A generic LLM often produces plausible audience interests without a dataset to support them. Taste Brief treats those suggestions as hypotheses, requests Qloo taste-affinity signals, and designs a small set of experiments a marketer can verify instead of claiming to know who will buy.

## What the agent actually does

1. Finds candidate entities or comparable brands in Qloo Search; looks up product-related tags.
2. Calls Qloo Insights across brands, artists and media. Uses a location signal for the chosen market and a location filter for local places. Reads Qloo's age/gender index for the seed, not city-specific consumer demographics.
3. Runs Claude's tool-use loop to draft an audience brief, creative ideas, potential Meta interests, partners, and **one to three ad experiments**. Each experiment has a hypothesis, treatment, KPI and stop condition.
4. Checks cited entity IDs against entities Qloo actually returned in this run; checks quoted affinity numbers, seed-demographic numbers, and exact names where applicable. A mere Search result is **not** proof of taste affinity. The check reports unsupported citations; it does not validate causal interpretations or predict conversion rates.
5. Computes Qloo rankings for two markets directly, without letting the LLM invent the comparison. Separately shows an unaided LLM answer and labels its interests that were not returned in the inspected Qloo results (not equivalent to proving them wrong).

## One decision Qloo changed

For **$120 wool running sneakers** and **Allbirds as a comparable-brand seed**, a plain LLM produced performance-runner guesses, including Strava and parkrun. In the owner's October 20 London run, Qloo surfaced a different idea worth testing: wellness and studio fitness, with interests associated with ClassPass, Peloton and Outdoor Voices. Taste Brief would **test a wellness creative concept against a performance-running control**. It would not claim that runners are wrong or that the Qloo concept sells more; no real ad test has been conducted.

The seed Qloo age/gender indexes (**female +0.33; age 30–34 +0.42**) are aggregate affinity indexes **for the seed**, not percentages of London consumers. The displayed locations and market comparison do not create person-level or purchase-level evidence.

## Why this is not a generic Qloo → prompt → copy demo

- **Evidence is executed as code:** source IDs and numeric attributions checked per run; unsupported items are visibly flagged, not silently passed as facts.
- **A falsifiable output:** each ad experiment defines what to test, one KPI and when to stop.
- **Counterfactual interface:** a same-question, no-data model answer is shown, with a strictly described list of terms Qloo did not return in that run.
- **Cross-market tool calls:** direct ranking comparisons by market, distinguishing a city-level place filter from a location-adjusted affinity ranking.
- **Reviewable build:** public MIT repository, complete tests, rate-limit handling, protected API keys, judge access mechanism and a read-only production-health check.

## Demonstration and technical verification

- The public demo offers a small number of live runs each day; judges receive a private code through **Additional info**, allowing live use without consuming the public daily quota.
- Open the example **“Wool sneakers in London and Hanoi”**. Confirm **Live run on real Qloo data**, inspect the streamed Qloo calls and the cited entity sources, then compare the What to Test section with the no-data baseline.
- A review branch currently has **37/37 Node tests passing on GitHub Actions** and 3/3 synthetic evidence-gate examples: London 15/15, Hanoi 15/15, Seoul 15/15. The CI job also confirmed that production serves the landing page and reports Qloo/Claude live configuration and a judge access-code mechanism.
- **Do not cite the review-branch test count as deployed application acceptance.** The new branch is not merged/deployed and authenticated Qloo calls were not rerun as part of this CI check. The owner previously reported live evidence-gate results London 20/20, Hanoi 18/18, Seoul 21/21; report as owner-observed unless independently reproduced and recorded.
- Static judge walkthrough prepared at `public/judge.html` on the review branch; do not present `/judge.html` as live on production until merged, deployed and smoke-tested.

## Limitations / responsible use

Qloo describes aggregate taste overlap, not consumer purchases or causal ad lift. Interests must be independently checked for availability inside Meta Ads Manager. Seed demographics do not imply city resident demographics. A name absent from one city's top 12 can still appear below the cutoff. The creative copy, summary, and test plan are LLM interpretations of Qloo-returned facts; marketers are responsible for experimental design and final campaign decisions.

## Evidence that must not be invented

- Customer interviews: **NOT TESTED** until independent respondents provide the results.
- Measured CTR/CPC, ROI or increased conversions: **NOT MEASURED**.
- Every interpretation fact-checked: **FALSE**. Only the defined provenance/numeric/name constraints are code-checked.
- All production runs completed in reviewer session: **NOT VERIFIED** by independent reviewer; previous owner's live-run counts are owner-provided.

## Quick upload checklist

- Confirm entry title/tagline differ from the unrelated project also called Taste Brief.
- Put the one-decision case in the **top 150 words** of the submission.
- Use one screenshot from the **actual live** workflow showing Qloo evidence and decision; no synthetic result presented as live.
- Confirm video demonstrates current UI and judge code in private Additional info, never GitHub or public text.
- Confirm repository license shows in GitHub About and links to the correct `longtt-marketing/taste-brief`.
- Confirm final Devpost submission status and save the receipt after updating.
