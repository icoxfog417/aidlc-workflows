#!/usr/bin/env bun
// Benchmark runner. Answers "how effective is the rule set?" with numbers
// that are reproducible and need no human rating:
//
//   detection   did the seeded defect's rule fire on its fixture?
//   precision   of findings on a fixture, how many were the seeded one?
//   false pos.  findings on the clean fixture (should be zero)
//   noise       mean findings per fixture a human would have to read
//   cost        wall-clock and per-checkpoint latency
//
// The same protocol can be pointed at any system that reads the same three
// substrates, which is what makes a v2/v3 comparison fair rather than
// rhetorical.

import { join } from "node:path";
import { loadWorkspace } from "../engine/workspace.ts";
import { loadRules, raiseAll, triage, type Finding } from "../engine/rules.ts";
import { build, FIXTURES } from "./corpus.ts";

const RULES_DIR = join(import.meta.dir, "..", "rules");
const CORPUS = process.env.AIDLC3_CORPUS ?? join(import.meta.dir, "corpus");

type Row = {
  fixture: string;
  expect: string | null;
  detected: boolean;
  findings: number;
  extra: string[];
  ms: number;
};

function runOne(dir: string, expect: string | null): Row {
  const t0 = performance.now();
  const ws = loadWorkspace(dir);
  const rules = loadRules(RULES_DIR);
  const { findings } = raiseAll(ws, rules);
  const surviving: Finding[] = triage(findings, "stub").filter((f) => f.triage?.verdict !== "dismissed");
  const ms = performance.now() - t0;

  const ids = surviving.map((f) => f.rule.id);
  return {
    fixture: "",
    expect,
    detected: expect === null ? ids.length === 0 : ids.includes(expect),
    findings: surviving.length,
    extra: [...new Set(ids.filter((id) => id !== expect))],
    ms,
  };
}

function main(): number {
  build(CORPUS);
  const rules = loadRules(RULES_DIR);
  const rows: Row[] = [];

  for (const f of FIXTURES) {
    const r = runOne(join(CORPUS, f.name), f.expect);
    r.fixture = f.name;
    rows.push(r);
  }

  const defects = rows.filter((r) => r.expect !== null);
  const clean = rows.find((r) => r.expect === null)!;
  const detected = defects.filter((r) => r.detected).length;
  const totalFindings = rows.reduce((a, r) => a + r.findings, 0);
  const seeded = defects.filter((r) => r.detected).length;
  const meanMs = rows.reduce((a, r) => a + r.ms, 0) / rows.length;

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`\naidlc3 benchmark — ${rules.length} rules · ${FIXTURES.length} fixtures\n`);
  console.log(`  ${pad("fixture", 26)}${pad("expected rule", 36)}${pad("hit", 5)}${pad("found", 7)}ms`);
  console.log(`  ${"-".repeat(84)}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.fixture, 26)}${pad(r.expect ?? "(none — clean)", 36)}${pad(r.detected ? "yes" : "NO", 5)}${pad(String(r.findings), 7)}${r.ms.toFixed(1)}`,
    );
    if (r.extra.length) console.log(`  ${" ".repeat(26)}also: ${r.extra.join(", ")}`);
  }

  const precision = totalFindings === 0 ? 1 : seeded / totalFindings;
  console.log(`\n  detection rate       ${detected}/${defects.length}  (${((detection(detected, defects.length)) * 100).toFixed(0)}%)`);
  console.log(`  false positives      ${clean.findings} on the clean fixture`);
  console.log(`  precision            ${(precision * 100).toFixed(0)}%  (seeded findings / all findings)`);
  console.log(`  noise                ${(totalFindings / rows.length).toFixed(1)} findings per fixture`);
  console.log(`  mean checkpoint cost ${meanMs.toFixed(1)} ms`);
  console.log(`  per-tool-call cost   0 ms  (checkpoint-invoked; no hook chain)\n`);

  const failures = defects.filter((r) => !r.detected).length + (clean.findings > 0 ? 1 : 0);
  if (failures > 0) console.log(`  ${failures} benchmark expectation(s) unmet\n`);
  return failures > 0 ? 1 : 0;
}

function detection(hit: number, total: number) { return total === 0 ? 1 : hit / total; }

if (import.meta.main) process.exit(main());
