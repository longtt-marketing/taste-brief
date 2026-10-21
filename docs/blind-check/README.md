# Blind check: a Qloo plan against a plain AI plan

21 Oct 2026. Two plans for the same brief (wool running sneakers, $120, London, Allbirds as the closest brand) came from one
live run: RUNNER is what the model wrote with no data, TASTE is the Taste Brief built on Qloo. Both are in `plans.md`, with
numbers, sources and the word Qloo removed. Reviewers were told only that two strategists sent them.

Each reviewer saw both orders, in separate fresh sessions:

| Reviewer | Order | Funds first | Different from competitors (TASTE / RUNNER) | Picked a TASTE test in its first three |
|---|---|---|---|---|
| ChatGPT, temporary chat | RUNNER first | RUNNER | 6 / 3 | yes, #1 |
| ChatGPT, temporary chat | TASTE first | RUNNER | 8 / 4 | yes, #1 and #2 |
| Claude (Sonnet), fresh agent | TASTE first | TASTE | 9 / 3 | yes, #1 and #2 |
| Claude (Sonnet), fresh agent | RUNNER first | RUNNER | 8 / 4 | yes, #1 |

Full answers: `answer-*.md`. Prompts: `prompt-runner-first.txt`, `prompt-taste-first.txt` (from `prompt-template.md`).

What changed after it: the test plan names one control for every test (broad targeting, same ages, usual message), judges on
cost per add to cart or purchase with CTR as a diagnostic, and uses stop rules a small budget can reach.

These are AI reviewers, not marketers. It shows how two models read the plans, not how ads would perform.
