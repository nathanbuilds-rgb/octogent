# Resume Conversation on Re-select (Phase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a stopped claude-code agent is re-selected, resume its prior Claude conversation (`claude --resume <uuid>`) instead of spawning a fresh `claude` and re-injecting the template.

**Architecture:** Each claude-code terminal owns a `conversationId` (UUID). It is assigned lazily the first time the agent is bootstrapped, when octogent starts Claude with `claude --session-id <uuid>`. A persisted `conversationStarted` flag records that a start happened. On any later bootstrap (re-select after stop), if `conversationStarted` + a valid `conversationId` are present, octogent writes `claude --resume <uuid>` and skips prompt/template injection. All changes are server-side in `apps/api`. Persistence of the id+flag flows through a new `onConversationStarted` callback into the registry owner, mirroring the existing `onSessionStart`/`onSessionEnd` callbacks.

**Tech Stack:** Node 22+ / TypeScript, Vitest (api tests in `apps/api/tests/`), node-pty (mocked in tests via a `FakePty` whose `.write` is a `vi.fn()`). Biome lint/format.

**Branch:** `feat/resume-conversation-on-reselect` (off `main`; independent of Phase 1/2 for a clean upstream PR).

**Design doc:** `docs/superpowers/specs/2026-06-03-resume-conversation-on-reselect-design.md`. NOTE: this plan refines the spec's "assign id at creation" into "assign lazily at first bootstrap" — same outcome, one assignment site, and it subsumes the legacy-record case (a pre-existing terminal with no id simply gets one the first time it starts). Everything else matches the spec.

---

## Verified facts the implementer must rely on (do not re-investigate)

