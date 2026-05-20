import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readState, assertState, transitionState, getValidTransitions } from "../scripts/lib/state-machine";

function makeTmpRun(initialState: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  fs.writeFileSync(
    path.join(dir, "content-object.md"),
    `---\nstate: ${initialState}\nupdated_at: 2026-01-01\n---\n\n## State log\n`
  );
  return dir;
}

describe("state-machine", () => {
  it("reads current state", () => {
    const dir = makeTmpRun("idea");
    expect(readState(dir)).toBe("idea");
  });

  it("allows valid transitions", () => {
    const dir = makeTmpRun("draft");
    transitionState(dir, "verified", "test");
    expect(readState(dir)).toBe("verified");
  });

  it("rejects invalid transitions", () => {
    const dir = makeTmpRun("idea");
    expect(() => transitionState(dir, "published")).toThrow(/Invalid transition/);
  });

  it("assertState passes on match", () => {
    const dir = makeTmpRun("draft");
    expect(() => assertState(dir, "draft")).not.toThrow();
    expect(() => assertState(dir, ["draft", "verified"])).not.toThrow();
  });

  it("assertState throws on mismatch", () => {
    const dir = makeTmpRun("idea");
    expect(() => assertState(dir, "draft")).toThrow(/State machine violation/);
  });

  it("getValidTransitions returns correct set", () => {
    expect(getValidTransitions("idea")).toEqual(["brief", "archived"]);
    expect(getValidTransitions("published")).toEqual(["archived"]);
  });
});
