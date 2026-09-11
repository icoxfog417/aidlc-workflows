#!/usr/bin/env bun
// aidlc3 — AI-DLC v3 prototype. Rules over records, not guards over state.
//
//   aidlc3 init   [--plan express]      scaffold a workflow
//   aidlc3 next                         what to work on, and what it asks
//   aidlc3 status                       progress — never a violation
//   aidlc3 record <EVENT> [flags]       append to the ledger
//   aidlc3 check  [--gate <cp>] ...     run the rules
//   aidlc3 rules                        list rules and their severity
//
// `check` is invoked at checkpoints. Nothing here runs on a tool call, so
// there is no per-tool-call overhead and nothing that can refuse mid-work.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLedger, appendSpan, artifactsDir, ledgerPath, loadWorkspace,
  type LedgerEvent, type Span,
} from "./engine/workspace.ts";
import { loadRules, raiseAll, triage, effectiveSeverity, primitiveNames, type TriageMode } from "./engine/rules.ts";
import * as S from "./engine/suppress.ts";
import { renderFindings, sarif } from "./engine/report.ts";
import { loadPlan, nextStep, progress } from "./engine/plan.ts";

export const VERSION = "3.0.0-prototype";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = process.env.AIDLC3_RULES ?? join(HERE, "rules");
const PLANS_DIR = process.env.AIDLC3_PLANS ?? join(HERE, "plans");

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length && !args[i + 1].startsWith("--")) return args[i + 1];
  return args.includes(`--${name}`) ? "" : fallback;
}
const has = (args: string[], name: string) => args.includes(`--${name}`);

function suppressionsPath(root: string) { return join(root, ".aidlc-suppressions.json"); }

// ---------------------------------------------------------------- init

function cmdInit(root: string, args: string[]): number {
  const planName = flag(args, "plan", "express")!;
  mkdirSync(join(root, ".aidlc"), { recursive: true });
  mkdirSync(artifactsDir(root), { recursive: true });
  const cfg = join(root, "aidlc.config.yaml");
  if (!existsSync(cfg)) {
    writeFileSync(cfg, `extends: [aidlc:recommended]
plan: ${planName}
run_on: [gate, commit]
tier: deterministic

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
`);
  }
  if (!existsSync(ledgerPath(root))) {
    appendLedger(root, { ts: new Date().toISOString(), event: "WORKFLOW_STARTED", detail: `plan=${planName}` });
  }
  const plan = loadPlan(PLANS_DIR, planName);
  console.log(`Initialized ${planName}: ${plan.steps.length} suggested steps, no required documents.`);
  console.log(`  config     aidlc.config.yaml`);
  console.log(`  ledger     .aidlc/ledger.jsonl`);
  console.log(`  artifacts  aidlc-docs/`);
  console.log(`\nRun \`aidlc3 next\`.`);
  return 0;
}

// ---------------------------------------------------------------- next

function cmdNext(root: string): number {
  const ws = loadWorkspace(root);
  const plan = loadPlan(PLANS_DIR, ws.config.plan);
  const step = nextStep(plan, ws);
  if (!step) { console.log("Plan complete. Nothing suggested."); return 0; }
  console.log(`${step.id} — ${step.title}${step.gate ? "  [human gate]" : ""}`);
  console.log(step.when ? `  applies when: ${step.when}\n` : "");
  console.log("Questions to answer:");
  for (const q of step.questions) console.log(`  · ${q}`);
  const rules = loadRules(RULES_DIR).filter((r) => r.checkpoint === "exit" && effectiveSeverity(r, ws) !== "off");
  console.log(`\nChecked on exit (${rules.length} rules): ${rules.map((r) => r.id).join(", ")}`);
  console.log(`\nThis is a suggestion. \`aidlc3 record STEP_SKIPPED --stage ${step.id} --detail "<why>"\` to move on.`);
  return 0;
}

// -------------------------------------------------------------- status

function cmdStatus(root: string): number {
  const ws = loadWorkspace(root);
  const plan = loadPlan(PLANS_DIR, ws.config.plan);
  const mark: Record<string, string> = { done: "x", active: "-", skipped: "s", pending: " " };
  console.log(`plan: ${plan.name}   ledger: ${ws.ledger.length} events   artifacts: ${ws.artifacts.length}   trace: ${ws.trace.length} spans\n`);
  for (const { step, state } of progress(plan, ws)) {
    console.log(`  [${mark[state]}] ${step.id.padEnd(20)} ${state === "pending" ? "" : state}`);
  }
  console.log(`\nProgress is not a violation. Run \`aidlc3 check\` for findings.`);
  return 0;
}

// -------------------------------------------------------------- record

