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

Artifacts held constant. One realistic requirements document (7 FR + 2 NFR,
`bakery-requirements.md`, written without reference to either rule set) fed to
both checkers. Raw data in `run-2026-09-11/`.

**Ground truth and triage both came from fresh-context subagents**, not from
whoever authored the rules. The reviewer saw only the original prompt and the
document — no rule sets, no findings. The adjudicator saw the document and all
34 raises pooled together, and was not told which system produced which.

The independent reviewer found **7 material defects**:

| | affects | |
|---|---|---|
| D1 | FR-3 | "easy to use on a phone" is circular; no checkable bar |
| D2 | FR-6 | staff order list has no auth requirement; the straightforward build leaks customer name and phone on an open URL, contradicting NFR-2 |
| D3 | FR-5 | order line items, quantities and prices-at-submission never stated as persisted |
| D4 | FR-7 | only time-of-day constrained; no pickup date window, no prep lead time |
| D5 | FR-6 | "current day" ambiguous between submitted-today and pickup-today |
| D6 | FR-1 | nothing defines how the daily availability flag gets set |
| D7 | FR-2 | no server-side revalidation that basket items still exist; quantity unbounded |

Scored by `bench/score.ts`:

```
  system  raised  signal  noise  miss  prec(raw)  prec(triaged)  recall
  v2      28      0       28     7     0%         0%             0%
  v3      6       2       4      6     33%        67%            14%
```

The adjudicator confirmed 3 of 34 raises — all three from v3, none from v2.
Its dismissals of v2 were mostly factual: `[desc]` and `[scope]` *are*
registered in `## Sources`; `[Q1]` *is* answered; the scope entry *is* labelled
workflow-selected. One v3 raise (NFR-2) the adjudicator confirmed but the
reviewer had not listed as material, so the scorer counts it as noise — a real
disagreement between two independent judges, left visible rather than resolved.

### The finding that matters

v3 beats v2 on every column, and **both lose the argument**. Between them the
two systems raised 34 findings and caught **one** of seven material defects.
D2 alone is a customer-PII leak that ships.

Neither system has any path to D2–D7, because they are not properties of the
document's form — they are domain reasoning about what the document does not
say. This is a direct challenge to the design in
`docs/` §"Design": anchoring judgment rules to deterministic raises, borrowed
from Semgrep, is a good rule for **precision** and a bad rule for **recall**.
Nothing deterministic points at "the staff list has no auth". At least one rule
has to be an open-ended reviewer pass over the artifact against the plan's
questions — closer to v2's reviewer agent than to a linter.

Cheapness is not the interesting result. 10x smaller than v2 matters much less
than 1-of-7.

### Bugs this scenario found

In v3, from running one realistic document rather than a synthetic corpus:

1. `phase` was loaded on every rule and never used to filter, so construction
   rules fired at an inception gate.
2. `requirements/testable` markers missed the given/when/then form.
3. Markers matched without the dotall flag, so a **line-wrapped** acceptance
   criterion read as an absent one — v2's "a thematic break voids the summary
   receipt" failure class, reproduced in miniature. No regex tuning removes
   this; it is the standing argument for a real judgment tier.

In the measurement apparatus itself:

4. `score.ts` matched defect targets by substring, so `NFR-2` matched defect
   `FR-2` and inflated v3's recall from 14% to 29%. The bug favoured the
   system its author wrote. Fixed to word-bounded matching — and a reminder
   that the scorer needs the same scrutiny as the thing it scores.
