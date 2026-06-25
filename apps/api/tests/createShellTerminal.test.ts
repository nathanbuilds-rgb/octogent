import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SHELL_TENTACLE_ID } from "@octogent/core";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

import { createApiServer } from "../src/createApiServer";
import type { PersistedTerminal } from "../src/terminalRuntime/types";

type RegistryDocument = {
  version: number;
  terminals: PersistedTerminal[];
};

describe("create kind:shell terminal", () => {
  let stopServer: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }

    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const startServer = async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "octogent-shell-test-"));
    temporaryDirectories.push(workspaceCwd);
    const apiServer = createApiServer({ workspaceCwd });
    const address = await apiServer.start(0, "127.0.0.1");
    stopServer = () => apiServer.stop();
    return { baseUrl: `http://${address.host}:${address.port}`, workspaceCwd };
  };

  const waitForRegistryTerminal = async (
    workspaceCwd: string,
    terminalId: string,
  ): Promise<PersistedTerminal> => {
    const registryPath = join(workspaceCwd, ".octogent", "state", "tentacles.json");
    const timeoutAt = Date.now() + 2_000;

    while (Date.now() < timeoutAt) {
      if (existsSync(registryPath)) {
        const document = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryDocument;
        const terminal = document.terminals.find((entry) => entry.terminalId === terminalId);
        if (terminal) {
          return terminal;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Timed out waiting for registry persistence at ${registryPath}`);
  };

  // The hook processor is internal to the runtime, so hook-skip is asserted via the
  // filesystem: installHooksInDirectory writes <workspaceCwd>/.claude/settings.json for
  // claude-code terminals, so a shell create must leave that file absent.
  const claudeSettingsPath = (workspaceCwd: string) =>
    join(workspaceCwd, ".claude", "settings.json");

  it("creates a kind:shell terminal at workspace level without installing hooks", async () => {
    const { baseUrl, workspaceCwd } = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "shell",
        workspaceMode: "shared",
        tentacleId: SHELL_TENTACLE_ID,
      }),
    });
    expect(createResponse.status).toBe(201);
    const snapshot = (await createResponse.json()) as { terminalId: string };

    const record = await waitForRegistryTerminal(workspaceCwd, snapshot.terminalId);
    expect(record.kind).toBe("shell");
    expect(record.tentacleId).toBe(SHELL_TENTACLE_ID);
    expect(record.workspaceMode).toBe("shared");

    expect(existsSync(claudeSettingsPath(workspaceCwd))).toBe(false);
  });

  it("installs claude hooks for a default claude-code terminal", async () => {
    const { baseUrl, workspaceCwd } = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/terminals`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agentProvider: "claude-code" }),
    });
    expect(createResponse.status).toBe(201);
    const snapshot = (await createResponse.json()) as { terminalId: string };

    const record = await waitForRegistryTerminal(workspaceCwd, snapshot.terminalId);
    expect(record.agentProvider).toBe("claude-code");
    expect(record.kind).toBeUndefined();

    expect(existsSync(claudeSettingsPath(workspaceCwd))).toBe(true);
  });
});
