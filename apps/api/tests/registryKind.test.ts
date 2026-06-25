import { describe, expect, it } from "vitest";
import { TERMINAL_REGISTRY_VERSION } from "../src/terminalRuntime/constants";
import { parseRegistryDocument } from "../src/terminalRuntime/registry";

const base = {
  terminalId: "t1",
  tentacleId: "t1",
  tentacleName: "t1",
  createdAt: new Date().toISOString(),
  workspaceMode: "shared",
};
const parse = (doc: unknown) => parseRegistryDocument(JSON.stringify(doc), "test.json").terminals;

describe("registry kind round-trip", () => {
  it("round-trips kind: shell", () => {
    const t = parse({
      version: TERMINAL_REGISTRY_VERSION,
      terminals: [{ ...base, kind: "shell" }],
    }).get("t1");
    expect(t?.kind).toBe("shell");
  });
  it("defaults to undefined when absent", () => {
    const t = parse({ version: TERMINAL_REGISTRY_VERSION, terminals: [{ ...base }] }).get("t1");
    expect(t?.kind).toBeUndefined();
  });
  it("ignores a garbage kind", () => {
    const t = parse({
      version: TERMINAL_REGISTRY_VERSION,
      terminals: [{ ...base, kind: "nonsense" }],
    }).get("t1");
    expect(t?.kind).toBeUndefined();
  });
});
