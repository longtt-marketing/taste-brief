# Decision desk: a complete sponsorship planning task

## Product decision, 27 October 2026

The previous product ended at a research shortlist. It now continues to a single-show pilot decision: request terms, enter the offer, compare it under a budget and target-market CPM cap, inspect the price/delivery threshold, and save the inputs and memo. No booking, outreach or ad launch occurs.

Three approaches were considered: further polish of recommendations; a new consumer recommendation app; and extending this existing evidence-backed workflow to the buying decision. The third preserves the Qloo integration and external sponsor-label study while addressing a specific missing buyer task. It is a product hypothesis, not proof of commercial demand.

The official rubric weights implementation, design, potential impact and idea equally. Potential impact asks for a credible demonstrated solution to a real audience's problem; a revenue result or human pilot is not an explicit prerequisite. Such evidence would strengthen the entry but is not a reason to stop product work. Source checked 27 October: https://qloo.devpost.com/rules . The gallery remains unpublished, so this work does not establish a ranking against the whole field.

## Scope and safeguards

- Qloo taste is used to order eligible offers. It is never converted into reach, conversion rate or ROI. Popularity and lowest CPM use exactly the same quoted shortlist and eligibility rules. This is not an independent no-Qloo discovery baseline.
- The larger of desired placements and the publisher's minimum determines the package. All additional fees count. Missing fees are not assumed to be zero; a known minimum can already rule out an offer before unknown fees are supplied.
- Delivery is total target-market **ad impressions across the package**, not lifetime downloads, episode downloads or unique listeners. High/low delivery inputs produce a CPM range. The preferred option must meet the cap at the low estimate, too.
- Price ceilings round down to cents. Changing quote terms resets the source/terms review. Currency mismatch, archived shows, the rival policy, unmatched or duplicate IDs, invalid values, expired offers and missing review cannot become eligible.
- Published rate cards confirm only their stated facts. They never establish available dates, all-in fees, delivery or category permission. A source reference and review are buyer-entered, not independently verified by the app.
- Quote inputs stay in browser memory until downloaded. No quote is sent to the Worker, model or publisher. The separate scenario uses invented prices/delivery with recorded Qloo show data, remains labelled on-screen and in exports, and preserves the user's real quote inputs. Saved inputs are recomputed on load, with all reviews cleared; saved verdicts are ignored.
- This is a one-show pilot comparison, not a multi-show budget allocation. Price and CPM are limits chosen by the user, not claims about the right market price or future sales.

## Sourced example of a real buying constraint

Software Defined Talk's advertising page lists USD 600 per episode with a three-ad minimum. Therefore the advertised minimum before unconfirmed additional fees is USD 1,800, which exceeds a hypothetical USD 1,000 pilot budget. This demonstrates a correct minimum-commitment check, not money actually saved or a campaign result. The page also describes the placement as a host-read mid-roll. No audience or delivery figure from the page is used as ad impressions.

Source checked 27 October: https://www.softwaredefinedtalk.com/ads . The compact price record is in `public/data/podcast-rate-cards.js`, separate from all frozen sponsorship labels. No new feed was collected or historical answer key edited.

## Design choice

Two local prototypes were rendered at desktop and 375 px after the user explicitly permitted a tool exception to the Claude Design prerequisite. Direction A uses a navy decision memo, offer cards and one editor. Direction B uses a warm worksheet with an inspector. Both were viewed; no horizontal page overflow was measured. A was chosen for continuity with the app and proximity of reason, price ceiling and edit controls. Its implementation moves the overall preference above the offers on mobile. A later simplification pass removed the historical benchmark chart from the landing hero: the first screen now explains one buyer question and three labelled limits, while the benchmark remains on the judge page. This is an internal design review, not a human usability study.

## Operational QA protocol, declared before the three-replay comparison

Reuse the already-recorded passing coffee, sneakers and turntable runs; do not call providers again to obtain favorable outputs. Apply the same explicitly hypothetical terms in each: USD 1,000 single-show budget, USD 60 target-market CPM cap; three placements minimum, desired one, zero assumed fees, 10,000–20,000 assumed package ad impressions; unit prices USD 200/150/600 in displayed shortlist order. Record the Qloo choice, popularity choice and lowest-CPM choice, including agreements. Then change the selected offer to one cent above its price ceiling and report the new result. These probes verify software behavior, not advertising performance or that Qloo beats a baseline.

Browser acceptance: empty terms remain empty; opt-in scenario is visibly labelled; a term edit clears review; after review a price crossing changes eligibility; restoring delivery can restore eligibility; switching back preserves actual inputs; JSON/Markdown downloads retain assumptions; reloading a saved file recomputes and requires review; malformed/other-market inputs stay held. Inspect desktop and 375 px, keyboard focus, no overflow and console errors. Check the legacy Meta lock/export path still works. Run the project's unit tests, frozen hash verification and Worker dry-run before checkpointing.