- **Bootstrap** is `ensureAgentBootstrapped(sessionId, session)` in `apps/api/src/terminalRuntime/sessionRuntime.ts:468-525`. It is guarded by `session.isBootstrapCommandSent` (per-session, in-memory). Current body: reads `terminal = terminals.get(session.terminalId)`, `provider = terminal?.agentProvider ?? DEFAULT_AGENT_PROVIDER`, writes `` `${TERMINAL_BOOTSTRAP_COMMANDS[provider] ?? TERMINAL_BOOTSTRAP_COMMANDS[DEFAULT_AGENT_PROVIDER]}\r` `` (for claude-code that string is `"claude"`), then schedules initial-prompt injection (bracketed paste + `\r`) and, separately, initial-input-draft injection.
- `TERMINAL_BOOTSTRAP_COMMANDS` (`constants.ts:9-12`) = `{ codex: "codex", "claude-code": "claude" }`. `DEFAULT_AGENT_PROVIDER = "claude-code"` (`constants.ts:7`).
- `createSessionRuntime` (`sessionRuntime.ts:61-76`) receives the **mutable** `terminals: Map<string, PersistedTerminal>` and lifecycle callbacks `onSessionStart`, `onSessionEnd` (options type at `:35-53`). It does NOT currently receive `persistRegistry`.
- In `apps/api/src/terminalRuntime.ts`, `createSessionRuntime({...})` is called at `:243-256` passing `onSessionStart: markTerminalRunning`, `onSessionEnd: markTerminalEnded`. `markTerminalRunning` (`:132-159`) mutates the record fields and calls `persistRegistry()` + `broadcastTerminalEvent` — this is the exact pattern to mirror for the new callback. `persistRegistry` is defined at `terminalRuntime.ts:96`.
- **Persistence load:** `apps/api/src/terminalRuntime/registry.ts`. The live path for current records is `parseV3Terminals` (`:221-308`); it builds `const terminal: PersistedTerminal = {...}` at `:256` then conditionally copies optional fields (e.g. `if (typeof entry.worktreeId === "string") terminal.worktreeId = entry.worktreeId;`). The other path, `migrateV2ToV3` (`:174-219`), handles legacy v1/v2 registries that predate this feature and CANNOT contain these fields — it needs **no** change (confirm, don't edit). `parseRegistryDocument` (`:311+`) dispatches by version.
- **`PersistedTerminal` type:** `apps/api/src/terminalRuntime/types.ts:120-142`. No conversation field today.
- **Test harness:** `apps/api/tests/sessionRuntime.test.ts` mocks `node-pty` (`vi.mock("node-pty", () => ({ spawn: spawnMock }))`) and `ptyEnvironment`; uses a `FakePty` whose `write = vi.fn()`; builds `terminals`/`sessions` maps; `spawnMock.mockReturnValue(pty)`; calls `runtime.startSession(tentacleId)` to trigger bootstrap; asserts e.g. `expect(pty.write).toHaveBeenNthCalledWith(1, "claude\r")` (`:321-322`). Some tests use `vi.useFakeTimers()` for prompt-injection delays.
- **CRITICAL — existing tests will break:** several assertions expect the first PTY write to be exactly `"claude\r"` for a claude-code (or provider-defaulted) terminal. After this change the first write for a fresh claude-code start becomes `claude --session-id <uuid>\r`. Every such assertion must be updated to a UUID-pattern matcher. `grep -n '"claude\\r"' apps/api/tests/sessionRuntime.test.ts` to find them all.

---

## File Structure

- **Modify** `apps/api/src/terminalRuntime/types.ts` — add `conversationId?: string` and `conversationStarted?: boolean` to `PersistedTerminal`.
- **Modify** `apps/api/src/terminalRuntime/registry.ts` — round-trip both fields in `parseV3Terminals`.
- **Modify** `apps/api/src/terminalRuntime/sessionRuntime.ts` — add `onConversationStarted?` option; rewrite the bootstrap command selection with the resume / fresh-start branch; add a `isValidConversationId` UUID guard; import `randomUUID`.
- **Modify** `apps/api/src/terminalRuntime.ts` — add `markConversationStarted` handler (mutate record + persist + broadcast) and pass it as `onConversationStarted` into `createSessionRuntime`.
- **Modify** `apps/api/tests/sessionRuntime.test.ts` — update existing `"claude\r"` assertions to the new matcher; add branch tests.
- **Create** `apps/api/tests/registryConversationFields.test.ts` — registry round-trip for the two new fields.

---

## Task 1: Persist `conversationId` + `conversationStarted` on the terminal record

**Files:**
- Modify: `apps/api/src/terminalRuntime/types.ts:120-142`
- Modify: `apps/api/src/terminalRuntime/registry.ts` (`parseV3Terminals`, ~`:256-305`)
- Test: `apps/api/tests/registryConversationFields.test.ts`

- [ ] **Step 1: Write the failing test**

First read `apps/api/src/terminalRuntime/registry.ts` to find the exported function that parses a registry document/string (likely `parseRegistryDocument` or a `readRegistry`/`loadRegistry` export) and the exact `TERMINAL_REGISTRY_VERSION` value. The test must construct a V3 registry object literal (version = current `TERMINAL_REGISTRY_VERSION`, with a `terminals` array) containing one entry that has `conversationId` + `conversationStarted`, parse it, and assert both fields survive. Adapt the construction to the actual exported parser signature. Skeleton:

```ts
import { describe, expect, it } from "vitest";
// Adjust the import to the real exported parser (read registry.ts).
import { parseRegistryDocument } from "../src/terminalRuntime/registry";
import { TERMINAL_REGISTRY_VERSION } from "../src/terminalRuntime/constants";

const baseEntry = {
  terminalId: "t1",
  tentacleId: "t1",
  tentacleName: "t1",
  createdAt: new Date().toISOString(),
  workspaceMode: "shared",
  agentProvider: "claude-code",
};

describe("registry conversation fields", () => {
  it("round-trips conversationId and conversationStarted", () => {
    const doc = {
      version: TERMINAL_REGISTRY_VERSION,
      terminals: [{ ...baseEntry, conversationId: "11111111-1111-4111-8111-111111111111", conversationStarted: true }],
      // include any other required top-level fields the parser expects (e.g. uiState) — read registry.ts
    };
    const result = parseRegistryDocument(doc as never, "test-registry.json");
    // Adapt: result may be the terminals Map directly or an object with `.terminals`.
    const terminals = result instanceof Map ? result : result.terminals;
    const t = terminals.get("t1");
    expect(t?.conversationId).toBe("11111111-1111-4111-8111-111111111111");
    expect(t?.conversationStarted).toBe(true);
  });

  it("leaves fields undefined when absent", () => {
    const doc = {
      version: TERMINAL_REGISTRY_VERSION,
      terminals: [{ ...baseEntry }],
    };
    const result = parseRegistryDocument(doc as never, "test-registry.json");
    const terminals = result instanceof Map ? result : result.terminals;
    const t = terminals.get("t1");
    expect(t?.conversationId).toBeUndefined();
    expect(t?.conversationStarted).toBeUndefined();
  });
});
```

> The implementer MUST read `registry.ts` to get: the exact exported parser name + signature, the shape it returns (Map vs wrapper object), and any required top-level document fields (e.g. `uiState`) so the literal parses. If `parseRegistryDocument` is not exported, export it, or use the public read function and write the doc to a temp file (mirror how other registry-touching tests set up, if any).

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @octogent/api exec vitest run tests/registryConversationFields.test.ts`
Expected: FAIL — fields are `undefined` (not yet parsed) / or a type error if the field isn't on `PersistedTerminal` yet.

- [ ] **Step 3: Add the fields to the type**

In `apps/api/src/terminalRuntime/types.ts`, inside `PersistedTerminal` (after `agentProvider?` / near the other optional fields), add:
```ts
  /** Stable Claude conversation id (UUID) used for --session-id / --resume. claude-code only. */
  conversationId?: string;
  /** True once the agent has been bootstrapped under conversationId (the cross-session "ran before" signal). */
  conversationStarted?: boolean;
```

- [ ] **Step 4: Round-trip them in the V3 parser**

In `apps/api/src/terminalRuntime/registry.ts`, in `parseV3Terminals`, alongside the other optional-field copies (after the `agentProvider` line ~`:269`), add:
```ts
    if (typeof entry.conversationId === "string") terminal.conversationId = entry.conversationId;
    if (entry.conversationStarted === true) terminal.conversationStarted = true;
```
Do NOT touch `migrateV2ToV3` — confirm by reading it that v1/v2 entries cannot carry these fields (they predate the feature); add a one-line comment there if helpful, but no logic.

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @octogent/api exec vitest run tests/registryConversationFields.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/terminalRuntime/types.ts apps/api/src/terminalRuntime/registry.ts apps/api/tests/registryConversationFields.test.ts
git commit -m "feat(runtime): persist conversationId + conversationStarted on terminal records"
```

---

## Task 2: Bootstrap branching — fresh `--session-id` vs `--resume`

**Files:**
- Modify: `apps/api/src/terminalRuntime/sessionRuntime.ts` (options type ~`:35-53`, destructure ~`:61-76`, `ensureAgentBootstrapped` ~`:468-525`)
- Modify: `apps/api/tests/sessionRuntime.test.ts` (update `"claude\r"` assertions; add branch tests)

- [ ] **Step 1: Add the new option (no behavior change yet)**

In `sessionRuntime.ts`:
- Add to `CreateSessionRuntimeOptions`: `onConversationStarted?: (terminalId: string, conversationId: string) => void;`
- Add `onConversationStarted` to the factory destructure.
- At the top of the file, add `import { randomUUID } from "node:crypto";` (place with the other `node:` imports).
- Add a module-level guard near the other small helpers/consts:
```ts
const CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidConversationId = (value: string | undefined): value is string =>
  typeof value === "string" && CONVERSATION_ID_RE.test(value);
```

- [ ] **Step 2: Write the failing branch tests**

In `apps/api/tests/sessionRuntime.test.ts`, FIRST run `grep -n '"claude\\r"' apps/api/tests/sessionRuntime.test.ts` and update each existing assertion that expects a fresh claude-code start to use the new matcher (keep `toHaveBeenNthCalledWith` ordering):
```ts
expect(pty.write).toHaveBeenNthCalledWith(1, expect.stringMatching(/^claude --session-id [0-9a-f-]{36}\r$/));
```
(Leave any codex-specific assertions, if present, as-is.)

Then add a new `describe` with three branch cases. Mirror the existing setup (build `terminals`/`sessions` maps, `FakePty`, `spawnMock.mockReturnValue(pty)`, `createSessionRuntime({...})`, `runtime.startSession(tentacleId)`). Use `vi.useFakeTimers()` if you assert on prompt injection.

```ts
describe("ensureAgentBootstrapped resume branching", () => {
  it("fresh start writes --session-id and acks onConversationStarted", () => {
    const onConversationStarted = vi.fn();
    // terminals: one claude-code terminal, NO conversationId, conversationStarted falsy, with an initialPrompt.
    // build runtime with onConversationStarted; startSession.
    expect(pty.write).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^claude --session-id [0-9a-f-]{36}\r$/),
    );
    expect(onConversationStarted).toHaveBeenCalledTimes(1);
    // the acked id must equal the id written
    const writtenId = (pty.write.mock.calls[0][0] as string).match(/--session-id ([0-9a-f-]{36})/)?.[1];
    expect(onConversationStarted).toHaveBeenCalledWith(tentacleId, writtenId);
  });

  it("re-select (conversationStarted + valid id) writes --resume and does NOT inject the prompt", () => {
    vi.useFakeTimers();
    const onConversationStarted = vi.fn();
    const id = "11111111-1111-4111-8111-111111111111";
    // terminals: claude-code, conversationId: id, conversationStarted: true, initialPrompt set.
    // startSession.
    expect(pty.write).toHaveBeenNthCalledWith(1, `claude --resume ${id}\r`);
    vi.advanceTimersByTime(10_000); // let any prompt timers fire
    expect(pty.write).toHaveBeenCalledTimes(1); // no bracketed-paste prompt write
    expect(onConversationStarted).not.toHaveBeenCalled();
  });

  it("codex provider is unchanged (no resume, no session-id)", () => {
    // terminals: agentProvider "codex".
    // startSession.
    expect(pty.write).toHaveBeenNthCalledWith(1, "codex\r");
  });
});
```

> The existing `initialPrompt` injection happens on a timer; for the fresh-start test you may not need fake timers if you only assert the first synchronous write. For the resume test, fake timers + `advanceTimersByTime` proves the prompt is NOT injected. Build each test's `terminals` map entry inline like the existing tests do.

- [ ] **Step 3: Run, verify the new tests fail**

Run: `pnpm --filter @octogent/api exec vitest run tests/sessionRuntime.test.ts`
Expected: the three new tests FAIL (still writes `"claude\r"`, no `--session-id`/`--resume`).

- [ ] **Step 4: Implement the branch in `ensureAgentBootstrapped`**

Replace the command-selection + write portion (the lines that compute `bootstrapCommand` and do `session.pty.write(`${bootstrapCommand}\r`)`) with the following, and gate the EXISTING prompt + input-draft injection blocks behind `if (!resuming ...)`:

```ts
    session.isBootstrapCommandSent = true;
    const terminal = terminals.get(session.terminalId);
    const provider = terminal?.agentProvider ?? DEFAULT_AGENT_PROVIDER;

    let resuming = false;
    if (provider === "claude-code" && terminal) {
      const stored = terminal.conversationId;
      if (terminal.conversationStarted && isValidConversationId(stored)) {
        appendDebugLog(session, `bootstrap session=${sessionId} resume=${stored}`);
        session.pty.write(`claude --resume ${stored}\r`);
        resuming = true;
      } else {
        const startId = isValidConversationId(stored) ? stored : randomUUID();
        appendDebugLog(session, `bootstrap session=${sessionId} session-id=${startId}`);
        session.pty.write(`claude --session-id ${startId}\r`);
        onConversationStarted?.(session.terminalId, startId);
      }
    } else {
      const bootstrapCommand =
        TERMINAL_BOOTSTRAP_COMMANDS[provider] ?? TERMINAL_BOOTSTRAP_COMMANDS[DEFAULT_AGENT_PROVIDER];
      appendDebugLog(session, `bootstrap session=${sessionId} command=${bootstrapCommand}`);
      session.pty.write(`${bootstrapCommand}\r`);
    }
```

Then change the two injection guards:
- `if (session.initialPrompt && !session.isInitialPromptSent) {` → `if (!resuming && session.initialPrompt && !session.isInitialPromptSent) {`
- `if (session.initialInputDraft && !session.isInitialInputDraftSent && !session.initialPrompt) {` → `if (!resuming && session.initialInputDraft && !session.isInitialInputDraftSent && !session.initialPrompt) {`

Rationale: resume is a pure continuation — no template, no stale draft re-injection. The `onConversationStarted` callback is optional here; Task 3 wires the real one.

- [ ] **Step 5: Run tests, verify pass + build + lint**

Run, expecting PASS:
- `pnpm --filter @octogent/api exec vitest run tests/sessionRuntime.test.ts`
- `pnpm --filter @octogent/api test` (full api suite — catches any other `"claude\r"` assertion you missed elsewhere)
- `pnpm --filter @octogent/api build`
- `pnpm lint` (run `pnpm format` then re-lint if formatting flagged)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/terminalRuntime/sessionRuntime.ts apps/api/tests/sessionRuntime.test.ts
git commit -m "feat(runtime): resume Claude conversation on re-select via --session-id/--resume"
```

---

## Task 3: Wire `onConversationStarted` to persist the id + flag

**Files:**
- Modify: `apps/api/src/terminalRuntime.ts` (add `markConversationStarted`; pass it into `createSessionRuntime` at ~`:243-256`)
- Test: extend `apps/api/tests/sessionRuntime.test.ts` OR add an integration assertion (see Step 1)

- [ ] **Step 1: Write the failing test**

The cleanest unit-level proof is at the `sessionRuntime` layer (already covered: Task 2 asserts `onConversationStarted` is called with `(terminalId, id)`). For Task 3 we verify the REAL handler mutates + persists. Add a focused test for the handler behavior. If `markConversationStarted` is internal to `createTerminalRuntime`, test it through the public runtime: build a `createTerminalRuntime` (read `terminalRuntime.ts` for its factory + required deps; there may be an existing `apps/api/tests/createApiServer.test.ts` or terminalRuntime test showing how to construct it), start a claude-code terminal, and assert the persisted record now has a `conversationId` (UUID) and `conversationStarted === true`.

If constructing the full runtime is too heavy, instead assert the wiring directly: a test that the object passed to `createSessionRuntime` includes `onConversationStarted`, and a separate unit test of the `markConversationStarted` function (export it if needed, following how the file is structured). Prefer the integration assertion if a runtime-construction harness already exists; otherwise do the unit test. Document which you chose.

```ts
// Integration sketch (adapt deps to the real createTerminalRuntime signature):
it("persists conversationId + conversationStarted after first start", async () => {
  // const runtime = createTerminalRuntime({ ...deps, spawn mocked ... });
  // create a claude-code terminal; runtime.startSession(id);
  // const record = runtime.getPersistedTerminal(id) (or read the registry map/file);
  // expect(record.conversationId).toMatch(/^[0-9a-f-]{36}$/);
  // expect(record.conversationStarted).toBe(true);
});
```

- [ ] **Step 2: Run, verify it fails**

Run the relevant test file; expected FAIL — `onConversationStarted` not wired, so the record has no `conversationId`.

- [ ] **Step 3: Implement `markConversationStarted` + wire it**

In `apps/api/src/terminalRuntime.ts`, near `markTerminalRunning` (~`:132`), add:
```ts
  const markConversationStarted = (terminalId: string, conversationId: string) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return;
    }
    // Only set once; the id is stable for the life of the terminal.
    if (terminal.conversationId === conversationId && terminal.conversationStarted) {
      return;
    }
    terminal.conversationId = conversationId;
    terminal.conversationStarted = true;
    persistRegistry();
  };
