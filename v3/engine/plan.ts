// A plan is a SUGGESTED order, not a schema. Steps carry questions to be
// answered, never documents that must exist. Nothing here can refuse: the
// plan reports where the work stands and what is still open.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, type Y } from "./yaml.ts";
import { completedStages, type Workspace } from "./workspace.ts";

export type Step = {
  id: string;
  title: string;
  checkpoint: string;
  when?: string;
  gate?: boolean;
  questions: string[];
};

export type Plan = { name: string; description: string; steps: Step[] };

export function loadPlan(dir: string, name: string): Plan {
  const p = join(dir, `${name}.yaml`);
  if (!existsSync(p)) throw new Error(`no plan "${name}" in ${dir}`);
  const raw = parseYaml(readFileSync(p, "utf8")) as Record<string, Y>;
  return {
    name: String(raw.name),
    description: String(raw.description ?? "").trim(),
    steps: ((raw.steps as Record<string, Y>[]) ?? []).map((s) => ({
      id: String(s.id),
      title: String(s.title),
      checkpoint: String(s.checkpoint ?? "exit"),
      when: s.when ? String(s.when) : undefined,
      gate: s.gate === true,
      questions: (s.questions as string[]) ?? [],
    })),
  };
}

export function nextStep(plan: Plan, ws: Workspace): Step | null {
  const done = new Set(completedStages(ws.ledger));
  const skipped = new Set(ws.ledger.filter((e) => e.event === "STEP_SKIPPED").map((e) => e.stage));
  return plan.steps.find((s) => !done.has(s.id) && !skipped.has(s.id)) ?? null;
}

export function progress(plan: Plan, ws: Workspace) {
  const done = new Set(completedStages(ws.ledger));
  const skipped = new Set(ws.ledger.filter((e) => e.event === "STEP_SKIPPED").map((e) => e.stage));
  const started = new Set(ws.ledger.filter((e) => e.event === "STAGE_STARTED").map((e) => e.stage));
  return plan.steps.map((s) => ({
    step: s,
    state: done.has(s.id) ? "done" : skipped.has(s.id) ? "skipped" : started.has(s.id) ? "active" : "pending",
  }));
}
