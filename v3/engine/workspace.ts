// The three substrates, all immutable at check time.
//
//   A. artifacts/   — state: what the team currently believes
//   B. ledger.jsonl — trajectory: what happened, append-only, sole truth
//   C. trace.jsonl  — behaviour: OTel-shaped spans of what the agent did
//
// Every rule is a pure function over these. No mutable tracking state
// exists anywhere in this engine, so no invalidation and no deadlock.

import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { parseYaml, type Y } from "./yaml.ts";

export type LedgerEvent = {
  ts: string;
  event: string;
  stage?: string;
  actor?: "human" | "agent";
  artifact?: string;
  digest?: string;
  detail?: string;
};

export type Span = {
  name: string;
  op: "invoke_agent" | "chat" | "execute_tool";
  start: string;
  end?: string;
  tool?: string;
  target?: string;
  mode?: "read" | "write";
};

export type Artifact = { path: string; rel: string; text: string; mtime: number };

export type Config = {
  extends: string[];
  run_on: string[];
  tier: "deterministic" | "judgment";
  rules: Record<string, "error" | "warn" | "note" | "off">;
  policy: { judgment_max_severity: string; error_requires_override_path: boolean };
  plan: string;
};

export type Workspace = {
  root: string;
  config: Config;
  ledger: LedgerEvent[];
  trace: Span[];
  artifacts: Artifact[];
};

const DEFAULT_CONFIG: Config = {
  extends: ["aidlc:recommended"],
  run_on: ["gate", "commit"],
  tier: "deterministic",
  rules: {},
  policy: { judgment_max_severity: "warn", error_requires_override_path: true },
  plan: "express",
};

export function ledgerPath(root: string) { return join(root, ".aidlc", "ledger.jsonl"); }
export function tracePath(root: string) { return join(root, ".aidlc", "trace.jsonl"); }
export function artifactsDir(root: string) { return join(root, "aidlc-docs"); }

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);
}

export function appendLedger(root: string, ev: LedgerEvent): void {
  const p = ledgerPath(root);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(ev) + "\n");
}

export function appendSpan(root: string, span: Span): void {
  const p = tracePath(root);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(span) + "\n");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md") || e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

export function loadConfig(root: string): Config {
  const p = join(root, "aidlc.config.yaml");
  if (!existsSync(p)) return { ...DEFAULT_CONFIG };
  const raw = parseYaml(readFileSync(p, "utf8")) as Record<string, Y>;
  const rules: Config["rules"] = {};
  const rawRules = (raw.rules ?? {}) as Record<string, Y>;
  for (const [k, v] of Object.entries(rawRules)) rules[k] = String(v) as Config["rules"][string];
  return {
    extends: (raw.extends as string[]) ?? DEFAULT_CONFIG.extends,
    run_on: (raw.run_on as string[]) ?? DEFAULT_CONFIG.run_on,
    tier: (raw.tier as Config["tier"]) ?? DEFAULT_CONFIG.tier,
    rules,
    policy: { ...DEFAULT_CONFIG.policy, ...((raw.policy as object) ?? {}) } as Config["policy"],
    plan: (raw.plan as string) ?? DEFAULT_CONFIG.plan,
  };
}

export function loadWorkspace(root: string): Workspace {
  const adir = artifactsDir(root);
  const artifacts = walk(adir).map((p) => ({
    path: p,
    rel: relative(root, p).split("\\").join("/"),
    text: readFileSync(p, "utf8"),
    mtime: statSync(p).mtimeMs,
  }));
  return {
    root,
    config: loadConfig(root),
    ledger: readJsonl<LedgerEvent>(ledgerPath(root)),
    trace: readJsonl<Span>(tracePath(root)),
    artifacts,
  };
}

// --- ledger queries. Temporal facts are read, never cached. ---

export function lastIndexOf(ledger: LedgerEvent[], pred: (e: LedgerEvent) => boolean): number {
  for (let i = ledger.length - 1; i >= 0; i--) if (pred(ledger[i])) return i;
  return -1;
}

export function completedStages(ledger: LedgerEvent[]): string[] {
  return ledger.filter((e) => e.event === "STAGE_COMPLETED" && e.stage).map((e) => e.stage!);
}

export function findArtifact(ws: Workspace, needle: string): Artifact | undefined {
  return ws.artifacts.find((a) => a.rel.endsWith(needle) || a.rel.includes("/" + needle));
}
