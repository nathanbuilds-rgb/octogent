# Shell Terminal Tabs (VS Code-style) — Design

**Date:** 2026-06-24
**Status:** Approved design pending spec review, pre-implementation
**Branch:** `feat/shell-terminals` (off `main`; self-contained for a clean upstream PR; merged into `dirty` afterward)

## Problem

The canvas/agents toolbar "Terminal" button creates a **Claude agent** under OctoBoss (`onCreateTerminal` → `createTerminal("shared", undefined, OCTOBOSS_ID)` → `ensureAgentBootstrapped` writes `claude\r`), rendered as a graph node/column. There is no way to open a **plain shell** — just a terminal — and the agent-node presentation is the wrong mental model for "I want a terminal."

## Goal

Repurpose the toolbar "Terminal" button to open a **plain shell terminal** (no Claude, no agent) presented as **VS Code-style tabs in a bottom panel** of the agents/tentacles view. Plain terminals are workspace-level, not agents, and never appear in the canvas graph. Claude-agent creation stays available via tentacle "New Agent" affordances and the "Worktree" button (unchanged).

## Verified facts (ground truth from the codebase, branch base = `main`)

- **Bootstrap is opt-in PTY text.** The PTY always spawns the user's interactive shell (`getShellLaunch()` → e.g. `/bin/bash -i`, `sessionRuntime.ts`). `ensureAgentBootstrapped` is what turns it into an agent by writing `claude\r` (per `TERMINAL_BOOTSTRAP_COMMANDS[provider]`). **A plain shell = spawn the PTY and simply do NOT bootstrap.** No new spawning logic is needed.
- **Provider set:** `TerminalAgentProvider = "codex" | "claude-code"` (`packages/core/src/domain/agentRuntime.ts:13`). Hooks are installed for `claude-code` only (`terminalRuntime.ts`). Agent-runtime state + usage telemetry key off agents.
- **Creation:** `POST /api/terminals` parses `{ name?, workspaceMode, agentProvider?, tentacleId? }` (`terminalRoutes.ts`, `terminalParsers.ts`). `createTerminal` builds a `PersistedTerminal` (`terminalRuntime.ts`), persisted to `.octogent/state/tentacles.json`.
- **Canvas graph** (`useCanvasGraphData.ts`) builds nodes by grouping terminals/sessions by `tentacleId`; `OCTOBOSS_ID = "__octoboss__"`. Open terminals render as **side-by-side columns** in a right-hand `canvas-terminals-panel` (`CanvasPrimaryView.tsx:1235`), keyed by `canvasOpenTerminalIds`; widths persist via `canvasTerminalsPanelWidth` (UI state in `usePersistedUiState`).
- **Terminal rendering:** `apps/web/src/components/Terminal.tsx` is the xterm view (`<Terminal terminalId=... terminalLabel=... />`), reusable for tab bodies.
- **Rename backend already exists on `main`:** `renameTerminal` + `PATCH /api/terminals/:id`. Tab rename can call it directly — no dependency on the (separate-branch) Phase 1 rename UI.
- **Toolbar button:** `CanvasPrimaryView.tsx:1097-1113` — the "Terminal" button calls `onCreateTerminal?.()` then `setPendingOpenAgentId`.

## Design

### 1. Backend: a non-agent terminal `kind`

Add a terminal **`kind`**: `"agent" | "shell"`, default `"agent"`. (Chosen over overloading `agentProvider` with a fake `"shell"` value: `kind` reads truthfully and keeps `agentProvider` meaning "which agent CLI".)

