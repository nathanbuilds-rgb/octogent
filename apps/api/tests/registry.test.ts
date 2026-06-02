import { describe, expect, it } from "vitest";
import { parseV3Terminals } from "../src/terminalRuntime/registry";

describe("parseV3Terminals", () => {
  it("preserves nameOrigin 'conversation' and does not coerce it to 'user'", () => {
    const registryDoc = {
      terminals: [
        {
          terminalId: "terminal-abc",
          tentacleId: "terminal-abc",
          tentacleName: "My Renamed Terminal",
          nameOrigin: "conversation",
          createdAt: "2026-01-01T00:00:00.000Z",
          workspaceMode: "shared",
        },
      ],
    };

    const result = parseV3Terminals(registryDoc, "/fake/path/tentacles.json");
    const terminal = result.get("terminal-abc");

    expect(terminal).toBeDefined();
    expect(terminal?.nameOrigin).toBe("conversation");
    // Ensure it was not silently coerced to "user" by inferTerminalNameOrigin
    expect(terminal?.nameOrigin).not.toBe("user");
    // tentacleName should be preserved as-is
    expect(terminal?.tentacleName).toBe("My Renamed Terminal");
  });

  it("preserves other valid nameOrigin values", () => {
    const registryDoc = {
      terminals: [
        {
          terminalId: "terminal-gen",
          tentacleId: "terminal-gen",
          tentacleName: "terminal-gen",
          nameOrigin: "generated",
          createdAt: "2026-01-01T00:00:00.000Z",
          workspaceMode: "shared",
        },
        {
          terminalId: "terminal-user",
          tentacleId: "terminal-user",
          tentacleName: "My Custom Name",
          nameOrigin: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
          workspaceMode: "shared",
        },
        {
          terminalId: "terminal-prompt",
          tentacleId: "terminal-prompt",
          tentacleName: "Prompt-derived Name",
          nameOrigin: "prompt",
          createdAt: "2026-01-01T00:00:00.000Z",
          workspaceMode: "shared",
        },
      ],
    };

    const result = parseV3Terminals(registryDoc, "/fake/path/tentacles.json");
    expect(result.get("terminal-gen")?.nameOrigin).toBe("generated");
    expect(result.get("terminal-user")?.nameOrigin).toBe("user");
    expect(result.get("terminal-prompt")?.nameOrigin).toBe("prompt");
  });

  it("falls back to inferTerminalNameOrigin for unknown nameOrigin values", () => {
    const registryDoc = {
      terminals: [
        {
          terminalId: "terminal-xyz",
          tentacleId: "terminal-xyz",
          tentacleName: "terminal-xyz",
          nameOrigin: "bogus-value",
          createdAt: "2026-01-01T00:00:00.000Z",
          workspaceMode: "shared",
        },
      ],
    };

    const result = parseV3Terminals(registryDoc, "/fake/path/tentacles.json");
    const terminal = result.get("terminal-xyz");
    expect(terminal).toBeDefined();
    // terminalId === tentacleName triggers "generated" from inferTerminalNameOrigin
    expect(terminal?.nameOrigin).toBe("generated");
  });
});
