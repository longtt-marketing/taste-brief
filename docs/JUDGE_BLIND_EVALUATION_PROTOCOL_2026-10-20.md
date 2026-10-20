# Small blind evaluation protocol — Taste Brief

**Prepared 20 October 2026. Status: protocol only. No study, reviewer feedback or ad spend has been collected.**

## Aim

Test a limited question: *does a Qloo-evidence-backed brief lead working marketers to choose a more testable, auditable campaign hypothesis than a no-data LLM brief?* Do **not** test, or claim to test, sales uplift, conversion rates, audience demand, causality or representativeness of a geographic population.

## Inputs to fix in advance

- Product: $120 wool running sneakers; proxy brand: Allbirds; market: London.
- Both briefs must answer the same question with comparable maximum length, audience rationale, two creative hypotheses, and measurable tests.
- Brief **A**: plain LLM, no Qloo; Brief **B**: Qloo-backed. Swap A/B display order across participants; blind reviewers to the generating source.
- Keep immutable copies of the two answers with timestamps and code SHA. Do not store or redistribute prohibited raw Qloo API payloads. Redact secrets and personal data.
- An evaluator may be a marketer with campaign experience or a person whose job includes digital marketing decisions. Document role/experience category with consent, but no identifying information is necessary.
- Do not ask reviewers to execute anything on personal or employer ad accounts.

## Rating sheet, one response per reviewer

Use this rubric, **1 = poor, 5 = excellent**, for each brief independently:

| Dimension | What to look for |
|---|---|
| Actionability | Can the marketer act on the recommendation today? |
| Evidence traceability | Can a reviewer distinguish data, inference and unknowns? |
| Test specificity | Does it specify hypothesis, metric, sample/stop rule and alternative? |
| Commercial relevance | Is it relevant to the given product and target market without claiming buyers? |
| Error / overclaim risk (reverse coded) | How likely are unsupported conclusions? 5 = lowest risk |

After assigning scores, ask exactly two independent questions:
1. **Which would you use first, A, B or neither, and why?**
2. **Name one claim you would not trust or one additional verification you would require before paying for ads.**

## Recording results (blank template, do not invent answers)

| Anonymous reviewer | Order | A actionability | A traceability | A tests | A relevance | A low risk | B actionability | B traceability | B tests | B relevance | B low risk | Decision | Limitations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | A then B | — | — | — | — | — | — | — | — | — | — | — | — |
| R2 | B then A | — | — | — | — | — | — | — | — | — | — | — | — |
| R3 | A then B | — | — | — | — | — | — | — | — | — | — | — | — |

A meaningful qualitative result requires that at least two of three independent reviewers find the Qloo-backed version more actionable **and** explain a specific decision change. This small sample is not statistically reliable and **cannot prove performance uplift**. Negative or mixed results must be published, not hidden. If no reviewers participate, report **NOT TESTED**, not “validated”.

## Required disclosure to judges

- Study dates and how reviewers were recruited; number invited, completed and excluded.
- Whether the comparison was blind and the order of briefs.
- Unedited rubric and any material negative comments.
- Exact sample size and which conclusions are observational versus hypothetical.
- No claim of a real ad test, A/B uplift, CTR or revenue unless such campaigns were actually run with rights to use the data.

## Execution responsibilities

- Assistant/Claude: prepare two fairly matched briefs and anonymized scoring sheet without changing what was actually generated; prepare consent/invitation draft if needed.
- Owner: choose and invite independent reviewers and collect their voluntary answers. No autonomous outbound contact, false reviewer identities or incentives without consent.
- Reviewer: grade without knowing which system produced the answer.
- Reviewer of the study: confirm no private company data or individual Qloo profiles are exposed.

**Do not label this as a case study of actual impact until evaluations have genuinely occurred.**
