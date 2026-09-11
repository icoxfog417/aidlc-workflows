// Rule engine. Every rule is a pure function of (workspace, params) -> raises.
// Rules never share state, never run in a required order, and never mutate
// anything — so two rules cannot disagree, and deadlock is unrepresentable.
//
// Rules are authored in YAML against a closed vocabulary of `check`
// primitives implemented here. A tech lead writes a rule; nobody writes
// TypeScript to add one. That is what makes "law depends on country" real.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, type Y } from "./yaml.ts";
import { findArtifact, type Span, type Workspace } from "./workspace.ts";

export type Severity = "error" | "warn" | "note" | "off";

export type Rule = {
  id: string;
  kind: "deterministic" | "judgment";
  phase: string[];
  checkpoint: "entry" | "exit" | "any";
  substrate: string[];
  check: string;
  params: Record<string, Y>;
  principle: string;
  severity: Severity;
  fix: "none" | "suggest";
};

export type Raise = {
  rule: Rule;
  where: string;
  detail: string;
  /** Deterministic anchor text a judgment pass is asked to adjudicate. */
  anchor?: string;
};

export type Finding = Raise & {
  severity: Severity;
  triage?: { verdict: "confirmed" | "dismissed"; confidence: number; note: string };
};

type Primitive = (ws: Workspace, p: Record<string, Y>, rule: Rule) => Raise[];

// ---------- helpers over artifact text ----------

const ID_RE = /^\s*[-*]?\s*\*{0,2}(FR-\d+|NFR-\d+|ENT-\d+|BR-[\d.]+)\*{0,2}\s*[:.\)]/;

function itemsOf(text: string): { id: string; line: number; body: string }[] {
  const out: { id: string; line: number; body: string }[] = [];
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    const m = l.match(ID_RE);
    if (!m) return;
    let body = l;
    for (let j = i + 1; j < lines.length && !ID_RE.test(lines[j]) && !/^#{1,6}\s/.test(lines[j]); j++) body += "\n" + lines[j];
    out.push({ id: m[1], line: i + 1, body });
  });
  return out;
}

function tsOf(e: { ts: string }) { return Date.parse(e.ts); }
/** Spans carry `start`, ledger events carry `ts`. Mixing them silently
 *  yields NaN comparisons, which read as "no prior read". */
function spanTs(s: Span) { return Date.parse(s.start); }

/** A malformed rule degrades to a rule error, never a broken run. */
export const ruleErrors: { rule: string; message: string }[] = [];
function safeRe(pattern: string, flags: string, ruleId: string): RegExp | null {
  try { return new RegExp(pattern, flags); }
  catch (e) { ruleErrors.push({ rule: ruleId, message: `invalid pattern ${JSON.stringify(pattern)}: ${(e as Error).message}` }); return null; }
}

// ---------- the primitive vocabulary ----------

const PRIMITIVES: Record<string, Primitive> = {
  // Each identified item in an artifact must contain a marker.
  "artifact.items_missing_marker": (ws, p, rule) => {
    const a = findArtifact(ws, String(p.artifact));
    if (!a) return [];
    const markers = (p.markers as string[]) ?? [];
    return itemsOf(a.text)
      .filter((it) => !markers.some((m) => safeRe(m, "i", rule.id)?.test(it.body) ?? false))
      .map((it) => ({ rule, where: `${a.rel}:${it.line}`, detail: `${it.id} has no ${p.label ?? "required marker"}`, anchor: it.body.slice(0, 400) }));
  },

  // Identifiers must not repeat.
  "artifact.ids_duplicated": (ws, p, rule) => {
    const a = findArtifact(ws, String(p.artifact));
    if (!a) return [];
    const seen = new Map<string, number>();
    const out: Raise[] = [];
    for (const it of itemsOf(a.text)) {
      if (seen.has(it.id)) out.push({ rule, where: `${a.rel}:${it.line}`, detail: `${it.id} already defined at line ${seen.get(it.id)}` });
      else seen.set(it.id, it.line);
    }
    return out;
  },

  // A required heading is absent from an artifact that exists.
  "artifact.section_absent": (ws, p, rule) => {
    const a = findArtifact(ws, String(p.artifact));
    if (!a) return [];
    const heading = String(p.heading);
    if (safeRe(`^#{1,6}\\s+${heading}\\s*$`, "mi", rule.id)?.test(a.text) ?? false) return [];
    return [{ rule, where: a.rel, detail: `no "${heading}" section` }];
  },

  // Every ID in `from` must be referenced somewhere in `to`.
  "crossref.ids_uncovered": (ws, p, rule) => {
    const from = findArtifact(ws, String(p.from));
    const to = findArtifact(ws, String(p.to));
    if (!from) return [];
    if (!to) return [{ rule, where: String(p.to), detail: `${p.to} is absent, so no ${p.from} item is covered` }];
    return itemsOf(from.text)
      .filter((it) => !to.text.includes(it.id))
      .map((it) => ({ rule, where: `${from.rel}:${it.line}`, detail: `${it.id} is not referenced in ${to.rel}` }));
  },

  // A ledger event must be preceded by another since the last reset event.
  "ledger.event_without_preceding": (ws, p, rule) => {
    const target = String(p.event);
    const required = String(p.preceded_by);
    const resets = (p.reset_on as string[]) ?? [];
    const out: Raise[] = [];
    ws.ledger.forEach((e, i) => {
      if (e.event !== target) return;
      let floor = 0;
      for (let j = i - 1; j >= 0; j--) if (resets.includes(ws.ledger[j].event)) { floor = j; break; }
      const ok = ws.ledger.slice(floor, i).some((x) => x.event === required);
      if (!ok) out.push({ rule, where: `ledger:${e.ts}`, detail: `${target}${e.stage ? ` (${e.stage})` : ""} with no ${required} since the last gate resolution` });
    });
    return out;
  },

  // An artifact was written after the approval that covers it.
  "ledger.artifact_changed_after_approval": (ws, _p, rule) => {
    const out: Raise[] = [];
    ws.ledger.forEach((e, i) => {
      if (e.event !== "GATE_APPROVED" || !e.artifact) return;
      const later = ws.ledger.slice(i + 1).find((x) => x.event === "ARTIFACT_WRITTEN" && x.artifact === e.artifact);
      if (later) out.push({ rule, where: `ledger:${later.ts}`, detail: `${e.artifact} was written after its approval at ${e.ts}` });
    });
    return out;
  },

  // Incidental behavioural evidence: wrote files matching `write_glob`
  // without ever having read something matching `read_glob` beforehand.
  "trace.write_without_prior_read": (ws, p, rule) => {
    const wre = safeRe(String(p.write_match), "", rule.id);
    const rre = safeRe(String(p.read_match), "", rule.id);
    if (!wre || !rre) return [];
    const writes = ws.trace.filter((s) => s.mode === "write" && s.target && wre.test(s.target));
    if (writes.length === 0) return [];
    const first = writes.reduce((a, b) => (spanTs(a) <= spanTs(b) ? a : b));
    const priorRead = ws.trace.some((s) => s.mode === "read" && s.target && rre.test(s.target) && spanTs(s) < spanTs(first));
    if (priorRead) return [];
    return [{
      rule,
      where: `trace:${first.start}`,
      detail: `${writes.length} write(s) matching ${p.write_match} with no prior read of ${p.read_match}`,
      anchor: writes.slice(0, 6).map((w) => w.target).join(", "),
    }];
  },

  // A stage completed without the artifact it was expected to leave behind.
  // Absence is reported, never refused — incompleteness is a state.
  "ledger.stage_without_artifact": (ws, p, rule) => {
    const stage = String(p.stage);
    const done = ws.ledger.some((e) => e.event === "STAGE_COMPLETED" && e.stage === stage);
    if (!done) return [];
    if (findArtifact(ws, String(p.artifact))) return [];
    return [{ rule, where: `ledger:${stage}`, detail: `${stage} completed with no ${p.artifact}` }];
  },
};

