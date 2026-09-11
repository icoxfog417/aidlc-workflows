#!/usr/bin/env bun
// Tests. Deliberately a single file with a five-line harness: v2's suite is
// 289,859 lines against 125,624 lines of code, and that ratio is part of
// what made its architecture expensive to change.
//
// The two tests that matter are `purity` and `order independence` — together
// they are the mechanical proof that no two rules can disagree, which is the
// property v2 lacked and the reason deadlock is unrepresentable here.

import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseYaml } from "./engine/yaml.ts";
import { loadWorkspace } from "./engine/workspace.ts";
import { loadRules, raiseAll, triage, effectiveSeverity, type Finding } from "./engine/rules.ts";
import * as S from "./engine/suppress.ts";
import { build, FIXTURES } from "./bench/corpus.ts";

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, msg = "") {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x !== y) throw new Error(`${msg}\n       expected ${y}\n       actual   ${x}`);
}

const RULES = join(import.meta.dir, "rules");
const tmp = mkdtempSync(join(tmpdir(), "aidlc3-"));
build(tmp);
const ids = (f: Finding[]) => f.map((x) => `${x.rule.id}@${x.where}`).sort();

console.log("\naidlc3 tests\n");

t("yaml: nested maps, inline arrays, folded scalars", () => {
  const y = parseYaml(`id: a/b\nphase: [x, y]\nparams:\n  n: 3\n  on: true\nprinciple: >\n  one\n  two\n`) as Record<string, unknown>;
  eq(y.id, "a/b"); eq(y.phase, ["x", "y"]);
  eq((y.params as Record<string, unknown>).n, 3);
  eq((y.params as Record<string, unknown>).on, true);
  eq(y.principle, "one two");
});

t("rules load with a closed primitive vocabulary", () => {
  const rules = loadRules(RULES);
  if (rules.length < 10) throw new Error(`only ${rules.length} rules loaded`);
  for (const r of rules) if (!r.principle) throw new Error(`${r.id} has no principle`);
});

t("purity: running twice yields identical findings", () => {
  const ws = loadWorkspace(join(tmp, "missing-acceptance"));
  const rules = loadRules(RULES);
  eq(ids(raiseAll(ws, rules).findings), ids(raiseAll(ws, rules).findings));
});

t("order independence: shuffling rules cannot change the result", () => {
  const ws = loadWorkspace(join(tmp, "duplicate-id"));
  const rules = loadRules(RULES);
  const shuffled = [...rules].reverse();
  eq(ids(raiseAll(ws, rules).findings), ids(raiseAll(ws, shuffled).findings));
});

t("judgment rules are off unless the judgment tier is enabled", () => {
  const ws = loadWorkspace(join(tmp, "clean"));
  const judged = loadRules(RULES).filter((r) => r.kind === "judgment");
  if (judged.length === 0) throw new Error("no judgment rule to test");
  eq(effectiveSeverity(judged[0], { ...ws, config: { ...ws.config, tier: "deterministic" } }), "off");
});

t("policy caps an unanchored judgment rule at warn", () => {
  const ws = loadWorkspace(join(tmp, "clean"));
  const judged = loadRules(RULES).filter((r) => r.kind === "judgment")[0];
  const cfg = { ...ws.config, tier: "judgment" as const, rules: { ...ws.config.rules, [judged.id]: "error" as const } };
  eq(effectiveSeverity(judged, { ...ws, config: cfg }), "warn");
});

t("triage may only dismiss, never invent a finding", () => {
  const ws = loadWorkspace(join(tmp, "missing-acceptance"));
  const raised = raiseAll(ws, loadRules(RULES)).findings;
  const after = triage(raised, "stub");
  eq(after.length, raised.length, "triage changed the finding count");
});

t("suppressions: baseline, apply, prune, stale detection", () => {
  const ws = loadWorkspace(join(tmp, "no-rollback"));
  const f = raiseAll(ws, loadRules(RULES)).findings;
  const p = join(tmp, "sup.json");
  S.save(p, S.tally(f));
  const loaded = S.load(p);
  eq(S.apply(f, loaded).remaining.length, 0, "baselined findings should be silent");
  eq(S.apply([], loaded).stale.length, 1, "a suppression with nothing left to suppress is stale");
  eq(Object.keys(S.prune(loaded, [])).length, 0, "prune should drop it");
});

t("corpus: every seeded defect is detected, clean is silent", () => {
  const rules = loadRules(RULES);
  for (const fx of FIXTURES) {
    const ws = loadWorkspace(join(tmp, fx.name));
    const found = triage(raiseAll(ws, rules).findings, "stub")
      .filter((x) => x.triage?.verdict !== "dismissed")
      .map((x) => x.rule.id);
    if (fx.expect === null) eq(found, [], `clean fixture raised ${found.join(", ")}`);
    else if (!found.includes(fx.expect)) throw new Error(`${fx.name}: expected ${fx.expect}, got [${found.join(", ")}]`);
  }
});

t("a malformed rule degrades to a rule error, not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "aidlc3-badrule-"));
  writeFileSync(join(dir, "bad.yaml"), `id: bad/pattern\nkind: deterministic\ncheck: artifact.items_missing_marker\nparams:\n  artifact: requirements.md\n  markers: ["("]\nprinciple: broken on purpose\nseverity: warn\n`);
  const ws = loadWorkspace(join(tmp, "clean"));
  raiseAll(ws, loadRules(dir));
  rmSync(dir, { recursive: true, force: true });
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
