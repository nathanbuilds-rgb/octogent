# Shell Terminal Tabs (Phase 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose the canvas toolbar "Terminal" button to open a plain shell terminal (no Claude) shown as VS Code-style tabs in a collapsible bottom panel of the agents/tentacles view.

**Architecture:** A terminal gains `kind: "agent" | "shell"` (default `"agent"`). A `"shell"` terminal spawns the PTY but skips the Claude bootstrap, hooks, agent-state, and usage. Shells are `workspaceMode: "shared"`, bucketed under a reserved sentinel tentacle id (`SHELL_TENTACLE_ID = "__shell__"`), excluded from the canvas graph, and rendered only in a new bottom tab panel. All backend changes in `apps/api`; the shared sentinel + `kind` type live in `packages/core`; UI in `apps/web`.

**Tech Stack:** Node 22+/TS, Vitest (api `apps/api/tests/`, web `apps/web/tests/**/*.test.tsx`), node-pty (mocked via `FakePty` with `write = vi.fn()`), React + xterm, Biome. **Run `pnpm --filter @octogent/web build` and `pnpm --filter @octogent/api build` per task — vitest/lint don't typecheck (`noUncheckedIndexedAccess` is on).**

**Branch:** `feat/shell-terminals` (off `main`; self-contained; merged into `dirty` after).

**Design doc:** `docs/superpowers/specs/2026-06-24-shell-terminal-tabs-design.md`.

---

## Verified facts (file:line — do not re-investigate)

- `createTerminal` factory: `apps/api/src/terminalRuntime.ts:389-499`, destructured options incl. `tentacleId`, `workspaceMode = "shared"`, `agentProvider`, `name`, etc.; `tentacleId = requestedTentacleId ?? terminalId` (`:443`); exposed on the runtime object (`:622`). Hook-install gate at `:475-485` (`if (terminal.agentProvider === "claude-code") { … installHooksInDirectory … }`).
- cwd resolution: `apps/api/src/terminalRuntime/worktreeManager.ts:46-57` `getTentacleWorkspaceCwd(id)` → `findTerminalForWorktree`; for `workspaceMode !== "worktree"` returns `workspaceCwd`. Shared-mode terminals (like the existing OctoBoss "Terminal" button) resolve to `workspaceCwd`.
- POST route: `apps/api/src/createApiServer/terminalRoutes.ts:63-258` (parses name/workspaceMode/agentProvider/nameOrigin via parsers; tentacleId at `:139-144`; builds `createTerminalInput` `:106-120`). Parsers in `apps/api/src/createApiServer/terminalParsers.ts` (`parseTerminalAgentProvider` `:97-131` is the convention to copy).
- `PersistedTerminal`: `apps/api/src/terminalRuntime/types.ts:120-142`. Registry parse: `parseV3Terminals` `:221-309` (optional-field copies `:266-304`); `migrateV2ToV3` `:174-219` (legacy v1/v2 — cannot carry `kind`, no change needed); `serializeTerminalRegistry` `:359-367` writes whole objects (auto-serializes new fields).
- `ensureAgentBootstrapped`: `apps/api/src/terminalRuntime/sessionRuntime.ts:468-507`; reads `const terminal = terminals.get(session.terminalId)` (`:474`) then writes `${bootstrapCommand}\r`. Test harness: `apps/api/tests/sessionRuntime.test.ts` (FakePty, `terminals`/`sessions` maps, `runtime.startSession(id)`, assert `pty.write`).
- Web create mutation: `apps/web/src/app/hooks/useTerminalMutations.ts:116-172` (`createTerminal(workspaceMode, agentProvider?, tentacleId?)`, POSTs `/api/terminals`).
- Graph build: `apps/web/src/app/hooks/useCanvasGraphData.ts` — active-terminal grouping ~`:244-251`; node loop `:265-336`; OctoBoss special handling `:338-381`. `OCTOBOSS_ID = "__octoboss__"` (`:15`).
- Canvas right-hand panel JSX: `apps/web/src/components/CanvasPrimaryView.tsx:1221-1277` (`canvas-terminals-panel`, renders `CanvasTerminalColumn` per open terminal). Toolbar "Terminal" button `:1097-1113` (`onCreateTerminal?.()` → `setPendingOpenAgentId`).
- `Terminal.tsx` props: `apps/web/src/components/Terminal.tsx:12-23` (`{ terminalId, terminalLabel?, isSelected?, onSelectTerminal?, … }`).
- UI-state persistence: `apps/web/src/app/hooks/usePersistedUiState.ts` (`canvasOpenTerminalIds`/`canvasTerminalsPanelWidth` declared `:227-233`, snapshotted `:65-119`). App wires canvas props in `App.tsx` (`onCanvasOpenTerminalIdsChange`, etc.).
- Rename backend exists on `main`: `PATCH /api/terminals/:id` → `renameTerminal` (kind-agnostic).

