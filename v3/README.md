# aidlc3 — v3 prototype

A working prototype of AI-DLC as a rule engine rather than an enforcement
runtime. It runs the same workflow the v2 `express` scope runs, and it can be
measured.

```
bun v3/aidlc3.ts init --plan express
bun v3/aidlc3.ts next
bun v3/aidlc3.ts check --gate exit
bun v3/bench/run.ts        # seeded-defect benchmark
bun v3/tests.ts            # 10 tests
```

## What it is

Three immutable substrates, read by pure functions:

| | | |
|---|---|---|
| `aidlc-docs/` | state — what the team believes | plain Markdown, survives uninstalling |
| `.aidlc/ledger.jsonl` | trajectory — what happened, in order | append-only, the sole source of truth |
| `.aidlc/trace.jsonl` | behaviour — what the agent did | OTel-shaped spans (`execute_tool`, read/write) |

Eleven rules authored in YAML against eight `check` primitives. Findings flow
through **raise** (deterministic, over ledger and trace) → **triage** (judgment,
may only dismiss) → **decide** (human, at a gate).

Nothing here runs on a tool call. `check` is invoked at checkpoints, so there
is no hook chain, no per-call cost, and nothing that can refuse mid-work.

## Why it cannot deadlock

Every rule is `(workspace, params) → raises`. No rule reads another rule's
output, no rule writes anything, and no rule depends on evaluation order —
`tests.ts` pins both properties. Two rules therefore cannot disagree. v2's
guards shared `freshReviewReceipts`, the active-directive marker and the
authority revision counter; that shared mutable state *was* the deadlock.

Temporal facts — "was the plan written before the code?", "did a human approve
this?" — are queries over the append-only ledger and trace, never a cache of
what those files mean.

## Measured against v2 (2.8.2)

| | v2 | v3 prototype |
|---|---|---|
| Code that runs regardless of scope | 66,877 lines (10 core tools) | 962 lines (engine + CLI) |
| Hooks wired on every tool call | 9,110 lines / 6 can refuse | 0 |
| Per-tool-call overhead | 318 ms + 53 ms | 0 ms |
| Checkpoint cost | — | 1.0 ms mean |
| Prose an express run must satisfy | 34,108 words | 785 words (rules + plan) |
| Test suite | 289,859 lines | 435 lines |
| Guard off-switches | 14 env vars | 0 |
| Detection of seeded process defects | not measurable — see below | 11/11 |
| False positives on a clean run | not measurable | 0 |

The v2 column counts only what an `express` run pays for regardless of scope;
v2's full engine is 125,624 lines and does far more (33 stages, 11 scopes,
7 harnesses, plugins, swarm, worktrees). This prototype implements one scope
and does not run agents — it checks their output.

## The benchmark

`bench/corpus.ts` builds one well-formed express run and eleven copies, each
carrying exactly one seeded **process** defect: an approval with no human
turn, an artifact edited after its gate, code written before the plan was ever
read, a duplicate requirement ID, a requirement with no acceptance condition,
an untested requirement, and so on. `bench/run.ts` reports detection rate,
false positives on the clean fixture, precision, noise per fixture, and cost.

This is how static-analysis benchmarks (Juliet, OWASP Benchmark) get precision
and recall without ground truth about quality — seed known defects, measure
against the seed list. It needs no human rating and is fully reproducible.

**The score is not the point.** The rules and the defects were written by the
same author, so 11/11 and zero false positives is close to tautological. The
deliverable is the harness: any system that reads the same three substrates
can be pointed at the same corpus, which is what makes a v2/v3 comparison an
experiment rather than an argument.

On its first run the benchmark found three real bugs — a YAML escaping fault
that made one rule never match, a human-presence rule that let a turn from an
earlier stage authorise a later gate forever, and a span/event timestamp
mismatch that silently produced `NaN` comparisons. That is the property v2
never had: **v2's guards are PreToolUse interceptors and cannot be run against
a static corpus at all**, so nobody could measure whether one worked.

## Status and limits

- **Prototype.** One scope, no agent orchestration, no migration from v2.
- **Judgment triage is a deterministic stub** (`--judge stub`) so the benchmark
  is reproducible. `--judge model` is a seam, not an implementation.
- **The corpus is self-authored.** Independent defect seeding is needed before
  any score means anything.
- Rule authoring is YAML over a closed primitive vocabulary; adding a genuinely
  new *kind* of check still means adding a primitive in TypeScript.

## Layout

```
aidlc3.ts          CLI                                   249
engine/rules.ts    rule model, primitives, funnel        258
engine/workspace.ts three substrates                     143
engine/yaml.ts     YAML subset parser                    107
engine/report.ts   human output + SARIF                   78
engine/suppress.ts baseline / prune / stale               74
engine/plan.ts     suggested order (never a schema)       53
rules/*.yaml       11 rules                              ~160
plans/express.yaml suggested order for express            55
bench/             corpus + runner                       340
tests.ts           10 tests                               95
```
