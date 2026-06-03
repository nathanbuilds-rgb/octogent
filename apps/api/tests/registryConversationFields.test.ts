import { describe, expect, it } from "vitest";
import { TERMINAL_REGISTRY_VERSION } from "../src/terminalRuntime/constants";
import { parseRegistryDocument } from "../src/terminalRuntime/registry";

const baseEntry = {
  terminalId: "t1",
  tentacleId: "t1",
  tentacleName: "t1",
  createdAt: new Date().toISOString(),
  workspaceMode: "shared",
  agentProvider: "claude-code",
};

const parseTerminals = (doc: unknown) =>
  parseRegistryDocument(JSON.stringify(doc), "test-registry.json").terminals;

describe("registry conversation fields", () => {
  it("round-trips conversationId and conversationStarted", () => {
    const terminals = parseTerminals({
      version: TERMINAL_REGISTRY_VERSION,
      terminals: [
        {
          ...baseEntry,
          conversationId: "11111111-1111-4111-8111-111111111111",
          conversationStarted: true,
        },
      ],
    });
    const t = terminals.get("t1");
    expect(t?.conversationId).toBe("11111111-1111-4111-8111-111111111111");
    expect(t?.conversationStarted).toBe(true);
  });

  it("leaves fields undefined when absent", () => {
    const terminals = parseTerminals({
      version: TERMINAL_REGISTRY_VERSION,
      terminals: [{ ...baseEntry }],
    });
    const t = terminals.get("t1");
    expect(t?.conversationId).toBeUndefined();
    expect(t?.conversationStarted).toBeUndefined();
  });
});