## Competitive context

The 27 October re-read of [FanFit](https://devpost.com/software/fanfit-skjrxf) emphasizes taste-ranked partners, evidence, outreach and creator mode. [SponsorFit](https://devpost.com/software/sponsorfit) emphasizes a creator media kit with field-level provenance. [Overlap](https://devpost.com/software/overlap-9iy76z) emphasizes a cross-domain action plan and an AI-without-Qloo comparison. Those are authors' descriptions, not independently verified outcomes. The decision desk's narrower differentiation is explicit commercial terms, uncertainty and switching thresholds after the shortlist, alongside the existing outside-Qloo sponsor-label study. No claim that competitors lack every equivalent capability or that this entry ranks above them. The landing flow now says only that decision; deeper benchmark and optional Meta work are judge evidence.

## Results and browser verification, 27 October

Latest requested polish/acceptance round: 31 / 33 / 36-second real-provider cases, desktop/mobile form and quote workflow checks, and fixes for unchecked selection prose and synthetic scenario labelling. Earlier attempts below remain historical evidence. See [the final local acceptance record](polish-qa-2026-10-27.md) and all attempts in `podcast-focus-results.json`. The updated walkthrough is v31.

The independent-perspective self-review narrowed the landing form to product, market, reference and rival policy. Optional Meta/city analysis is in a closed disclosure, and example labels describe the default single market. The pitch now states Qloo's discovery role separately from the commercial constraints. The judge page names the turntable taste/popularity disagreement while retaining the two agreements; all are comparisons within the same Qloo-derived shortlist, not an ablation of Qloo or campaign outcomes. An unsupported blanket claim about other sponsorship tools was removed. Rights & Resonance's public description was also reviewed as a reference for a clear constrained decision and visible provenance; its authors' claims were not independently tested.

The declared three-replay scenario check passed with the same hypothetical terms in all three cases. Taste and popularity agree for coffee and sneakers, and differ for turntables. In all three, increasing the preferred offer by one cent above its price ceiling removes its eligibility and changes the preference. All outcomes, including agreements, are retained in `decision-desk-results.json`. This is not a benchmark of ad outcomes.

Two layouts were implemented as local prototypes at desktop/375 px; the decision memo direction was selected and built into the actual app. Chrome and the in-app browser exercised the real saved coffee result. Empty prices remained empty; a real-mode budget of 750 remained after scenario toggles; changing 200 to 200.01 cleared review, and re-review changed preference to The Sporkful. Increasing low delivery to 10,500 restored Home Cooking. The visible review note now updates immediately, and CPM displays enough precision to reveal 60.003 exceeding a cap of 60.

The actual downloaded Markdown and JSON retain scenario provenance and the 600.03 package cost. Loading those inputs through the in-app browser cleared all reviews and left no eligible offer. Wrong-market and malformed JSON files were rejected. Chrome's extension could download but lacked file-URL upload permission, so the import was verified in the in-app browser without expanding that permission. A source/terms request can be copied per selected show; nothing is sent.

The old Meta path still locked exactly two eligible targeting tests (local receipt `9c3043e9`); its downloaded CSV had control plus two rows and the three expected Meta IDs. Unreviewed creative was excluded. A separate focused coffee replay rendered two shows and the quote desk with no empty Meta panels or interests-CSV button. Both the app and judge page were inspected at 1440 px and 375 px, without horizontal document overflow or console errors. Screenshots are in local `output/qloo-decision-designs/` and the ignored `video/v30/` folder. This is internal testing, not a human usability study.

Fresh focused runs and the rejected first turntable case are in `podcast-focus-results.json`. A curated availability directory missed WTF's official finale; source review caught it after the automated check. Its record now blocks new host reads, and the affected case was rerun. Five archive exclusions and four recent-episode observations are currently sourced; unknown status is still unknown. The corrected turntable completed in 49 seconds, missing the declared 45-second target. No rerun was made just to improve the timing.

Verification: 136 tests passed; six frozen hashes matched; the HTML module passed syntax checking; Wrangler 4.153.0 dry-run built 22 static assets and a 173.95 KiB Worker (52.59 KiB gzip), without deployment. The new 1080p walkthrough is 131.46 seconds, using seven actual browser screenshots, explicit scenario labels, subtitles and synthetic narration. It is a still-screen walkthrough, not continuous execution footage. The old public video remains unchanged. The quote calculator now compares CPM and price ceilings in integer cents, so an exact cap is accepted without floating-point drift; its decision memo includes the entity ID, provenance, entered terms, delivery range and review state.