```
Then in the `createSessionRuntime({...})` call (~`:243-256`), add:
```ts
    onConversationStarted: markConversationStarted,
```
(Place it next to `onSessionStart`/`onSessionEnd`.) Do not broadcast a terminal-updated event here unless a test needs it — the id/flag are internal and not surfaced in the UI (keep the change minimal; `markTerminalRunning` already broadcasts running state separately).

- [ ] **Step 4: Run, verify pass + build + lint**

Run, expecting PASS:
- the test file from Step 1
- `pnpm --filter @octogent/api test`
- `pnpm --filter @octogent/api build`
- `pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/terminalRuntime.ts apps/api/tests/
git commit -m "feat(runtime): persist conversation id+flag on first agent bootstrap"
```

---

## Task 4: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suites + root build + lint**

Run, expecting ALL pass:
- `pnpm --filter @octogent/api test`
- `pnpm --filter @octogent/web test` (should be unaffected — no web changes)
- `pnpm build`
- `pnpm lint`

- [ ] **Step 2: Manual smoke (needs claude installed)**

1. `pnpm dev`, create a claude-code tentacle, start its agent. Confirm (via the PTY / debug log) the launch command was `claude --session-id <uuid>` and the template prompt was injected.
2. Inspect `.octogent/state/tentacles.json` → the terminal record has `conversationId` (that uuid) and `conversationStarted: true`.
3. Have the agent do something (build conversation history), then Stop it.
4. Re-select the tentacle → confirm the launch command was `claude --resume <uuid>`, the prior conversation history is present in the TUI, and the template was NOT re-injected.
5. (Optional) Repeat for a `worktree`-mode tentacle to confirm resume works from the worktree cwd.

- [ ] **Step 3: Report** test counts, build/lint status, and the smoke result (or note claude unavailability).

---

## Self-review notes

- **Spec coverage** (`2026-06-03-resume-conversation-on-reselect-design.md`):
  - caller-assigned id via `--session-id` → Task 2 (lazy at first bootstrap; refinement noted in header).
  - resume on re-select + skip template → Task 2 (the `resuming` flag gates both injection blocks).
  - `conversationId` + `conversationStarted` persisted, validated on load → Task 1.
  - "ran before" signal decoupled from Claude's storage → `conversationStarted` only; no `~/.claude` probing anywhere.
  - claude-code only; codex unchanged → Task 2 provider guard + codex test.
  - persistence via callback mirroring lifecycle handlers → Task 3 (`onConversationStarted` ↔ `markConversationStarted`, like `onSessionStart`/`markTerminalRunning`).
  - worktree: no special handling (resume by global UUID) → no code; smoke step 5 confirms.
  - vanished-session: not special-cased → no fallback code (decision 4).
  - legacy records: subsumed — a pre-existing claude-code terminal with no id hits the fresh-start branch, gets a UUID, becomes resumable going forward.
- **Type consistency:** `onConversationStarted: (terminalId: string, conversationId: string) => void` identical in the options type, the `sessionRuntime` call site, the `markConversationStarted` signature, and the Task 2 test. `isValidConversationId(value): value is string` used in both branches. `conversationId?: string` / `conversationStarted?: boolean` identical across type, parser, handler.
- **Test-vs-typecheck:** api tests run under Vitest; still run `pnpm --filter @octogent/api build` each task (tsc) — same discipline as the web gotcha.
- **Regression guard:** the registry round-trip test (Task 1) plus the explicit "don't touch migrateV2ToV3, but confirm it can't carry these fields" check prevent the Phase-1-style missed-validator bug. Only one V3 parser path builds current records; verify there isn't a second before finishing.