---

## File Structure

- **Create** `packages/core/src/domain/...` (the terminals/agent domain file): export `TerminalKind = "agent" | "shell"`, `isTerminalKind`, and `SHELL_TENTACLE_ID = "__shell__"`.
- **Modify** `apps/api/src/terminalRuntime/types.ts` — `kind?: TerminalKind` on `PersistedTerminal`.
- **Modify** `apps/api/src/terminalRuntime/registry.ts` — round-trip `kind` in `parseV3Terminals`.
- **Modify** `apps/api/src/createApiServer/terminalParsers.ts` — `parseTerminalKind`.
- **Modify** `apps/api/src/createApiServer/terminalRoutes.ts` — parse `kind`, thread into `createTerminal`.
- **Modify** `apps/api/src/terminalRuntime.ts` — `createTerminal` accepts `kind`; skip hook-install when `kind === "shell"`.
- **Modify** `apps/api/src/terminalRuntime/worktreeManager.ts` — guard: `getTentacleWorkspaceCwd(SHELL_TENTACLE_ID)` → `workspaceCwd`.
- **Modify** `apps/api/src/terminalRuntime/sessionRuntime.ts` — `ensureAgentBootstrapped` early-return for `kind === "shell"`.
- **Modify** `apps/web/src/app/hooks/useTerminalMutations.ts` — thread `kind` through `createTerminal`.
- **Modify** `apps/web/src/app/hooks/useCanvasGraphData.ts` — exclude `kind === "shell"` from nodes.
- **Modify** `apps/web/src/app/hooks/usePersistedUiState.ts` — persist shell-tab state.
- **Create** `apps/web/src/components/canvas/ShellTerminalPanel.tsx` — the bottom tab panel.
- **Modify** `apps/web/src/components/CanvasPrimaryView.tsx` — render the panel; rewire the "Terminal" button.
- **Modify** `apps/web/src/App.tsx` — wire shell create + open-tab + persisted state into the canvas props.
- **Tests**: `apps/api/tests/{registryKind,terminalKindBootstrap}.test.ts` (+ extend creation/route tests); `apps/web/tests/{ShellTerminalPanel,canvasGraphShellFilter}.test.tsx`.

---

## Task 1: `TerminalKind` + sentinel in core, `kind` on the record + registry round-trip

**Files:** `packages/core/src/domain/<terminals>.ts` (locate the file exporting `TerminalAgentProvider`), `apps/api/src/terminalRuntime/types.ts`, `apps/api/src/terminalRuntime/registry.ts`; Test: `apps/api/tests/registryKind.test.ts`.

- [ ] **Step 1: Add core types.** In the core domain file that exports `TerminalAgentProvider` (`packages/core/src/domain/agentRuntime.ts` per earlier grep — verify), add:
```ts
export type TerminalKind = "agent" | "shell";
export const isTerminalKind = (value: unknown): value is TerminalKind =>
  value === "agent" || value === "shell";
/** Reserved tentacle id bucket for workspace-level shell terminals (never a real tentacle). */
export const SHELL_TENTACLE_ID = "__shell__";
```
Confirm these are re-exported from the package entry (`packages/core/src/index.ts` or wherever `TerminalAgentProvider` is exported).

