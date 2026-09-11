#!/usr/bin/env bun
// Scorer for Experiment A. Reads three files and computes the push-back
// classification, so the numbers come out of the data rather than out of
// whoever is writing the report.
//
//   ground-truth.json   material defects, from an INDEPENDENT reviewer that
//                       saw only the document and the original prompt
//   judge-requests.json every raise from every system, in one shuffled pile
//   judge-verdicts.json confirmed/dismissed per raise, from an INDEPENDENT
//                       judge that did not know which system raised what
//
// signal   = confirmed raise that maps to a material ground-truth defect
// noise    = raise that was dismissed, or confirmed but maps to no defect
// friction = raise that blocked work (severity error)
// miss     = material defect no system raised at all
//
// precision = signal / (signal + noise)
// recall    = signal / (signal + miss)

import { readFileSync } from "node:fs";

type Request = { id: string; system: string; rule: string; where: string; detail: string };
type Verdict = { verdict: "confirmed" | "dismissed"; confidence: number; note: string };
type Defect = { id: string; target: string; severity: "MATERIAL" | "MINOR"; summary: string };

const [gtPath, reqPath, verPath] = process.argv.slice(2);
const truth: Defect[] = JSON.parse(readFileSync(gtPath, "utf8")).defects;
const requests: Request[] = JSON.parse(readFileSync(reqPath, "utf8")).requests;
const verdicts: Record<string, Verdict> = JSON.parse(readFileSync(verPath, "utf8")).verdicts;

const material = truth.filter((d) => d.severity === "MATERIAL");

/** A raise covers a defect when it names the same requirement or section.
 *  Word-bounded: a naive substring match makes "NFR-2" match defect "FR-2",
 *  which silently inflates recall. */
function covers(r: Request, d: Defect): boolean {
  const hay = `${r.where} ${r.detail}`.toUpperCase();
  const t = d.target.toUpperCase();
  if (t === "DOCUMENT-WIDE") return false;
  return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay);
}

const systems = [...new Set(requests.map((r) => r.system))].sort();
const rows = systems.map((sys) => {
  const mine = requests.filter((r) => r.system === sys);
  const confirmed = mine.filter((r) => verdicts[r.id]?.verdict === "confirmed");
  const dismissed = mine.filter((r) => verdicts[r.id]?.verdict === "dismissed");
  const unjudged = mine.filter((r) => !verdicts[r.id]);

  const signal = confirmed.filter((r) => material.some((d) => covers(r, d)));
  const noiseConfirmed = confirmed.filter((r) => !material.some((d) => covers(r, d)));
  const caught = new Set(material.filter((d) => signal.some((r) => covers(r, d))).map((d) => d.id));
  const missed = material.filter((d) => !caught.has(d.id));

  const raw = mine.length;
  const sig = signal.length;
  const noise = dismissed.length + noiseConfirmed.length;
  return {
    sys, raw, sig, noise, unjudged: unjudged.length,
    miss: missed.length, missedIds: missed.map((d) => d.id),
    precisionRaw: raw === 0 ? 0 : sig / raw,
    precisionTriaged: sig + noiseConfirmed.length === 0 ? 0 : sig / (sig + noiseConfirmed.length),
    recall: material.length === 0 ? 1 : caught.size / material.length,
  };
});

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const pad = (s: string, n: number) => s.padEnd(n);

console.log(`\nExperiment A — scored against ${material.length} material defect(s) from an independent reviewer\n`);
for (const d of material) console.log(`  ${d.id}  ${pad(d.target, 14)} ${d.summary}`);

console.log(`\n  ${pad("system", 8)}${pad("raised", 8)}${pad("signal", 8)}${pad("noise", 7)}${pad("miss", 6)}${pad("prec(raw)", 11)}${pad("prec(triaged)", 15)}recall`);
console.log(`  ${"-".repeat(72)}`);
for (const r of rows) {
  console.log(
    `  ${pad(r.sys, 8)}${pad(String(r.raw), 8)}${pad(String(r.sig), 8)}${pad(String(r.noise), 7)}${pad(String(r.miss), 6)}${pad(pct(r.precisionRaw), 11)}${pad(pct(r.precisionTriaged), 15)}${pct(r.recall)}`,
  );
  if (r.unjudged) console.log(`  ${" ".repeat(8)}(${r.unjudged} raise(s) the judge did not answer — counted as noise)`);
  if (r.missedIds.length) console.log(`  ${" ".repeat(8)}missed: ${r.missedIds.join(", ")}`);
}

console.log(`
  prec(raw)     = signal / everything the system raised      (what a human actually reads)
  prec(triaged) = signal / what survived triage              (what the funnel delivers)
  recall        = material defects caught / material defects
`);
