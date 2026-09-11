// Reporting. Every finding cites its rule id and quotes its principle, so a
// suppression names a rule rather than a vibe and the telemetry has something
// to count. SARIF is emitted so GitHub code scanning renders findings as PR
// annotations with no bespoke UI.

import type { Finding, Rule, Severity } from "./rules.ts";
import type { Applied } from "./suppress.ts";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  error: "\x1b[31m", warn: "\x1b[33m", note: "\x1b[36m", ok: "\x1b[32m",
};
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (k: keyof typeof C, s: string) => (color ? C[k] + s + C.reset : s);

const RANK: Record<Severity, number> = { error: 0, warn: 1, note: 2, off: 3 };

export function renderFindings(applied: Applied, opts: { checkpoint?: string; triaged: boolean }): string {
  const out: string[] = [];
  const sorted = [...applied.remaining].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.rule.id.localeCompare(b.rule.id));

  for (const f of sorted) {
    const sev = f.severity === "error" ? c("error", "error") : f.severity === "warn" ? c("warn", "warn ") : c("note", "note ");
    out.push(`  ${sev}  ${c("bold", f.rule.id.padEnd(30))} ${c("dim", f.where)}`);
    if (f.rule.principle) out.push(`         ${c("dim", `"${f.rule.principle}"`)}`);
    out.push(`         ${f.detail}`);
    if (f.triage) {
      const v = f.triage.verdict === "confirmed" ? c("warn", "confirmed") : c("ok", "dismissed");
      out.push(`         ${c("dim", `Triage: ${v} (${f.triage.confidence.toFixed(2)}) — ${f.triage.note}`)}`);
    }
    out.push("");
  }

  if (applied.suppressed > 0 || applied.stale.length > 0) {
    const staleNote = applied.stale.length > 0 ? `  (${applied.stale.length} stale — run \`aidlc3 check --prune\`)` : "";
    out.push(`  ${c("note", "note ")}  ${applied.suppressed} suppressed by baseline${staleNote}`);
    out.push("");
  }

  const errors = sorted.filter((f) => f.severity === "error").length;
  const confirmed = sorted.filter((f) => f.triage?.verdict === "confirmed").length;
  const bits = [`${sorted.length} finding${sorted.length === 1 ? "" : "s"}`];
  if (opts.triaged) bits.push(`${confirmed} confirmed`);
  bits.push(`${errors} blocking`);
  out.push(c("dim", `  ${bits.join(" · ")} · exit ${errors > 0 ? 1 : 0}`));
  return out.join("\n");
}

export function sarif(findings: Finding[], rules: Rule[], version: string): string {
  const level = (s: Severity) => (s === "error" ? "error" : s === "warn" ? "warning" : "note");
  return JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: {
        name: "aidlc3",
        version,
        informationUri: "https://github.com/icoxfog417/aidlc-workflows",
        rules: rules.map((r) => ({
          id: r.id,
          shortDescription: { text: r.check },
          fullDescription: { text: r.principle },
          properties: { kind: r.kind, phase: r.phase, checkpoint: r.checkpoint, substrate: r.substrate },
        })),
      } },
      results: findings.map((f) => ({
        ruleId: f.rule.id,
        level: level(f.severity),
        message: { text: f.detail },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: f.where.split(":")[0] },
          region: { startLine: Number(f.where.split(":")[1]) || 1 },
        } }],
        properties: f.triage ? { triage: f.triage } : undefined,
      })),
    }],
  }, null, 2);
}