- `PersistedTerminal` gains `kind?: "agent" | "shell"` (absent/unknown ⇒ treated as `"agent"`, so all existing records are unaffected). Validated on registry load with a guard+fallback (the established pattern), in **every** parser path that builds a record (the Phase-1 missed-validator lesson — there are two parse paths in `registry.ts`).
- `ensureAgentBootstrapped`: if the terminal's `kind === "shell"`, **return immediately after marking bootstrap "sent"** — write no bootstrap command, schedule no prompt/draft injection. The bare interactive shell from the PTY spawn is the result.
- **Skip agent-only machinery for shells:** do not install hooks (already gated to `claude-code`; shells won't be `claude-code`, but assert the gate also excludes shells), no agent-runtime state transitions, no usage telemetry.
- `POST /api/terminals`: parse an optional `kind` (default `"agent"`); a shell request also implies no `agentProvider` and no hook install. Shell terminals are **workspace-level**: `workspaceMode: "shared"`, cwd = workspace root. They are stored under a dedicated sentinel tentacle id (e.g. `"__shell__"`) — NOT `OCTOBOSS_ID` and not a real tentacle — so the graph builder can exclude them cleanly and they never imply an agent node. (Exact sentinel naming finalized in the plan; the contract is "a reserved id that the graph ignores.")

### 2. Frontend: VS Code-style bottom terminal panel

- A new **bottom dock** spanning the agents/tentacles view: a **tab strip** (one tab per shell terminal) + active tab body (reusing `Terminal.tsx`), a **+** button to open another shell, per-tab **✕** to close, and a **chevron to collapse/expand** the whole panel.
- **Collapsed by default**; opens automatically when the first shell is created (toolbar "Terminal" button) and when + is used.
- **Tabs are the shell terminals** (`kind: "shell"`), distinct from the existing right-hand agent-terminal columns. Open-tab ids + active-tab id + panel height/collapsed state persist in UI state (mirroring how `canvasOpenTerminalIds` / `canvasTerminalsPanelWidth` already persist).
- **Naming:** auto-name `Terminal 1`, `Terminal 2`, … Double-click a tab to rename inline; commit via the existing `PATCH /api/terminals/:id`. (Self-contained inline-edit on the tab; does not reuse the Phase-1 column-rename component.)
- **Toolbar "Terminal" button** now: create a `kind: "shell"` terminal, open it as a tab, expand the panel. (Worktree + tentacle buttons unchanged.)
- **Graph exclusion:** `useCanvasGraphData` filters out `kind === "shell"` (and the `__shell__` sentinel), so shells never become nodes/columns.

### 3. Lifecycle / persistence

- Shell terminal records persist in `tentacles.json`; on app reload the tabs reappear and reconnect to the live PTY (same reconnect path as agent terminals).
- On full server restart the PTY is gone; re-selecting/reopening a shell tab **respawns a fresh shell** (no resume — Phase 3's `--resume` logic is agent-only and `kind: "shell"` never triggers bootstrap, so it's untouched).
- Closing a tab kills its PTY (existing close/kill path) and removes it from the persisted open-tab list.

## Data flow

- **Create:** toolbar "Terminal" / panel "+" → `POST /api/terminals { kind: "shell", workspaceMode: "shared" }` → `createTerminal` writes a `kind:"shell"` record (sentinel tentacle, no hooks) → PTY spawns shell, **no bootstrap** → UI adds a tab + expands the panel.
- **Render:** bottom panel lists `kind:"shell"` terminals as tabs; active tab renders `<Terminal terminalId=… />`. Graph + right-hand agent panel ignore shells.
- **Reconnect (reload):** persisted open-tab ids → reconnect to live PTYs. **Restart:** respawn shell on reopen.

## Error handling / edge cases

- Legacy records (no `kind`) ⇒ `"agent"`; zero behavior change for existing terminals/agents.
- A shell terminal must never install hooks, never bootstrap, never appear as a graph node, never get agent-runtime state, never count toward Claude/Codex usage.
- `PATCH /api/terminals/:id` rename works for shells (backend is kind-agnostic).
- Sentinel tentacle id is reserved: tentacle creation/deck flows must not collide with it (it's not a real tentacle folder).

## Testing

**API (`apps/api/tests/`):**
- `ensureAgentBootstrapped` with `kind: "shell"` writes **no** command to the PTY and schedules no prompt (fake-PTY `write` asserted not called with `claude…`); with `kind: "agent"` (or absent) behaves as today.
- `POST /api/terminals { kind: "shell" }` creates a record with `kind:"shell"`, no hook install (assert the hook-install path not taken), sentinel tentacle id.
- Registry round-trips `kind` on load (both parser paths); absent ⇒ `"agent"`.

**Web (`apps/web/tests/`):**
- Bottom panel: renders a tab per shell terminal; **+** triggers create; **✕** closes; collapse/expand toggles; clicking a tab activates it.
- `useCanvasGraphData` excludes `kind:"shell"` terminals from nodes.
- Toolbar "Terminal" button issues a `kind:"shell"` create and opens/expands the panel.
- Build discipline: run `pnpm --filter @octogent/web build` (tsc) — vitest/lint don't typecheck.

## Architecture boundaries

- Non-agent terminal model + bootstrap skip live in `apps/api` (runtime/persistence). `kind` is a plain string union — minimal `packages/core` addition if the type is shared there. Bottom-panel UI lives in `apps/web`. Orchestration stays thin.

## Out of scope

- Worktree shells (Worktree button stays a Claude agent).
- Any resume/session behavior for shells (agent-only).
- Splitting/group layouts within the panel (VS Code split terminals) — single active tab body for now.
- Reordering tabs by drag (later, if wanted).
