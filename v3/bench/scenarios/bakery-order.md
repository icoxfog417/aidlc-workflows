# Scenario 1 — Bakery order web app

A scenario benchmark for comparing AI-DLC v2 and v3 end to end. Written so
someone else can run it and get numbers that mean something.

## Prompt (verbatim, both systems)

> Please build the web app for a bakery that a user can submit an order.

## Fixed conditions

Vary one thing at a time or the result measures the model, not the framework.

| | |
|---|---|
| Model | pinned, identical, stated in the report |
| Scope / plan | v2 `express` · v3 `express` |
| Repo | empty greenfield, same starting commit |
| Human | scripted: approve at every gate unless the artifact is materially wrong; a rejection must cite a rubric row |
| Runs | N ≥ 5 per system; report median and range, never a single run |
| Wall clock | capped identically; a run that exceeds the cap is recorded as `incomplete`, not discarded |

## Two experiments, not one

**Experiment A — checker comparison (cheap, fully controlled).**
Hold the artifacts constant. Produce one artifact set, feed it to both
systems' checkers, score the findings. This isolates the checker from agent
variance and needs no agent run at all. *This is the experiment already run
below.*

**Experiment B — end-to-end (expensive, N runs).**
Each system drives its own agent run from the prompt. Measures what the
framework does to the work, not just to the review. Needs a live session per
run and a human following the script.

Do A first. If the checkers do not differ, B will not show much either.

## Metrics

### Push-backs, classified by cost

A raw count is the wrong metric — a checker that never pushes back scores
perfectly and is useless. Classify instead:

| class | definition | cost |
|---|---|---|
| **signal** | push-back that led to a real change | the point |
| **noise** | push-back dismissed, suppressed or overridden | attention |
| **friction** | push-back that stopped work (blocking refusal) | a cycle, or a redo |
| **miss** | rubric defect present in the final artifacts that nothing flagged | shipped |

Report all four. `precision = signal / (signal + noise)`;
`recall = signal / (signal + miss)`.

### Cost

Lines that load regardless of scope · per-tool-call overhead · checkpoint
latency · prose tokens injected per stage · wall clock to completion ·
model spend per run.

### Outcome

Artifact inventory (what exists at the end) · rubric score · rework rate
(artifacts revised after a gate) · requirement→test coverage.

## Rubric

**Authored before either system runs, from the domain — not from either
system's rule set.** If the rubric is v3's rules, v3 wins by construction.
Score each row present / partial / absent, blind to which system produced the
artifacts.

| # | row |
|---|---|
| R1 | Order states are defined (at least: received → ready → collected) |
| R2 | Payment is explicitly in or out of scope |
| R3 | Pickup-time validity is constrained (opening hours, lead time) |
| R4 | Allergen handling is addressed or explicitly deferred with a reason |
| R5 | Empty / invalid basket submission is specified |
| R6 | Staff view of submitted orders is specified |
| R7 | Customer PII (name, phone) has a stated handling rule |
| R8 | Every requirement carries an observable acceptance condition |
| R9 | A rollback path exists for the deployment |
| R10 | Each requirement can be followed to code and to a test |

R8 and R10 overlap both systems' checks; R1–R7 and R9 do not. Report the
subscores separately so the overlap is visible.

## Result: Experiment A, run 2026-09-11

One realistic requirements document (`bakery-requirements.md`, 7 FR + 2 NFR,
written without reference to either rule set) fed to both checkers.

Independent ground truth: **one material defect** — FR-3 ("the order form
should be easy for customers to use on a phone", acceptance "the form is
usable on mobile") states a goal, not an observable condition. Everything else
in the document is sound.

| | v2 `claim-sources` | v3 `check --gate exit --phase inception` |
|---|---|---|
| findings | **28** | **6** |
| caught the real defect | not distinguishably | yes (`requirements/testable` FR-3) |
| blocking | 0 (sensor is advisory) | 0 |
| precision (strict) | ~4% | ~33% |

v2's 28 were format-conformance failures on a substantively good document,
including several that are simply wrong: `[desc] is not registered in ##
Sources` when it is registered; `[Q1] has no filled answer` when the questions
file carries `[Answer]:`; and `[scope] is valid only in ## Initial Scope
Signal`, a section the framework never asked the author to create.

v3's 6 break down as 1 clear true positive (FR-3 untestable), 1 defensible
(FR-3 unsourced), and 4 false positives — three source-tag findings on
requirements that are reasonable derivations, and one `requirements/testable`
on NFR-2, which is testable but not phrased as given/when/then.

**v3 is better here, not good.** Both systems fail the same way — a
deterministic marker standing in for a judgment — v3 simply at one sixth the
volume. Closing the remaining gap is the judgment tier's job, and the stub
triage confirms everything it is handed, so the funnel is not yet doing any
work. Wiring a real model to `--judge model` is the next experiment.

### Bugs this scenario found in v3

Running one realistic document surfaced three defects a synthetic corpus had
not:

1. `phase` was loaded on every rule and never used to filter, so construction
   rules fired at an inception gate ("no traceability yet" reported as a
   defect during requirements).
2. `requirements/testable` markers missed the given/when/then form entirely.
3. Markers ran without the dotall flag, so a **line-wrapped** acceptance
   criterion read as an absent one — the same failure class as v2's "a
   thematic break voids the summary receipt."

The third is the instructive one: it is v2's disease reproduced in miniature,
and no amount of regex tuning removes it. It is the standing argument for why
the judgment tier has to be real rather than a stub.
