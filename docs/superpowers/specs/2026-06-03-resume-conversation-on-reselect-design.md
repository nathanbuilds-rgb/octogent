# Resume Conversation on Re-select (Phase 3) — Design

**Date:** 2026-06-03
**Status:** Approved design pending spec review, pre-implementation
**Branch (planned):** `feat/resume-conversation-on-reselect` (off `main`; independent of Phase 1/2 for a clean upstream PR)
**Supersedes:** the "Phase 3 — Resume conversation on re-select (intent recorded, design pending)" stub in `2026-06-02-tentacle-ergonomics-design.md`.

## Problem

Stopping a tentacle's agent kills its PTY. Re-selecting it spawns a **fresh** `claude` and re-injects the tentacle's initial prompt/template, discarding the prior conversation. The operator loses all context built up in that session.

## Goal

When a claude-code agent that has run before is re-selected after being stopped, **resume its existing Claude conversation** instead of bootstrapping a new one — automatically, with no UI change.

## Verified facts (these ground the design; confirmed against Claude Code v2.1.161 + the octogent codebase)

- **Bootstrap is PTY-text, not a direct spawn.** A new agent is started by writing a bootstrap command into an interactive shell PTY: `ensureAgentBootstrapped` (`apps/api/src/terminalRuntime/sessionRuntime.ts:468-525`) writes `"claude\r"` (the `TERMINAL_BOOTSTRAP_COMMANDS["claude-code"]` value, `constants.ts:9-12`), then injects the initial prompt via bracketed paste + `\r`. So "resume" means writing a **different command string** (`claude --resume <id>`) and **skipping** the prompt injection.
- **No re-select path exists.** `startSession`/`ensureSession` always spawn a fresh PTY and always call `ensureAgentBootstrapped` (`sessionRuntime.ts:690,784,817`). Stop/kill tears down the PTY (`teardownSession`, `:316-379`) but the `PersistedTerminal` record survives; lifecycle is marked `"stopped"`/`"exited"` (`terminalRuntime.ts:160-186`).
- **`claude --session-id <uuid>`** starts a conversation with a caller-chosen UUID. **`claude --resume <uuid>`** relaunches the interactive TUI resumed at that conversation. Resume locates the session by **global UUID regardless of cwd**, so worktree paths are fine. The id is stable from session start. (Verified via Claude Code docs/CLI.)
- **Provider abstraction:** `agentProvider` is `"claude-code" | "codex"`; bootstrap branches only on the command string (`sessionRuntime.ts:468-480`). Hooks are installed for claude-code only (`terminalRuntime.ts:475-485`). Resume is **claude-code-only**.
- **Persistence model:** `PersistedTerminal` (`types.ts:120-142`) is stored at `.octogent/state/tentacles.json`. New optional fields follow a type-guard-on-load + fallback pattern (e.g. `nameOrigin` via `isTerminalNameOrigin`, `registry.ts`). There is **no** conversation-id field today.

## Design decisions (locked)

1. **Caller-assigned id, not hook capture.** octogent generates the conversation UUID itself and starts Claude with `--session-id <uuid>`. The currently-no-op session-start hook stays untouched. (Chosen over parsing `session_id` from a hook: deterministic, no capture race, no correlation handler.)
2. **Auto-resume only.** No "start fresh" escape hatch in this phase (YAGNI). Can be added later.
3. **Decoupled "ran before" signal.** Resume is gated on octogent's own persisted record that the agent was started under this id — never on probing Claude's internal `~/.claude/projects/...` storage.
4. **No fallback probing for a vanished session.** Since octogent only resumes when it knows the agent ran, the sole way the session is missing is external deletion of `~/.claude`; that rare case degrades to Claude's own TUI behavior. Not worth coupling to an undocumented path.

## Architecture

All changes are server-side in `apps/api`; no `apps/web` or `packages/core` change. Two pieces of new state on `PersistedTerminal`, and a branch in bootstrap.

### Data model (`apps/api/src/terminalRuntime/types.ts`)

Add to `PersistedTerminal`:
```ts
conversationId?: string;        // UUID assigned at creation; the --session-id / --resume id
conversationStarted?: boolean;  // true once the agent has been bootstrapped under conversationId
```

- `conversationId` is assigned when the terminal record is created (for claude-code terminals), using `crypto.randomUUID()`.
- `conversationStarted` flips to `true` the first time bootstrap writes the start command, and is persisted. It is the "ran before" signal.

### Creation (`apps/api/src/terminalRuntime.ts`, the `PersistedTerminal` creation site ~`:451-467`)

When building a new terminal whose `agentProvider === "claude-code"`, set `conversationId: randomUUID()`. Leave it unset for non-claude providers. (Existing records without it: see Migration.)

### Bootstrap branch (`apps/api/src/terminalRuntime/sessionRuntime.ts`, `ensureAgentBootstrapped` ~`:468-525`)

Current: always writes `claude\r` then injects the template prompt.

New logic (claude-code only; codex path unchanged):

```
provider = terminal.agentProvider ?? default
if provider != "claude-code":
    (unchanged: write TERMINAL_BOOTSTRAP_COMMANDS[provider], no resume)
else:
    id = terminal.conversationId            // always present for new claude terminals
    if terminal.conversationStarted && id:
        write `claude --resume <id>\r`       // RESUME — do NOT inject the template prompt
    else:
        if id: write `claude --session-id <id>\r`   // FRESH start with our id
        else:  write `claude\r`                      // legacy record w/o id (see Migration)
        mark terminal.conversationStarted = true; persistRegistry()
        inject the initial prompt/template (unchanged path)
```

