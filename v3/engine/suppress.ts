// Baseline suppressions, after ESLint's bulk-suppression model, with
// TypeScript's @ts-expect-error semantics bolted on: a suppression that is
// no longer needed is itself reported. That is what keeps the baseline from
// rotting — and it is the raw material for the deletion signal, since a rule
// most teams suppress is objectively a bad rule.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Finding } from "./rules.ts";

/** file -> ruleId -> count */
export type Suppressions = Record<string, Record<string, number>>;

export function load(path: string): Suppressions {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Suppressions;
}

export function save(path: string, s: Suppressions): void {
  // Sort for a stable diff. NOTE: a replacer ARRAY filters keys at every
  // level, which silently empties the nested rule maps — build the sorted
  // object instead.
  const sorted: Suppressions = {};
  for (const file of Object.keys(s).sort()) {
    sorted[file] = {};
    for (const rule of Object.keys(s[file]).sort()) sorted[file][rule] = s[file][rule];
  }
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
}

function fileOf(f: Finding): string {
  return f.where.split(":")[0];
}

export function tally(findings: Finding[]): Suppressions {
  const s: Suppressions = {};
  for (const f of findings) {
    const file = fileOf(f);
    s[file] ??= {};
    s[file][f.rule.id] = (s[file][f.rule.id] ?? 0) + 1;
  }
  return s;
}

export type Applied = {
  remaining: Finding[];
  suppressed: number;
  stale: { file: string; rule: string; recorded: number; actual: number }[];
};

export function apply(findings: Finding[], s: Suppressions): Applied {
  const budget: Suppressions = JSON.parse(JSON.stringify(s));
  const remaining: Finding[] = [];
  let suppressed = 0;
  for (const f of findings) {
    const file = fileOf(f);
    const left = budget[file]?.[f.rule.id] ?? 0;
    if (left > 0) { budget[file][f.rule.id] = left - 1; suppressed++; }
    else remaining.push(f);
  }
  const actual = tally(findings);
  const stale: Applied["stale"] = [];
  for (const [file, rules] of Object.entries(s)) {
    for (const [rule, recorded] of Object.entries(rules)) {
      const now = actual[file]?.[rule] ?? 0;
      if (now < recorded) stale.push({ file, rule, recorded, actual: now });
    }
  }
  return { remaining, suppressed, stale };
}

export function prune(s: Suppressions, findings: Finding[]): Suppressions {
  const actual = tally(findings);
  const out: Suppressions = {};
  for (const [file, rules] of Object.entries(s)) {
    for (const [rule, recorded] of Object.entries(rules)) {
      const now = actual[file]?.[rule] ?? 0;
      const keep = Math.min(recorded, now);
      if (keep > 0) { out[file] ??= {}; out[file][rule] = keep; }
    }
  }
  return out;
}
