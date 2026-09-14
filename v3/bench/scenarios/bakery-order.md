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


---

## Result: Experiment C, concerns vs rules (2026-09-12)

Same document, same ground truth. Four review conditions, each a fresh-context
subagent that saw only the prompt, the document, and (where applicable)
`v3/concerns/baseline.yaml` — never the defect list.

```
  condition                       recall    caught
  ------------------------------------------------------------------
  v2 sensors (28 raised)          0/7 (  0%)  --
  v3 rules (6 raised)             1/7 ( 14%)  D1
  reviewer, no concerns           7/7 (100%)  D1..D7
  concerns + SMALL model          5/7 ( 71%)  D1, D2, D3, D6, D7
  concerns + default model        7/7 (100%)  D1..D7
```

**A small model with ~250 words of concerns beats the 962-line rule engine by
5x.** Both of the small model's misses appeared in its own concern walkthrough
(it flagged the `"current day"` ambiguity and the availability-flag source) but
were not promoted into its defect table, so 5/7 understates it.

### Priming control

The concern-guided reviewers found MORE than the unguided one. Those extras are
either real defects the first reviewer missed, or artifacts of being told what
to look for — a concern list that inflates every review into 13 findings would
just be v2's false-positive storm in better prose. A skeptical adjudicator was
given the six novel claims and told that absence alone is not a defect, only
absence with consequences at this scope:

| claim | verdict |
|---|---|
| name/phone format rules | OVERREACH |
| idempotency / duplicate submission | OVERREACH |
| boundary inclusivity of 07:00 / 15:00 | OVERREACH |
| no quantity or per-slot capacity limits | REAL, minor |
| no defined submission outcome for the customer | REAL, minor |
| **order `status` never transitions beyond `received`** | **REAL, MATERIAL** |

Three of six were overreach — a real noise cost, and exactly the priming risk.
But the triage stage removed all three, which is the funnel doing the job the
stub could not.

### The ground truth was wrong

`status` never transitioning past `received` is a **material** defect: FR-6's
staff list is a read-only pile with no way to mark an order fulfilled, so staff
fall back to paper on day one. The unguided reviewer missed it. The
concern-guided default reviewer found it.

So the corrected ground truth is **8 material defects, not 7**, and the
concern-guided reviewer exceeded the unguided senior rather than merely
matching it — by being systematic where a human is associative.

Revised, against 8:

```
  v2 sensors               0/8    precision   0%  (0 of 28 confirmed)
  v3 rules                 1/8    precision  33%  (2 of 6 signal)
  reviewer, no concerns    7/8
  concerns + default       8/8    precision  62% material-strict, 85% real-at-any-severity
```

Concerns win on recall AND precision. **Single-reviewer ground truth is not
ground truth** — a methodological lesson this scenario paid for.

### What this revises in the design

1. The Semgrep anchor discipline is right for precision and wrong for recall.
   The concern pass must be its own **unanchored** tier: nothing deterministic
   points at "the staff list has no auth".
2. Three tiers, not two — cheap deterministic rules for mechanical facts
   (can be `error`), concern-driven open review for absence (`warn` only,
   never law), skeptical triage for precision, then the human.
3. Triage must be **skeptical by construction**. The instruction that worked
   was "absence alone is not a defect; judge absence with consequences at this
   scope". A credulous triage confirms everything, which is what the stub did.

### Threat to validity

The concern list was authored with these seven defects known. The frames are
standard and domain-independent (STRIDE, CRUD/data-lifecycle, input-domain,
specification quality) but selecting them was informed. This scenario cannot
distinguish the idea working from overfitting. `concerns/baseline.yaml` is now
frozen in git; the control is Scenario 2, a different domain, scored without
touching it.


---

## Result: Experiment D — v2's knowledge layer (2026-09-14)

Experiments A and C tested v2's **sensors**. That was the wrong half of v2.
v2's actual mechanism for capturing necessary considerations is 14 agent
personas, each ending in a `## Key Principles` section of about six lines,
backed by 59 knowledge files. None of it was exercised.

Two further conditions, same document, same fresh-context protocol. Each was
given ONLY a principle block extracted verbatim from v2's personas.

```
  condition                         recall      missed
  ------------------------------------------------------------------------
  v2 sensors (what express runs)    0/8 (  0%)   all
  v3 rules                          1/8 ( 12%)   D2..D8
  concerns + small model            5/8 ( 62%)   D4, D5, D8
  concerns + default model          8/8 (100%)   --
  v2 product principles ONLY        6/8 ( 75%)   D5, D8
  v2 product+security+compliance    7/8 ( 88%)   D5
```

New MATERIAL defects found beyond the eight-defect ground truth:

| condition | new finding |
|---|---|
| product only | order total never defined as server-computed |
| + security + compliance | customer PII has no classification, retention or deletion path |
| + security + compliance | **allergen disclosure — a regulatory gap for distance selling** |
| + security + compliance | order submission is an unauthenticated public write with no rate limit |

### Three corrections to earlier conclusions in this file

1. **v2's knowledge layer is its best asset, and it was never tested.** Six
   product principles reach 6/8 — better than an 8-concern list with a small
   model, and close to an unguided senior reviewer. The claim that v2 "caught
   0 of 7" is true only of its sensors.

2. **The routing hypothesis was half right.** Product principles alone DID
   catch the staff-list auth gap, so it is not the case that security defects
   need the security agent. What the specialist sets add is a different CLASS
   of defect — regulatory, data-lifecycle, abuse — that generalist review does
   not reach at all. The allergen finding is the clearest case: the document
   deliberately defers allergens with a plausible justification, and only the
   compliance principles noticed the deferral may be unlawful for online
   ordering.

3. **What actually fails in express is that no review runs.** The `express`
   scope sets `review_cap: none`, which disables reviewer dispatch entirely.
   `requirements-analysis` declares `reviewer: aidlc-product-lead-agent` and
   `review_class: advisory`, and the scope lowers that to none. So v2 authors
   the document with excellent principles, then checks it with three form
   sensors and nothing else. The knowledge exists, the reviewer mechanism
   exists, and the scope switches it off.

### The framework-compression answer

v2 already performed the conversion from published framework to usable
knowledge, and the ratio is the lesson:

| | |
|---|---|
| OWASP ASVS 5.0 | 345 clauses |
| v2 devsecops agent | **6 principles** |
| this file's concern set | 8 concerns |

**~345 into 6.** Reflecting a framework into lint rules would produce hundreds
of predicates with the recall of a form-checker; compressing it into six
sentences produces something that finds regulatory gaps. Across 14 personas
v2 holds roughly 84 principles compressing whole disciplines, and they work.

Two things to fix rather than rewrite:

- **Route by artifact, not by role.** Security and compliance principles never
  reach a requirements document in express, because their agents are bound to
  later stages. Cross-cutting concerns are not sequential specialities.
- **Add provenance.** v2's principles cite nothing, so a reader cannot check
  them against ASVS, compute coverage, or tell a house rule from a standard.
  Annotate the principles that already exist; do not author new ones.

### Confound

In real v2 the product agent AUTHORS the requirements; here it reviewed a
document it had not written. Self-review is materially weaker, so condition
"product only" overstates what a single-agent v2 step would catch. v2's own
two-agent structure (author + `product-lead-agent` reviewer) is the right
shape; express simply disables the second half.