export function primitiveNames(): string[] { return Object.keys(PRIMITIVES); }

// ---------- loading ----------

export function loadRules(dir: string): Rule[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const r = parseYaml(readFileSync(join(dir, f), "utf8")) as Record<string, Y>;
      return {
        id: String(r.id),
        kind: (r.kind as Rule["kind"]) ?? "deterministic",
        phase: (r.phase as string[]) ?? [],
        checkpoint: (r.checkpoint as Rule["checkpoint"]) ?? "any",
        substrate: (r.substrate as string[]) ?? ["artifacts"],
        check: String(r.check),
        params: (r.params as Record<string, Y>) ?? {},
        principle: String(r.principle ?? "").trim(),
        severity: (r.severity as Severity) ?? "warn",
        fix: (r.fix as Rule["fix"]) ?? "none",
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Config severity wins; policy caps unanchored judgment rules. */
export function effectiveSeverity(rule: Rule, ws: Workspace): Severity {
  const configured = ws.config.rules[rule.id];
  let sev: Severity = configured ?? rule.severity;
  if (rule.kind === "judgment" && sev === "error" && ws.config.policy.judgment_max_severity === "warn") sev = "warn";
  if (rule.kind === "judgment" && ws.config.tier !== "judgment") sev = "off";
  return sev;
}

// ---------- stage 1: raise ----------

export function raiseAll(ws: Workspace, rules: Rule[], checkpoint?: string): { findings: Finding[]; skipped: number } {
  const findings: Finding[] = [];
  let skipped = 0;
  for (const rule of rules) {
    const sev = effectiveSeverity(rule, ws);
    if (sev === "off") { skipped++; continue; }
    if (checkpoint && rule.checkpoint !== "any" && rule.checkpoint !== checkpoint) { skipped++; continue; }
    const prim = PRIMITIVES[rule.check];
    if (!prim) { skipped++; continue; }
    for (const r of prim(ws, rule.params, rule)) findings.push({ ...r, severity: sev });
  }
  return { findings, skipped };
}

// ---------- stage 2: triage ----------
//
// A judgment pass adjudicates a deterministic raise. `stub` is a
// reproducible stand-in so the benchmark harness is deterministic; `model`
// is the seam where a real call goes. Triage may only DOWNGRADE a raise to
// dismissed — it can never invent a finding, so the deterministic engine
// always anchors the result.

export type TriageMode = "none" | "stub" | "model";

export function triage(findings: Finding[], mode: TriageMode): Finding[] {
  if (mode === "none") return findings;
  return findings.map((f) => {
    if (f.rule.kind !== "judgment" && !f.anchor) return f;
    if (mode === "stub") {
      // Deterministic stand-in: an anchor with real substance survives,
      // an anchor that is only a heading or a stub sentence is dismissed.
      const substantive = (f.anchor ?? "").replace(/[#*\-\s]/g, "").length > 40;
      return {
        ...f,
        triage: substantive
          ? { verdict: "confirmed" as const, confidence: 0.81, note: "anchor carries substantive content" }
          : { verdict: "dismissed" as const, confidence: 0.74, note: "anchor is a stub; no real claim to judge" },
      };
    }
    return f; // "model" seam: not wired to an API in this prototype
  });
}

export function surviving(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.triage?.verdict !== "dismissed");
}
