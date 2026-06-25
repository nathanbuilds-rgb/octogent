import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OCTOBOSS_ID, useCanvasGraphData } from "../src/app/hooks/useCanvasGraphData";
import type { TerminalView } from "../src/app/types";

const SHELL_TENTACLE_ID = "__shell__";

const agentTerminal = {
  terminalId: "terminal-agent",
  label: "terminal-agent",
  state: "live" as const,
  tentacleId: "tentacle-a",
  tentacleName: "tentacle-a",
  kind: "agent" as const,
  workspaceMode: "shared" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const shellTerminalUnderBoss = {
  terminalId: "terminal-shell-boss",
  label: "terminal-shell-boss",
  state: "live" as const,
  tentacleId: OCTOBOSS_ID,
  tentacleName: "shell",
  kind: "shell" as const,
  workspaceMode: "shared" as const,
  createdAt: "2026-01-01T00:00:01.000Z",
};

const shellTerminalUnderReserved = {
  terminalId: "terminal-shell-reserved",
  label: "terminal-shell-reserved",
  state: "live" as const,
  tentacleId: SHELL_TENTACLE_ID,
  tentacleName: "shell",
  kind: "shell" as const,
  workspaceMode: "shared" as const,
  createdAt: "2026-01-01T00:00:02.000Z",
};

const columns: TerminalView = [agentTerminal, shellTerminalUnderBoss, shellTerminalUnderReserved];

const deckTentacles = [{ tentacleId: "tentacle-a", displayName: "tentacle-a" }];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = url.includes("deck") ? deckTentacles : [];
      return {
        ok: true,
        json: async () => body,
      } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCanvasGraphData shell terminal exclusion", () => {
  it("excludes shell terminals from graph nodes", async () => {
    const { result } = renderHook(() => useCanvasGraphData({ columns, enabled: true }));

    await waitFor(() => {
      expect(result.current.nodes.some((node) => node.tentacleId === "tentacle-a")).toBe(true);
    });

    const nodes = result.current.nodes;

    // The agent's tentacle is present.
    expect(nodes.some((node) => node.id === "t:tentacle-a")).toBe(true);

    // No node references the reserved shell tentacle.
    expect(nodes.some((node) => node.tentacleId === SHELL_TENTACLE_ID)).toBe(false);
    expect(nodes.some((node) => node.id.includes(SHELL_TENTACLE_ID))).toBe(false);

    // No active-session node was created for either shell terminal.
    expect(nodes.some((node) => node.sessionId === shellTerminalUnderBoss.terminalId)).toBe(false);
    expect(nodes.some((node) => node.sessionId === shellTerminalUnderReserved.terminalId)).toBe(
      false,
    );
  });
});