function cmdRecord(root: string, args: string[]): number {
  const event = args[0];
  if (!event) { console.error("usage: aidlc3 record <EVENT> [--stage s] [--actor human|agent] [--artifact a] [--detail d]"); return 2; }
  const ev: LedgerEvent = {
    ts: new Date().toISOString(),
    event,
    stage: flag(args, "stage"),
    actor: flag(args, "actor") as LedgerEvent["actor"],
    artifact: flag(args, "artifact"),
    detail: flag(args, "detail"),
  };
  appendLedger(root, ev);
  console.log(`recorded ${event}${ev.stage ? ` (${ev.stage})` : ""}`);
  return 0;
}

function cmdSpan(root: string, args: string[]): number {
  const span: Span = {
    name: args[0] ?? "execute_tool",
    op: (flag(args, "op", "execute_tool") as Span["op"]),
    start: flag(args, "at", new Date().toISOString())!,
    tool: flag(args, "tool"),
    target: flag(args, "target"),
    mode: flag(args, "mode") as Span["mode"],
  };
  appendSpan(root, span);
  return 0;
}

// --------------------------------------------------------------- check

function cmdCheck(root: string, args: string[]): number {
  const ws = loadWorkspace(root);
  const rules = loadRules(RULES_DIR);
  const checkpoint = flag(args, "gate");
  const phase = flag(args, "phase");
  const mode = (flag(args, "judge", "stub") as TriageMode);

  const { findings: raised } = raiseAll(ws, rules, checkpoint, phase);
  const triaged = triage(raised, mode);

  const sPath = suppressionsPath(root);

  if (has(args, "suppress-all")) {
    S.save(sPath, S.tally(triaged));
    console.log(`Baselined ${triaged.length} existing finding(s) into ${sPath}.`);
    console.log("Only new findings will be reported from here.");
    return 0;
  }
  if (has(args, "prune")) {
    const pruned = S.prune(S.load(sPath), triaged);
    S.save(sPath, pruned);
    console.log(`Pruned suppressions to match current findings.`);
    return 0;
  }

  const applied = S.apply(triaged, S.load(sPath));

  const sarifOut = flag(args, "sarif");
  if (sarifOut) {
    mkdirSync(dirname(resolve(root, sarifOut)), { recursive: true });
    writeFileSync(resolve(root, sarifOut), sarif(applied.remaining, rules, VERSION));
  }

  if (has(args, "json")) {
    console.log(JSON.stringify({
      raised: raised.length,
      confirmed: applied.remaining.filter((f) => f.triage?.verdict === "confirmed").length,
      dismissed: triaged.filter((f) => f.triage?.verdict === "dismissed").length,
      suppressed: applied.suppressed,
      stale: applied.stale.length,
      blocking: applied.remaining.filter((f) => f.severity === "error").length,
      findings: applied.remaining.map((f) => ({ rule: f.rule.id, severity: f.severity, where: f.where, detail: f.detail, triage: f.triage })),
    }, null, 2));
  } else {
    console.log(checkpoint ? `\naidlc3 check — gate: ${checkpoint}\n` : "\naidlc3 check\n");
    console.log(renderFindings(applied, { checkpoint, triaged: mode !== "none" }));
  }

  return applied.remaining.some((f) => f.severity === "error") ? 1 : 0;
}

// --------------------------------------------------------------- rules

function cmdRules(root: string): number {
  const ws = loadWorkspace(root);
  const rules = loadRules(RULES_DIR);
  console.log(`${rules.length} rules · ${primitiveNames().length} check primitives\n`);
  for (const r of rules) {
    const sev = effectiveSeverity(r, ws);
    console.log(`  ${sev.padEnd(6)} ${r.id.padEnd(34)} ${r.kind.padEnd(14)} ${r.substrate.join("+").padEnd(18)} ${r.checkpoint}`);
  }
  return 0;
}

// ----------------------------------------------------------------- main

const USAGE = `aidlc3 ${VERSION} — rules over records

  init [--plan <name>]        scaffold a workflow
  next                        what to work on, and what it asks
  status                      progress (never a violation)
  record <EVENT> [flags]      append to the ledger
  span <name> [flags]         append an execution-trace span
  check [flags]               run the rules
  rules                       list rules and effective severity

check flags:
  --gate <checkpoint>         only rules for this checkpoint
  --phase <name>              only rules tagged for this phase
  --judge none|stub|model     triage mode (default: stub)
  --suppress-all              baseline existing findings
  --prune                     drop suppressions no longer needed
  --sarif <path>              also write SARIF
  --json                      machine-readable summary
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  const cmd = args[0];
  const root = resolve(flag(args, "project", process.cwd())!);
  const rest = args.slice(1);
  switch (cmd) {
    case "init": return cmdInit(root, rest);
    case "next": return cmdNext(root);
    case "status": return cmdStatus(root);
    case "record": return cmdRecord(root, rest);
    case "span": return cmdSpan(root, rest);
    case "check": return cmdCheck(root, rest);
    case "rules": return cmdRules(root);
    default: console.log(USAGE); return cmd ? 2 : 0;
  }
}

if (import.meta.main) process.exit(main(process.argv));
