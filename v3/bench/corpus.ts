#!/usr/bin/env bun
// Seeded-defect corpus generator.
//
// The hard half of "is this effective?" is that there is no ground truth for
// artifact quality. The way static-analysis benchmarks (Juliet, OWASP
// Benchmark) sidestep that is to seed KNOWN defects into a known-clean
// sample and measure detection against the seed list. We do the same for
// PROCESS defects: take one well-formed express run and inject exactly one
// process fault per fixture.
//
// This yields recall (did the rule fire?) and, from the clean fixture,
// false-positive rate — reproducibly, with no human rating, and applicable
// to any system that can read the same three substrates.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Fixture = { name: string; expect: string | null; note: string };

const T0 = Date.parse("2026-09-11T09:00:00Z");
const at = (min: number) => new Date(T0 + min * 60000).toISOString();

const REQUIREMENTS = `# Requirements

## Sources

- Initial description: "a small todo API with list and create" [desc]
- Workflow-selected scope: express [scope]

## Functional Requirements

- **FR-1**: The service must return 201 with the created todo id. [desc]
  - Acceptance: given a valid payload, when POST /todos, then returns 201 and a body containing an id.
- **FR-2**: The service must reject a payload with no title. [scope]
  - Acceptance: given a payload without a title, when POST /todos, then returns 400.
- **FR-3**: The list endpoint must respond within 500 ms at p95. [Q1]
  - Acceptance: given 1000 stored todos, when GET /todos, then p95 latency is under 500 ms.

## Assumptions & Open Questions

None.
`;

const TRACEABILITY = `# Traceability

| requirement | change |
| --- | --- |
| FR-1 | src/routes/create.ts |
| FR-2 | src/routes/create.ts (validation) |
| FR-3 | src/routes/list.ts (index on created_at) |
`;

const TEST_RESULTS = `# Test Results

| requirement | test | result |
| --- | --- | --- |
| FR-1 | create.test.ts::returns 201 | pass |
| FR-2 | create.test.ts::rejects missing title | pass |
| FR-3 | list.bench.ts::p95 under 500ms | pass |
`;

const DEPLOYMENT = `# Deployment

## Pipeline

Build on merge to main, deploy to staging automatically, production on manual approval.

## Rollback

Redeploy the previous image tag; the schema change is additive so no data migration is reversed.

## Signals

Error rate and p95 latency on /todos, alerting above 1% and 500 ms respectively.
`;

type Ev = Record<string, unknown>;

function cleanLedger(): Ev[] {
  return [
    { ts: at(0), event: "WORKFLOW_STARTED", detail: "plan=express" },
    { ts: at(1), event: "HUMAN_TURN", actor: "human" },
    { ts: at(2), event: "STAGE_STARTED", stage: "intent" },
    { ts: at(5), event: "STAGE_COMPLETED", stage: "intent" },
    { ts: at(6), event: "STAGE_STARTED", stage: "requirements" },
    { ts: at(20), event: "ARTIFACT_WRITTEN", stage: "requirements", artifact: "requirements.md" },
    { ts: at(22), event: "HUMAN_TURN", actor: "human" },
    { ts: at(23), event: "GATE_APPROVED", stage: "requirements", artifact: "requirements.md", actor: "human" },
    { ts: at(24), event: "STAGE_COMPLETED", stage: "requirements" },
    { ts: at(25), event: "STAGE_STARTED", stage: "code-generation" },
    { ts: at(40), event: "ARTIFACT_WRITTEN", stage: "code-generation", artifact: "traceability.md" },
    { ts: at(42), event: "HUMAN_TURN", actor: "human" },
    { ts: at(43), event: "GATE_APPROVED", stage: "code-generation", artifact: "code-generation-plan.md", actor: "human" },
    { ts: at(44), event: "STAGE_COMPLETED", stage: "code-generation" },
    { ts: at(45), event: "STAGE_STARTED", stage: "build-and-test" },
    { ts: at(55), event: "ARTIFACT_WRITTEN", stage: "build-and-test", artifact: "test-results.md" },
    { ts: at(56), event: "STAGE_COMPLETED", stage: "build-and-test" },
    { ts: at(57), event: "STAGE_STARTED", stage: "deploy" },
    { ts: at(60), event: "ARTIFACT_WRITTEN", stage: "deploy", artifact: "deployment.md" },
    { ts: at(61), event: "STAGE_COMPLETED", stage: "deploy" },
  ];
}

function cleanTrace(): Ev[] {
  return [
    { name: "invoke_agent", op: "invoke_agent", start: at(6) },
    { name: "read requirements", op: "execute_tool", start: at(26), tool: "Read", target: "aidlc-docs/requirements.md", mode: "read" },
    { name: "read plan", op: "execute_tool", start: at(27), tool: "Read", target: "aidlc-docs/code-generation-plan.md", mode: "read" },
    { name: "write route", op: "execute_tool", start: at(30), tool: "Write", target: "src/routes/create.ts", mode: "write" },
    { name: "write route", op: "execute_tool", start: at(33), tool: "Write", target: "src/routes/list.ts", mode: "write" },
    { name: "write test", op: "execute_tool", start: at(36), tool: "Write", target: "src/routes/create.test.ts", mode: "write" },
  ];
}