Notes:
- The id must be shell-safe. A v4 UUID from `randomUUID()` is `[0-9a-f-]` only — no quoting needed, but the command builder will still validate it matches a UUID regex before interpolating (defensive; never write an unvalidated id into the PTY).
- `conversationStarted` is set + persisted in the fresh-start branch right after writing the command, so a crash mid-bootstrap still records that we attempted a start (accepted trade-off: a start that never produced a session degrades to Claude's TUI on the next resume).
- **Wiring for persistence:** `ensureAgentBootstrapped` lives in `sessionRuntime.ts`, but `persistRegistry` and the `terminals` registry are owned by `terminalRuntime.ts`. Mutating + persisting `conversationStarted` must go through a callback injected into the session runtime (an `onConversationStarted(terminalId)` option), exactly mirroring the existing `onTitleDetected` plumbing added in Phase 1 (`sessionRuntime` option → handler in `terminalRuntime.ts` that mutates the record + calls `persistRegistry`). The session runtime must not reach into the registry directly.
- The in-memory `session.isBootstrapCommandSent` guard is unchanged (prevents double-bootstrap within one live session); `conversationStarted` is the cross-session persisted analog.

### Persistence load (`apps/api/src/terminalRuntime/registry.ts`, the V3 parser ~`:256-305`)

Validate both new fields with the established guard+fallback pattern:
```ts
if (typeof entry.conversationId === "string") terminal.conversationId = entry.conversationId;
if (entry.conversationStarted === true) terminal.conversationStarted = true;
```
Mirror the discipline from the Phase 1 `isTerminalNameOrigin` regression: if there is more than one parser/validation path, **every** path must round-trip these fields, or a reload silently drops them and breaks resume. The plan must check for duplicate validators.

## Migration / backward compatibility

Existing `tentacles.json` records have neither field. Handling:
- A legacy claude-code terminal with **no** `conversationId`: on bootstrap it hits the `write claude\r` legacy branch (fresh, no id) — i.e. **current behavior**, no regression. It cannot be resumed (it never had an id), which is correct: we have no id for its past conversation.
- Optionally, when such a legacy terminal is first bootstrapped after upgrade, assign it a fresh `conversationId` + `--session-id` so it becomes resumable **going forward**. (Recommended; low cost. The plan will include this.)
- No file-format version bump is required; the fields are additive and optional.

## Data flow

- **Create (claude-code):** new tentacle → `PersistedTerminal { conversationId: uuid }` persisted.
- **First start:** re-select/open → `ensureSession` spawns PTY → `ensureAgentBootstrapped` sees `conversationStarted` falsy → writes `claude --session-id <uuid>`, sets `conversationStarted=true`, persists, injects template.
- **Stop:** `teardownSession` kills PTY; record (incl. `conversationId`, `conversationStarted`) persists; lifecycle → `stopped`.
- **Re-select:** `ensureSession` spawns fresh PTY → `ensureAgentBootstrapped` sees `conversationStarted=true` + `conversationId` → writes `claude --resume <uuid>`, **no template** → Claude TUI resumes prior conversation.

## Error handling / edge cases

- **Vanished session** (`~/.claude` wiped externally): `claude --resume <uuid>` lands in Claude's own error/picker TUI. Accepted; not specially handled (decision 4).
- **Non-UUID / corrupt stored id:** the UUID-regex validation in the command builder rejects it; fall through to the legacy `claude\r` fresh path rather than writing a malformed command. (Defensive.)
- **codex provider:** entirely unchanged; never gets `conversationId`/resume.
- **Worktree mode:** resume is by global UUID, cwd-independent; the PTY still launches in the tentacle's worktree cwd as today. No special handling. (If the worktree was removed while stopped, that's a pre-existing concern orthogonal to resume.)
- **Parent/child (swarm) terminals:** each terminal record gets its own `conversationId`; resume is per-terminal. No cross-terminal coupling.

## Testing

Unit / integration (api), following existing `apps/api/tests/` conventions:
- **Bootstrap branching (the core):** with a fake PTY capturing writes —
  - claude-code, `conversationStarted` falsy + `conversationId` set → writes `claude --session-id <uuid>` AND injects the template.
  - claude-code, `conversationStarted` true + `conversationId` set → writes `claude --resume <uuid>` AND does NOT inject the template.
  - claude-code, legacy (no `conversationId`) → writes `claude\r` (current behavior).
  - codex → unchanged command, never resume.
- **conversationStarted persistence:** first bootstrap sets it true and persists; a reload via the registry parser round-trips `conversationId` + `conversationStarted` (regression guard against a missed validator — the Phase 1 lesson).
- **Creation:** a new claude-code `PersistedTerminal` gets a UUID `conversationId`; codex does not.
- **UUID validation:** a corrupt stored id does not get written into the PTY (falls back).

Manual smoke: create a claude-code tentacle → start it (verify `claude --session-id …` ran) → do some work → stop → re-select → confirm the prior conversation resumes (TUI shows history) and the template is NOT re-injected.

## Architecture boundaries

- All logic in `apps/api` (infrastructure: PTY/runtime/persistence). No `packages/core` or `apps/web` changes. Bootstrap orchestration stays in `sessionRuntime`; persistence in `registry`; matches CLAUDE.md boundaries.

## Out of scope

- "Start fresh" / fork control (deferred; decision 2).
- Resuming codex or any non-claude provider.
- Any UI affordance (re-select already triggers the start path).
- Pre-validating/repairing Claude's on-disk session store.