- [ ] **Step 2: Write the failing registry round-trip test.** Create `apps/api/tests/registryKind.test.ts` mirroring the structure of `apps/api/tests/` registry tests (use `parseRegistryDocument(JSON.stringify(doc), "test.json")` which returns `{ terminals, uiState }` — confirm by reading `registry.ts`):
```ts
import { describe, expect, it } from "vitest";
import { parseRegistryDocument } from "../src/terminalRuntime/registry";
import { TERMINAL_REGISTRY_VERSION } from "../src/terminalRuntime/constants";

const base = {
  terminalId: "t1", tentacleId: "t1", tentacleName: "t1",
  createdAt: new Date().toISOString(), workspaceMode: "shared",
};
const parse = (doc: unknown) =>
  parseRegistryDocument(JSON.stringify(doc), "test.json").terminals;

describe("registry kind round-trip", () => {
  it("round-trips kind: shell", () => {
    const t = parse({ version: TERMINAL_REGISTRY_VERSION, terminals: [{ ...base, kind: "shell" }] }).get("t1");
    expect(t?.kind).toBe("shell");
  });
  it("defaults to undefined (agent) when absent", () => {
    const t = parse({ version: TERMINAL_REGISTRY_VERSION, terminals: [{ ...base }] }).get("t1");
    expect(t?.kind).toBeUndefined();
  });
  it("ignores a garbage kind", () => {
    const t = parse({ version: TERMINAL_REGISTRY_VERSION, terminals: [{ ...base, kind: "nonsense" }] }).get("t1");
    expect(t?.kind).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run, verify FAIL.** `pnpm --filter @octogent/api exec vitest run tests/registryKind.test.ts` → FAIL.

- [ ] **Step 4: Add the field + round-trip.**
  - `types.ts`: add to `PersistedTerminal`: `kind?: TerminalKind;` (import `TerminalKind` from core — match how `TerminalAgentProvider` is imported there).
  - `registry.ts` `parseV3Terminals`, after the `agentProvider` copy (~`:269`): `if (isTerminalKind(entry.kind)) terminal.kind = entry.kind;` (import `isTerminalKind` from core). Leave `migrateV2ToV3` untouched (legacy v1/v2 can't carry `kind`; confirm by reading it).

- [ ] **Step 5: Run, verify PASS** (3/3) + `pnpm --filter @octogent/api build` + `pnpm lint`.

- [ ] **Step 6: Commit** `feat(core,runtime): add terminal kind (agent|shell) + shell sentinel, persisted`.

---

## Task 2: Create shell terminals — parser, route, createTerminal, hook-skip, cwd

**Files:** `terminalParsers.ts`, `terminalRoutes.ts`, `terminalRuntime.ts`, `worktreeManager.ts`; Test: extend an existing creation/route test or add `apps/api/tests/createShellTerminal.test.ts`.

- [ ] **Step 1: Write failing test.** Read how the existing API/runtime is constructed in tests (`apps/api/tests/conversationPersistence.test.ts` builds `createTerminalRuntime` with node-pty mocked; `apps/api/tests/createApiServer.test.ts` builds the server). Prefer the runtime-level test. Assert: creating a terminal with `kind: "shell"` yields a persisted record with `kind === "shell"`, `tentacleId === SHELL_TENTACLE_ID`, `workspaceMode === "shared"`, and that hooks are NOT installed (spy/mocked `hookProcessor.installHooksInDirectory` not called for the shell create; it IS called for a claude-code agent create). Example shape:
```ts
// build runtime with node-pty + ptyEnvironment mocked (copy conversationPersistence.test.ts setup),
// and a hookProcessor whose installHooksInDirectory is a vi.fn().
const snap = runtime.createTerminal({ kind: "shell", workspaceMode: "shared", tentacleId: SHELL_TENTACLE_ID });
const rec = /* read persisted record by snap.terminalId */;
expect(rec.kind).toBe("shell");
expect(installHooksSpy).not.toHaveBeenCalled();
```
> If `hookProcessor` is constructed inside `createTerminalRuntime` and not injectable, assert hook-skip indirectly: confirm no `.claude/settings.json` is written into the workspace temp dir for a shell create (the install path writes files). Choose whichever the harness allows; document it.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.**
  - `terminalParsers.ts`: add `parseTerminalKind` mirroring `parseTerminalAgentProvider` — returns `{ kind: TerminalKind | undefined, error: string | null }`; uses `isTerminalKind`; error text `"Terminal kind must be either 'agent' or 'shell'."`.
  - `terminalRoutes.ts`: after `parseTerminalAgentProvider` (~`:97`), call `parseTerminalKind`, propagate its error like the others, and add `kind` to `createTerminalInput` (~`:106-120`).
  - `terminalRuntime.ts` `createTerminal`: add `kind?: TerminalKind` to options + the typed object; set it on the `PersistedTerminal` literal (`...(kind ? { kind } : {})`). Change the hook-install gate (`:475`) to also require non-shell: `if (terminal.agentProvider === "claude-code" && terminal.kind !== "shell") { … }`. (A shell never sets `agentProvider`, but guard explicitly.)
  - `worktreeManager.ts` `getTentacleWorkspaceCwd` (`:46`): add a first-line guard `if (worktreeIdentifier === SHELL_TENTACLE_ID) return workspaceCwd;` (import `SHELL_TENTACLE_ID` from core) so a shell sentinel never hits `findTerminalForWorktree`.

- [ ] **Step 4: Run, verify PASS** + `pnpm --filter @octogent/api build` + `pnpm lint`.

- [ ] **Step 5: Commit** `feat(runtime): create kind:shell terminals (no hooks, workspace cwd)`.

---

## Task 3: Skip Claude bootstrap for shell terminals

**Files:** `apps/api/src/terminalRuntime/sessionRuntime.ts`; Test: `apps/api/tests/terminalKindBootstrap.test.ts` (or extend `sessionRuntime.test.ts`).

- [ ] **Step 1: Write failing test** (mirror `sessionRuntime.test.ts` setup — FakePty, terminals/sessions maps, `startSession`):
```ts
it("kind:shell skips bootstrap — writes no command", () => {
  // terminals: one entry { ...base, kind: "shell" } with an initialPrompt set
  // build runtime; runtime.startSession(id)
  expect(pty.write).not.toHaveBeenCalled();
});
it("kind:agent (or absent) still bootstraps", () => {
  // existing behavior: writes "claude\r" (or, if Phase 3 present, --session-id — but on this main-based branch it is "claude\r")
  expect(pty.write).toHaveBeenNthCalledWith(1, "claude\r");
});
```

- [ ] **Step 2: Run, verify the shell test FAILS** (currently writes `claude\r`).

- [ ] **Step 3: Implement.** In `ensureAgentBootstrapped`, right after `const terminal = terminals.get(session.terminalId);` (`:474`):
```ts
    if (terminal?.kind === "shell") {
      session.isBootstrapCommandSent = true;
      appendDebugLog(session, `bootstrap session=${sessionId} kind=shell (no agent)`);
      return;
    }