const CONFIG = `extends: [aidlc:recommended]
plan: express
run_on: [gate, commit]
tier: judgment

rules:
  approval/human-present: error
  requirements/has-acceptance-criteria: error
  requirements/ids-unique: error
  requirements/testable: warn
  claims/have-sources: warn
  plan/precedes-code: warn
  code/traces-to-requirement: warn
  tests/cover-requirements: warn
  deploy/has-rollback: warn
  approval/artifact-changed-after: warn
  requirements/exists: warn

policy:
  judgment_max_severity: warn
  error_requires_override_path: true
`;

type Mutation = {
  requirements?: (s: string) => string;
  traceability?: (s: string) => string;
  testResults?: (s: string) => string;
  deployment?: (s: string) => string;
  ledger?: (e: Ev[]) => Ev[];
  trace?: (e: Ev[]) => Ev[];
  dropRequirements?: boolean;
};

export const FIXTURES: (Fixture & { mutate?: Mutation })[] = [
  { name: "clean", expect: null, note: "a well-formed express run; any finding here is a false positive" },

  {
    name: "no-human-approval", expect: "approval/human-present",
    note: "the requirements gate was approved with no human turn since the last resolution",
    mutate: { ledger: (e) => e.filter((x) => !(x.event === "HUMAN_TURN" && x.ts === at(22))) },
  },
  {
    name: "edit-after-approval", expect: "approval/artifact-changed-after",
    note: "requirements.md was rewritten after the gate that approved it",
    mutate: { ledger: (e) => [...e, { ts: at(70), event: "ARTIFACT_WRITTEN", stage: "requirements", artifact: "requirements.md" }] },
  },
  {
    name: "missing-requirements-doc", expect: "requirements/exists",
    note: "the requirements step completed but left no requirements document",
    mutate: { dropRequirements: true },
  },
  {
    name: "missing-acceptance", expect: "requirements/has-acceptance-criteria",
    note: "FR-2 states a rule but no observable acceptance condition",
    mutate: { requirements: (s) => s.replace("  - Acceptance: given a payload without a title, when POST /todos, then returns 400.\n", "") },
  },
  {
    name: "duplicate-id", expect: "requirements/ids-unique",
    note: "two requirements share the identifier FR-2",
    mutate: { requirements: (s) => s.replace("**FR-3**", "**FR-2**") },
  },
  {
    name: "unsourced-claim", expect: "claims/have-sources",
    note: "FR-3 asserts a latency target with no source tag",
    mutate: { requirements: (s) => s.replace("at p95. [Q1]", "at p95.") },
  },
  {
    name: "vague-requirement", expect: "requirements/testable",
    note: "FR-3 was rewritten as a goal rather than an observable condition",
    mutate: {
      requirements: (s) => s
        .replace(
          "The list endpoint must respond within 500 ms at p95. [Q1]",
          "The list endpoint should feel fast for users. [Q1]",
        )
        .replace(
          "  - Acceptance: given 1000 stored todos, when GET /todos, then p95 latency is under 500 ms.",
          "  - Acceptance: the list feels responsive.",
        ),
    },
  },
  {
    name: "code-before-plan", expect: "plan/precedes-code",
    note: "source files were written before requirements or the plan were ever read",
    mutate: {
      trace: (e) => e.map((s) => (s.mode === "read" ? { ...s, start: at(50) } : s)),
    },
  },
  {
    name: "untraced-requirement", expect: "code/traces-to-requirement",
    note: "FR-3 never appears in the traceability table",
    mutate: { traceability: (s) => s.replace("| FR-3 | src/routes/list.ts (index on created_at) |\n", "") },
  },
  {
    name: "untested-requirement", expect: "tests/cover-requirements",
    note: "FR-2 has no corresponding test row",
    mutate: { testResults: (s) => s.replace("| FR-2 | create.test.ts::rejects missing title | pass |\n", "") },
  },
  {
    name: "no-rollback", expect: "deploy/has-rollback",
    note: "the deployment document never says how the change comes back out",
    mutate: {
      deployment: (s) => s.replace(/## Rollback\n\nRedeploy[^\n]*\n\n/, ""),
    },
  },
];

export function build(outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
  for (const f of FIXTURES) {
    const dir = join(outDir, f.name);
    const docs = join(dir, "aidlc-docs");
    mkdirSync(join(dir, ".aidlc"), { recursive: true });
    mkdirSync(docs, { recursive: true });

    const m = f.mutate ?? {};
    if (!m.dropRequirements) {
      writeFileSync(join(docs, "requirements.md"), (m.requirements ?? ((s: string) => s))(REQUIREMENTS));
    }
    writeFileSync(join(docs, "traceability.md"), (m.traceability ?? ((s: string) => s))(TRACEABILITY));
    writeFileSync(join(docs, "test-results.md"), (m.testResults ?? ((s: string) => s))(TEST_RESULTS));
    writeFileSync(join(docs, "deployment.md"), (m.deployment ?? ((s: string) => s))(DEPLOYMENT));
    writeFileSync(join(dir, "aidlc.config.yaml"), CONFIG);

    const ledger = (m.ledger ?? ((e: Ev[]) => e))(cleanLedger());
    const trace = (m.trace ?? ((e: Ev[]) => e))(cleanTrace());
    writeFileSync(join(dir, ".aidlc", "ledger.jsonl"), ledger.map((e) => JSON.stringify(e)).join("\n") + "\n");
    writeFileSync(join(dir, ".aidlc", "trace.jsonl"), trace.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}

if (import.meta.main) {
  const out = process.argv[2] ?? join(import.meta.dir, "corpus");
  build(out);
  console.log(`built ${FIXTURES.length} fixtures in ${out}`);
}
