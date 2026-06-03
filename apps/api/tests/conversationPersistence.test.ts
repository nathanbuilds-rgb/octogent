import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/terminalRuntime/ptyEnvironment", () => ({
  createShellEnvironment: vi.fn(() => ({})),
  ensureNodePtySpawnHelperExecutable: vi.fn(),
}));

import { createTerminalRuntime } from "../src/terminalRuntime";
import type { GitClient } from "../src/terminalRuntime";

class FakePty extends EventEmitter {
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();

  onData(listener: (chunk: string) => void) {
    this.on("data", listener);
    return {
      dispose: () => {
        this.off("data", listener);
      },
    };
  }

  onExit(listener: (event: { exitCode: number; signal: number }) => void) {
    this.on("exit", listener);
    return {
      dispose: () => {
        this.off("exit", listener);
      },
    };
  }
}

const stubGitClient: GitClient = {
  assertAvailable() {},
  isRepository() {
    return false;
  },
} as unknown as GitClient;

const readPersistedTerminals = (stateDir: string): Record<string, unknown>[] => {
  const registryPath = join(stateDir, "state", "tentacles.json");
  const document = JSON.parse(readFileSync(registryPath, "utf8")) as {
    terminals: Record<string, unknown>[];
  };
  return document.terminals;
};

describe("conversation persistence", () => {
  const temporaryDirectories: string[] = [];

  const createTemporaryDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), "octogent-conversation-persistence-test-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  it("persists the conversation id and started flag on first claude-code bootstrap", async () => {
    const workspaceCwd = createTemporaryDirectory();
    const projectStateDir = createTemporaryDirectory();
    const pty = new FakePty();
    spawnMock.mockReturnValue(pty);

    const runtime = createTerminalRuntime({
      workspaceCwd,
      projectStateDir,
      gitClient: stubGitClient,
    });

    const snapshot = runtime.createTerminal({
      agentProvider: "claude-code",
      initialPrompt: "Investigate and report back.",
    });

    await runtime.close();

    const persisted = readPersistedTerminals(projectStateDir).find(
      (terminal) => terminal.terminalId === snapshot.terminalId,
    );

    expect(persisted?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(persisted?.conversationStarted).toBe(true);
  });
});