```
(`session.isBootstrapCommandSent` is already set above the lookup in the current code; keep it set and return before computing/writing a bootstrap command and before scheduling prompt/draft injection.)

- [ ] **Step 4: Run, verify PASS** + `pnpm --filter @octogent/api test` (full api suite) + build + lint.

- [ ] **Step 5: Commit** `feat(runtime): skip Claude bootstrap for kind:shell terminals`.

---

## Task 4: Web plumbing — mutation `kind`, graph exclusion, persisted shell-tab state

**Files:** `useTerminalMutations.ts`, `useCanvasGraphData.ts`, `usePersistedUiState.ts`; Test: `apps/web/tests/canvasGraphShellFilter.test.tsx`.

- [ ] **Step 1: Failing test for graph exclusion.** Add `apps/web/tests/canvasGraphShellFilter.test.tsx` that calls the graph-building hook/function with a terminal list containing a `kind: "shell"` terminal and asserts it produces no node for it. (Read `useCanvasGraphData.ts` for the exact exported function/hook + input shape; if it's a hook, use `@testing-library/react`'s `renderHook`, else call the pure builder directly.)

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.**
  - `useCanvasGraphData.ts`: in the active-terminal grouping (~`:244-251`), `continue` when `terminal.kind === "shell"` (and/or `terminal.tentacleId === SHELL_TENTACLE_ID`). Ensure the terminal type carries `kind` (it comes from the snapshot; confirm the snapshot includes `kind` — see Step 3b).
  - **Step 3b — snapshot carries kind:** confirm `toTerminalSnapshot` (api) includes `kind` and the web `TerminalSnapshot`/column type has `kind?: "agent"|"shell"`. If not, add it (api `toTerminalSnapshot` + the web type the snapshot maps to). The web build will tell you.
  - `useTerminalMutations.ts` `createTerminal`: add `kind?: TerminalKind` param (last, optional) and include `kind` in the POST body when provided.
  - `usePersistedUiState.ts`: add state mirroring `canvasOpenTerminalIds`:
    ```ts
    const [canvasOpenShellTabIds, setCanvasOpenShellTabIds] = useState<string[]>([]);
    const [canvasActiveShellTabId, setCanvasActiveShellTabId] = useState<string | null>(null);
    const [canvasShellPanelCollapsed, setCanvasShellPanelCollapsed] = useState(true);
    const [canvasShellPanelHeight, setCanvasShellPanelHeight] = useState<number | null>(null);
    ```
    Add them to the persisted snapshot (`:65-119`), the hydration/normalizers, and the returned object — follow `canvasOpenTerminalIds` exactly (default empty/collapsed). Keep `noUncheckedIndexedAccess` happy.

- [ ] **Step 4: Run** graph test PASS + `pnpm --filter @octogent/web build` + full web test + lint.

- [ ] **Step 5: Commit** `feat(web): kind plumbing — shell create, graph exclusion, persisted tab state`.

---

## Task 5: Bottom shell-terminal panel + rewire the "Terminal" button

**Files:** Create `apps/web/src/components/canvas/ShellTerminalPanel.tsx` (+ styles in the canvas stylesheet); Modify `CanvasPrimaryView.tsx`, `App.tsx`; Test: `apps/web/tests/ShellTerminalPanel.test.tsx`.

- [ ] **Step 1: Failing component test.** `apps/web/tests/ShellTerminalPanel.test.tsx` — render `ShellTerminalPanel` with two shell tabs and assert: a tab per terminal (by label), clicking a tab calls `onActivate`, the **+** button calls `onNewTab`, a tab's **✕** calls `onCloseTab(id)`, and the collapse chevron calls `onToggleCollapsed`. Mock the terminal body (don't mount real xterm): the panel should render the active tab's body via an injected render prop or the `Terminal` component — to keep the test light, have the panel accept a `renderBody?: (id) => ReactNode` defaulting to `<Terminal terminalId={id} .../>`, and pass a stub in the test.

- [ ] **Step 2: Run, verify FAIL** (module missing).

- [ ] **Step 3: Implement `ShellTerminalPanel.tsx`** — presentational:
```tsx
export type ShellTab = { terminalId: string; label: string };
export type ShellTerminalPanelProps = {
  tabs: ShellTab[];
  activeTabId: string | null;
  collapsed: boolean;
  onActivate: (terminalId: string) => void;
  onNewTab: () => void;
  onCloseTab: (terminalId: string) => void;
  onToggleCollapsed: () => void;
  onRenameTab?: (terminalId: string, label: string) => void;
  renderBody?: (terminalId: string) => React.ReactNode;
};
```
Render a header tab strip (`role="tablist"`), each tab a button with its label + a ✕; a **+** button (`aria-label="New terminal"`); a collapse/expand chevron (`aria-label` toggles). When not collapsed and `activeTabId` set, render `renderBody(activeTabId)`. Double-click a tab → inline `<input>` that commits via `onRenameTab` (self-contained; do not import the Phase-1 column rename). Add focused CSS to the canvas stylesheet for a bottom dock (`flex-direction: column`, fixed/resizable height, tab strip, collapsed = strip only). Keep `key` justifications for any array-index keys per Biome.

- [ ] **Step 4: Run, verify component test PASS.**

- [ ] **Step 5: Wire into the canvas + button.**
  - `CanvasPrimaryView.tsx`: accept new props (`shellTabs`, `activeShellTabId`, `shellPanelCollapsed`, `onCreateShellTab`, `onCloseShellTab`, `onActivateShellTab`, `onToggleShellPanel`, `onRenameShellTab`). Render `<ShellTerminalPanel .../>` as a bottom dock **below** the graph+terminals row (wrap the existing `canvas-graph-panel`/terminals row and the new panel in a column flex container so the dock sits under the workspace). Default `renderBody` → `<Terminal terminalId={id} terminalLabel={label} isSelected />`.
  - Rewire the toolbar "Terminal" button (`:1097-1113`): instead of `onCreateTerminal`, call a new `onCreateShellTab?.()`. (Leave `onCreateWorktreeTerminal` and tentacle buttons unchanged. Keep `onCreateTerminal` prop in the type for now but stop wiring the button to it, OR repoint it — simplest: point the button at `onCreateShellTab`.)
  - `App.tsx`: implement `onCreateShellTab` = `await createTerminal("shared", undefined, SHELL_TENTACLE_ID, "shell")` then add the returned id to `canvasOpenShellTabIds`, set it active, and expand the panel (`setCanvasShellPanelCollapsed(false)`). Implement close (kill terminal via existing delete/stop mutation + remove from the list), activate (set active id), toggle (collapsed), rename (existing `submitTerminalRename`/PATCH). Thread `shellTabs` from the columns list filtered to `kind === "shell"` mapped to `{terminalId, label: tentacleName}`. Pass all new props into `canvasPrimaryViewProps`.

- [ ] **Step 6: Verify** `pnpm --filter @octogent/web build` + full web test + `pnpm lint`.

- [ ] **Step 7: Commit** `feat(web): VS Code-style bottom shell-terminal panel; Terminal button opens a shell tab`.

---

## Task 6: Full verification + manual smoke

- [ ] **Step 1:** `pnpm build`, `pnpm --filter @octogent/api test`, `pnpm --filter @octogent/web test`, `pnpm lint` — all green.
- [ ] **Step 2 (manual, needs running build):** rebuild + relaunch octogent on Metis (detached: `nohup octogent > /tmp/octogent-metis.log 2>&1 & disown` from the Metis dir). In the UI: click "Terminal" → a bottom panel opens with a shell tab (a bare shell prompt, **no Claude**). Open a second with **+**; rename a tab (double-click); close one (✕); collapse/expand the dock. Confirm shells do NOT appear as graph nodes. Confirm an agent (tentacle "New Agent"/Worktree) still bootstraps Claude. Reload the page → tabs persist + reconnect. `cat ~/.octogent/projects/workspace-*/state/tentacles.json` → shell records have `"kind":"shell"`, `"tentacleId":"__shell__"`.
- [ ] **Step 3: Report** counts + smoke result.

---

## Self-review notes

- **Spec coverage:** kind:shell skips bootstrap (Task 3) + hooks/usage (Task 2, gate); workspace-level sentinel cwd (Task 2 guard); excluded from graph (Task 4); bottom VS Code-style tab panel collapsed-by-default (Task 5); Terminal button repurposed, Worktree/tentacle unchanged (Task 5); persists + reconnects (Task 4 state + existing reconnect); rename via existing PATCH (Task 5). Out-of-scope (worktree shells, splits, resume) untouched.
- **Type consistency:** `TerminalKind = "agent"|"shell"`, `isTerminalKind`, `SHELL_TENTACLE_ID` defined once in core, imported by api + web. `createTerminal(workspaceMode, agentProvider?, tentacleId?, kind?)` consistent across mutation/route/runtime. Snapshot carries `kind` (Task 4 Step 3b) so the graph filter and panel can read it.
- **Regression guard:** registry round-trip test (Task 1) + only `parseV3Terminals` changed (legacy `migrateV2ToV3` exempt — the Phase-1 missed-validator lesson). Existing agent bootstrap test retained (Task 3) so we prove non-shell behavior is unchanged.
- **Independence:** all on `feat/shell-terminals` off `main`; no dependency on Phase 1/2/3. Merges into `dirty` after; expect additive merge points in `sessionRuntime.ts`/`terminalRuntime.ts`/`types.ts` (resolve by keeping both, as Phase 3↔1 did).
