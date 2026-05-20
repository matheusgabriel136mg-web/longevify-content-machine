/**
 * state-machine.ts — Enforces valid content-object state transitions.
 *
 * States: idea → brief → draft → verified → published → archived
 *
 * Every phase script (writer, visual-gen, verifier, publish) MUST call:
 *   assertState(runDir, expectedFrom)
 *   transitionState(runDir, to)
 *
 * Violations throw an error, halting the pipeline.
 */

import * as fs from "fs";
import * as path from "path";

export type State = "idea" | "brief" | "draft" | "verified" | "published" | "archived";

const VALID_TRANSITIONS: Record<State, State[]> = {
  idea: ["brief", "archived"],
  brief: ["draft", "idea", "archived"],
  draft: ["verified", "brief", "archived"],
  verified: ["published", "draft", "archived"],
  published: ["archived"],
  archived: [],
};

export function readState(runDir: string): State {
  const coPath = path.join(runDir, "content-object.md");
  if (!fs.existsSync(coPath)) throw new Error(`content-object.md not found: ${runDir}`);
  const content = fs.readFileSync(coPath, "utf-8");
  const m = content.match(/^state:\s*(\w+)/m);
  if (!m) throw new Error(`No 'state:' field in ${coPath}`);
  return m[1] as State;
}

export function assertState(runDir: string, expectedFrom: State | State[]): void {
  const current = readState(runDir);
  const expected = Array.isArray(expectedFrom) ? expectedFrom : [expectedFrom];
  if (!expected.includes(current)) {
    throw new Error(
      `State machine violation: ${path.basename(runDir)} is in state '${current}', but phase requires one of [${expected.join(", ")}]`
    );
  }
}

export function transitionState(runDir: string, to: State, reason?: string): void {
  const current = readState(runDir);
  const allowed = VALID_TRANSITIONS[current] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid transition: ${current} → ${to} (allowed from ${current}: [${allowed.join(", ")}])`
    );
  }
  const coPath = path.join(runDir, "content-object.md");
  let content = fs.readFileSync(coPath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);
  content = content
    .replace(/^state:\s*\w+.*$/m, `state: ${to}`)
    .replace(/^updated_at:\s*.*$/m, `updated_at: ${today}`);

  if (content.includes("## State log")) {
    content = content.replace(
      "## State log",
      `## State log\n- ${today}: ${current} → ${to}${reason ? " (" + reason + ")" : ""}`
    );
  }
  fs.writeFileSync(coPath, content);
}

export function getValidTransitions(from: State): State[] {
  return VALID_TRANSITIONS[from] ?? [];
}
