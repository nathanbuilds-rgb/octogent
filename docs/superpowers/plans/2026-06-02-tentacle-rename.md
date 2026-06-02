# Tentacle Rename Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators rename a running agent tentacle inline in the UI, and auto-sync the tentacle title from the agent's live conversation name when it hasn't been manually renamed.

**Architecture:** The rename backend (`PATCH /api/terminals/:id` → `renameTerminal`) and the web rename state machine (`useTerminalMutations`) already exist but are unrendered. Phase 1a wires the existing hook into the canvas column header as an inline-editable title. Phase 1b adds an OSC terminal-title parser to the PTY data stream in `sessionRuntime`; when a real conversation title appears and the terminal's `nameOrigin !== "user"`, it updates the name (origin `"conversation"`), persists, and reuses the existing `rename` WS message + `terminal-updated` broadcast that the client already handles.

**Tech Stack:** TypeScript, Node HTTP/WS server (`apps/api`), Vite + React (`apps/web`), Vitest, Biome.

**Precedence rule (used throughout):** `user` > `conversation` > `prompt` > `generated`. A manual rename sets `user` and is never overwritten by auto-sync.

**Verify commands:** API tests `pnpm --filter @octogent/api test`; web tests `pnpm --filter @octogent/web test`; lint `pnpm lint`.

---

## Task 1: Add `"conversation"` to `TerminalNameOrigin`

**Files:**
- Modify: `apps/api/src/terminalRuntime/types.ts:88`
- Modify: `apps/api/src/createApiServer/terminalParsers.ts:8`
- Test: `apps/api/src/createApiServer/terminalParsers.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `apps/api/src/createApiServer/terminalParsers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTerminalNameOrigin } from "./terminalParsers";

describe("parseTerminalNameOrigin", () => {
  it("accepts the conversation origin", () => {
    expect(parseTerminalNameOrigin({ nameOrigin: "conversation" })).toEqual({
      nameOrigin: "conversation",
    });
  });

  it("ignores unknown origins", () => {
    expect(parseTerminalNameOrigin({ nameOrigin: "bogus" })).toEqual({
      nameOrigin: undefined,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @octogent/api exec vitest run src/createApiServer/terminalParsers.test.ts`
Expected: FAIL — `"conversation"` rejected (returns `undefined`).

- [ ] **Step 3: Add the union member**

In `apps/api/src/terminalRuntime/types.ts:88` change:

```ts
export type TerminalNameOrigin = "generated" | "user" | "prompt";
```
to:
```ts
export type TerminalNameOrigin = "generated" | "user" | "prompt" | "conversation";
```

In `apps/api/src/createApiServer/terminalParsers.ts:8`, the validator currently reads (confirm and extend the allowed set):

```ts
const isTerminalNameOrigin = (value: unknown): value is TerminalNameOrigin =>
  value === "generated" || value === "user" || value === "prompt";
```
Change the final clause to also allow `"conversation"`:
```ts
const isTerminalNameOrigin = (value: unknown): value is TerminalNameOrigin =>
  value === "generated" || value === "user" || value === "prompt" || value === "conversation";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @octogent/api exec vitest run src/createApiServer/terminalParsers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/terminalRuntime/types.ts apps/api/src/createApiServer/terminalParsers.ts apps/api/src/createApiServer/terminalParsers.test.ts
git commit -m "feat(rename): add 'conversation' terminal name origin"
```

---

## Task 2: OSC terminal-title parser + noise filter + apply rule (pure module)

This is the unit-testable core of auto-sync: extract title strings from raw PTY bytes, decide whether a title is a meaningful conversation name, and decide whether/how to apply it given the current name + origin.

**Files:**
- Create: `apps/api/src/terminalRuntime/terminalTitle.ts`
- Test: `apps/api/src/terminalRuntime/terminalTitle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/terminalRuntime/terminalTitle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyDetectedTitle,
  createTitleScanner,
  isMeaningfulConversationTitle,
} from "./terminalTitle";

const BEL = "\x07";
const ESC = "\x1b";

describe("createTitleScanner", () => {
  it("extracts an OSC 2 title terminated by BEL", () => {
    const scan = createTitleScanner();
    expect(scan(`${ESC}]2;Refactor auth flow${BEL}`)).toEqual(["Refactor auth flow"]);
  });

  it("extracts an OSC 0 title terminated by ST (ESC \\)", () => {
    const scan = createTitleScanner();
    expect(scan(`${ESC}]0;Fix websocket leak${ESC}\\`)).toEqual(["Fix websocket leak"]);
  });

  it("reassembles a title split across two chunks", () => {
    const scan = createTitleScanner();
    expect(scan(`${ESC}]2;Refactor `)).toEqual([]);
    expect(scan(`auth flow${BEL}`)).toEqual(["Refactor auth flow"]);
  });

  it("ignores ordinary output with no title sequence", () => {
    const scan = createTitleScanner();
    expect(scan("just some shell output\r\n")).toEqual([]);
  });

  it("does not throw on a malformed/never-terminated sequence", () => {
    const scan = createTitleScanner();
    expect(() => scan(`${ESC}]2;unterminated`)).not.toThrow();
    expect(scan(`${ESC}]2;unterminated`)).toEqual([]);
  });
});

describe("isMeaningfulConversationTitle", () => {
  it("rejects bare shell/program names and paths", () => {
    for (const noise of ["", "claude", "zsh", "-zsh", "bash", "node", "/Users/x/dev/proj", "~/dev"]) {
      expect(isMeaningfulConversationTitle(noise)).toBe(false);
    }
  });

  it("accepts a real conversation topic", () => {
    expect(isMeaningfulConversationTitle("Refactor auth flow")).toBe(true);
  });
});

describe("applyDetectedTitle", () => {
  it("updates when origin is not user and the title is new", () => {
    expect(
      applyDetectedTitle({ currentName: "Octogent Terminal 1", origin: "generated", title: "Refactor auth flow" }),
    ).toEqual({ changed: true, name: "Refactor auth flow", origin: "conversation" });
  });

  it("never overrides a user-set name", () => {
    expect(
      applyDetectedTitle({ currentName: "My name", origin: "user", title: "Refactor auth flow" }),
    ).toEqual({ changed: false });
  });

  it("ignores noise titles and no-op titles", () => {
    expect(applyDetectedTitle({ currentName: "x", origin: "prompt", title: "zsh" })).toEqual({ changed: false });
    expect(applyDetectedTitle({ currentName: "Same", origin: "prompt", title: "Same" })).toEqual({ changed: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @octogent/api exec vitest run src/terminalRuntime/terminalTitle.test.ts`
Expected: FAIL — module `./terminalTitle` not found.

- [ ] **Step 3: Implement the module**

Create `apps/api/src/terminalRuntime/terminalTitle.ts`:

```ts
import type { TerminalNameOrigin } from "./types";

const BEL = "\x07";
const ESC = "\x1b";
// OSC title set: ESC ] (0|1|2) ; <title> (BEL | ESC \)
const OSC_TITLE_RE = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const MAX_CARRY = 4096; // cap the cross-chunk buffer so a runaway stream can't grow unbounded

/**
 * Stateful scanner that extracts terminal-title strings (OSC 0/1/2) from a PTY
 * byte stream. Handles sequences split across chunks by carrying an unterminated
 * tail. Never throws.
 */
export const createTitleScanner = (): ((chunk: string) => string[]) => {
  let carry = "";
  return (chunk: string): string[] => {
    const buffer = carry + chunk;
    const titles: string[] = [];
    OSC_TITLE_RE.lastIndex = 0;
    let lastEnd = 0;
    let match: RegExpExecArray | null;
    while ((match = OSC_TITLE_RE.exec(buffer)) !== null) {
      titles.push(match[1] ?? "");
      lastEnd = OSC_TITLE_RE.lastIndex;
    }
    // Keep any trailing partial title-open sequence for the next chunk.
    const lastOpen = buffer.lastIndexOf(`${ESC}]`);
    if (lastOpen >= lastEnd) {
      carry = buffer.slice(lastOpen).slice(0, MAX_CARRY);
    } else {
      carry = "";
    }
    return titles;
  };
};

const NOISE_NAMES = new Set([
  "",
  "claude",
  "zsh",
  "-zsh",
  "bash",
  "-bash",
  "sh",
  "fish",
  "node",
]);

/**
 * Heuristic: is this terminal title a real conversation topic worth adopting as
 * the tentacle name, vs. shell/program noise or a path?
 *
 * NOTE: tune against a captured live Claude session before finalizing. If Claude
 * does not emit a useful topic title, auto-sync (1b) is dropped and manual rename
 * (1a) still ships.
 */
export const isMeaningfulConversationTitle = (title: string): boolean => {
  const trimmed = title.trim();
  if (trimmed.length < 2) return false;
  if (NOISE_NAMES.has(trimmed.toLowerCase())) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) return false; // a path
  return true;
};

export type ApplyDetectedTitleInput = {
  currentName: string;
  origin: TerminalNameOrigin | undefined;
  title: string;
};

export type ApplyDetectedTitleResult =
  | { changed: false }
  | { changed: true; name: string; origin: TerminalNameOrigin };

/** Decide whether a detected title should replace the current tentacle name. */
export const applyDetectedTitle = ({
  currentName,
  origin,
  title,
}: ApplyDetectedTitleInput): ApplyDetectedTitleResult => {
  if (origin === "user") return { changed: false };
  const cleaned = title.trim();
  if (!isMeaningfulConversationTitle(cleaned)) return { changed: false };
  if (cleaned === currentName) return { changed: false };
  return { changed: true, name: cleaned, origin: "conversation" };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @octogent/api exec vitest run src/terminalRuntime/terminalTitle.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/terminalRuntime/terminalTitle.ts apps/api/src/terminalRuntime/terminalTitle.test.ts
git commit -m "feat(rename): OSC terminal-title parser + apply rule"
```

---

## Task 3: Wire title detection into the PTY stream + registry update

Feed PTY output through the scanner, and when a title should be applied, broadcast the existing `rename` WS message (for the live terminal client) and call a new `onTitleDetected` callback (for registry persistence + `terminal-updated`).

**Files:**
- Modify: `apps/api/src/terminalRuntime/sessionRuntime.ts` (options type ~line 50; session type add scanner; `onData` handler ~line 605)
- Modify: `apps/api/src/terminalRuntime/types.ts` (`TerminalSession` — add `titleScanner`)
- Modify: `apps/api/src/terminalRuntime.ts` (construct `sessionRuntime` with `onTitleDetected`; ~line 270)

- [ ] **Step 1: Add `titleScanner` to the session type**

In `apps/api/src/terminalRuntime/types.ts`, in the `TerminalSession` type, add:

```ts
  titleScanner?: (chunk: string) => string[];
```

- [ ] **Step 2: Add the `onTitleDetected` option**

In `apps/api/src/terminalRuntime/sessionRuntime.ts`, in `CreateSessionRuntimeOptions` (the block around line 50 that lists `onStateChange`, `onSessionStart`, `onSessionEnd`), add:

```ts
  onTitleDetected?: (terminalId: string, title: string) => void;
```
and add `onTitleDetected` to the destructured params in `createSessionRuntime({ ... })` (alongside `onStateChange`).

- [ ] **Step 3: Initialize the scanner and parse titles in `onData`**

In `ensureSession`, where the session object is built (around line 567), import the scanner at the top of the file:

```ts
import { applyDetectedTitle, createTitleScanner } from "./terminalTitle";
```
Set it on the session right after creation (near `session.transcriptLog = transcriptLog;`, ~line 588):

```ts
session.titleScanner = createTitleScanner();
```
Then inside the existing `session.pty.onData((chunk) => { ... })` handler (line 605), after `appendScrollback(session, chunk);` add:

```ts
      const detectedTitles = session.titleScanner?.(chunk) ?? [];
      for (const title of detectedTitles) {
        const decision = applyDetectedTitle({
          currentName: terminals.get(sessionId)?.tentacleName ?? "",
          origin: terminals.get(sessionId)?.nameOrigin,
          title,
        });
        if (decision.changed) {
          broadcastMessage(session, { type: "rename", tentacleName: decision.name });
          onTitleDetected?.(sessionId, decision.name);
        }
      }
```

(`terminals` is already available in `createSessionRuntime` options; `broadcastMessage` is already imported.)

- [ ] **Step 4: Implement `onTitleDetected` in the runtime**

In `apps/api/src/terminalRuntime.ts`, find the `createSessionRuntime({ ... })` call (~line 270, where `onStateChange`/`onSessionStart`/`onSessionEnd` are passed). Add:

```ts
    onTitleDetected: (terminalId, title) => {
      const terminal = terminals.get(terminalId);
      if (!terminal || terminal.nameOrigin === "user") {
        return;
      }
      if (terminal.tentacleName === title) {
        return;
      }
      terminal.tentacleName = title;
      terminal.nameOrigin = "conversation";
      persistRegistry();
      broadcastTerminalEvent({
        type: "terminal-updated",
        snapshot: toTerminalSnapshot(terminal),
      });
    },
```

(`terminals`, `persistRegistry`, `broadcastTerminalEvent`, and `toTerminalSnapshot` are all in scope here — `renameTerminal` at line 624 uses the same set.)

- [ ] **Step 5: Add a focused unit test for the runtime handler**

The full PTY path is integration-heavy; the decision logic is already covered by Task 2. Add one test that the runtime updates the registry record and respects `user` origin. Create `apps/api/src/terminalRuntime/onTitleDetected.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { applyDetectedTitle } from "./terminalTitle";

// The runtime handler is the composition: applyDetectedTitle gate + registry mutation.
// We assert the gate + mutation contract here (mirrors terminalRuntime.ts onTitleDetected).
const makeHandler = (terminal: { tentacleName: string; nameOrigin?: string }, persist: () => void) => {
  return (title: string) => {
    const decision = applyDetectedTitle({
      currentName: terminal.tentacleName,
      origin: terminal.nameOrigin as never,
      title,
    });
    if (!decision.changed) return;
    terminal.tentacleName = decision.name;
    terminal.nameOrigin = decision.origin;
    persist();
  };
};

describe("onTitleDetected contract", () => {
  it("updates a generated name and persists", () => {
    const terminal = { tentacleName: "Octogent Terminal 1", nameOrigin: "generated" };
    const persist = vi.fn();
    makeHandler(terminal, persist)("Refactor auth flow");
    expect(terminal).toEqual({ tentacleName: "Refactor auth flow", nameOrigin: "conversation" });
    expect(persist).toHaveBeenCalledOnce();
  });

  it("leaves a user name untouched", () => {
    const terminal = { tentacleName: "Mine", nameOrigin: "user" };
    const persist = vi.fn();
    makeHandler(terminal, persist)("Refactor auth flow");
    expect(terminal).toEqual({ tentacleName: "Mine", nameOrigin: "user" });
    expect(persist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @octogent/api exec vitest run src/terminalRuntime/` then `pnpm --filter @octogent/api build`
Expected: tests PASS; `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/terminalRuntime/sessionRuntime.ts apps/api/src/terminalRuntime/types.ts apps/api/src/terminalRuntime.ts apps/api/src/terminalRuntime/onTitleDetected.test.ts
git commit -m "feat(rename): auto-sync tentacle title from conversation via PTY title parsing"
```

---

## Task 4: Inline-editable title in the canvas column (manual rename UI)

Thread the existing (currently unused) rename state from `useTerminalMutations` down to `CanvasTerminalColumn` and render an editable title: double-click to edit, Enter commits (`submitTerminalRename`), Esc cancels (`cancelTerminalRename`).

**Files:**
- Modify: `apps/web/src/App.tsx:140-152` (destructure rename fields) and the `CanvasPrimaryView` render site (~line 632, where `onTerminalRenamed` is already passed)
- Modify: `apps/web/src/components/CanvasPrimaryView.tsx:90-100, ~224, ~1262-1272` (thread props through to the column)
- Modify: `apps/web/src/components/canvas/CanvasTerminalColumn.tsx`
- Test: `apps/web/tests/canvas-terminal-column-rename.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `apps/web/tests/canvas-terminal-column-rename.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasTerminalColumn } from "../src/components/canvas/CanvasTerminalColumn";

const baseNode = { sessionId: "terminal-1", tentacleId: "auth", color: "#abc", label: "auth" } as never;
const terminals = [{ terminalId: "terminal-1", tentacleName: "Old Name", workspaceMode: "shared" }] as never;

const baseProps = {
  node: baseNode,
  terminals,
  onMinimize: vi.fn(),
  onClose: vi.fn(),
  isEditingName: false,
  nameDraft: "",
  onBeginNameEdit: vi.fn(),
  onNameDraftChange: vi.fn(),
  onSubmitNameEdit: vi.fn(),
  onCancelNameEdit: vi.fn(),
};

describe("CanvasTerminalColumn rename", () => {
  it("enters edit mode on double-click of the title", () => {
    const onBeginNameEdit = vi.fn();
    render(<CanvasTerminalColumn {...baseProps} onBeginNameEdit={onBeginNameEdit} />);
    fireEvent.doubleClick(screen.getByText("Old Name"));
    expect(onBeginNameEdit).toHaveBeenCalledWith("terminal-1", "Old Name");
  });

  it("submits on Enter and cancels on Escape", () => {
    const onSubmitNameEdit = vi.fn();
    const onCancelNameEdit = vi.fn();
    render(
      <CanvasTerminalColumn
        {...baseProps}
        isEditingName
        nameDraft="New Name"
        onSubmitNameEdit={onSubmitNameEdit}
        onCancelNameEdit={onCancelNameEdit}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmitNameEdit).toHaveBeenCalledWith("terminal-1", "Old Name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancelNameEdit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @octogent/web exec vitest run tests/canvas-terminal-column-rename.test.tsx`
Expected: FAIL — props don't exist / title not editable.

- [ ] **Step 3: Make the column title editable**

In `apps/web/src/components/canvas/CanvasTerminalColumn.tsx`, extend the props type:

```ts
type CanvasTerminalColumnProps = {
  node: GraphNode;
  terminals: TerminalView;
  layoutVersion?: string | number;
  isFocused?: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onFocus?: () => void;
  panelRef?: Ref<HTMLElement> | undefined;
  onTerminalRenamed?: ((terminalId: string, tentacleName: string) => void) | undefined;
  onTerminalActivity?: ((terminalId: string) => void) | undefined;
  isEditingName?: boolean;
  nameDraft?: string;
  onBeginNameEdit?: (terminalId: string, currentName: string) => void;
  onNameDraftChange?: (value: string) => void;
  onSubmitNameEdit?: (terminalId: string, currentName: string) => void;
  onCancelNameEdit?: () => void;
};
```

Destructure the new props in the component signature, then replace the title block (lines 56–62) with:

```tsx
        <div className="canvas-terminal-column-heading">
          <h2>
            {isEditingName ? (
              <input
                className="canvas-terminal-column-name-input"
                value={nameDraft ?? ""}
                autoFocus
                aria-label="Rename tentacle"
                onChange={(e) => onNameDraftChange?.(e.target.value)}
                onBlur={() => onSubmitNameEdit?.(node.sessionId ?? "", rawName)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmitNameEdit?.(node.sessionId ?? "", rawName);
                  if (e.key === "Escape") onCancelNameEdit?.();
                }}
              />
            ) : (
              <span
                className="canvas-terminal-column-name"
                title="Double-click to rename"
                onDoubleClick={() => onBeginNameEdit?.(node.sessionId ?? "", rawName)}
              >
                {tentacleName}
              </span>
            )}
            {workspaceMode === "worktree" && (
              <span className="canvas-terminal-column-badge">WT</span>
            )}
          </h2>
        </div>
```

(Note: `rawName` is the untruncated name already computed at line 37; submit/begin use it so editing starts from the full name.)

- [ ] **Step 4: Run the component test**

Run: `pnpm --filter @octogent/web exec vitest run tests/canvas-terminal-column-rename.test.tsx`
Expected: PASS.

- [ ] **Step 5: Thread props from `useTerminalMutations` through App → CanvasPrimaryView → column**

In `apps/web/src/App.tsx`, add the rename fields to the destructure at lines 140–146:

```ts
    beginTerminalNameEdit,
    submitTerminalRename,
    cancelTerminalRename,
    editingTerminalId,
    terminalNameDraft,
    setTerminalNameDraft,
```

Where `CanvasPrimaryView` is rendered (the block around line 632 that already passes `onTerminalRenamed: handleTerminalRenamed`), pass:

```tsx
            editingTerminalId={editingTerminalId}
            terminalNameDraft={terminalNameDraft}
            onBeginTerminalNameEdit={beginTerminalNameEdit}
            onTerminalNameDraftChange={setTerminalNameDraft}
            onSubmitTerminalRename={submitTerminalRename}
            onCancelTerminalRename={cancelTerminalRename}
```

In `apps/web/src/components/CanvasPrimaryView.tsx`, add the matching props to its props type (near line 90 where `onTerminalRenamed?` is declared) and destructure (near line 224):

```ts
  editingTerminalId?: string | null;
  terminalNameDraft?: string;
  onBeginTerminalNameEdit?: (terminalId: string, currentName: string) => void;
  onTerminalNameDraftChange?: (value: string) => void;
  onSubmitTerminalRename?: (terminalId: string, currentName: string) => void;
  onCancelTerminalRename?: () => void;
```

At the `<CanvasTerminalColumn ... />` render site (~line 1262, where `onTerminalRenamed={onTerminalRenamed}` is passed), pass through:

```tsx
                isEditingName={editingTerminalId === node.sessionId}
                nameDraft={terminalNameDraft}
                onBeginNameEdit={onBeginTerminalNameEdit}
                onNameDraftChange={onTerminalNameDraftChange}
                onSubmitNameEdit={onSubmitTerminalRename}
                onCancelNameEdit={onCancelTerminalRename}
```

- [ ] **Step 6: Add minimal CSS for the input**

In the stylesheet that defines `.canvas-terminal-column-name` (search `src/styles` for that class), add a sibling rule so the input matches the heading:

```css
.canvas-terminal-column-name-input {
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  padding: 0 4px;
  max-width: 22ch;
}
```

- [ ] **Step 7: Run web tests + typecheck + lint**

Run: `pnpm --filter @octogent/web test` then `pnpm lint`
Expected: all PASS; no Biome errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/CanvasPrimaryView.tsx apps/web/src/components/canvas/CanvasTerminalColumn.tsx apps/web/tests/canvas-terminal-column-rename.test.tsx apps/web/src/styles
git commit -m "feat(rename): inline-editable tentacle title in canvas column"
```

---

## Task 5: Manual end-to-end verification

- [ ] **Step 1: Build + run**

Run: `pnpm build` then launch octogent from a project (`cd <project> && octogent`). Open the UI, focus a running agent column.

- [ ] **Step 2: Verify manual rename**

Double-click the column title → input appears → type a new name → Enter. The title updates and persists across a refresh (origin `user`). Esc mid-edit reverts.

- [ ] **Step 3: Verify auto-sync (and tune the filter)**

In an agent that has a conversation topic / after `/rename` in Claude, capture the real PTY title once to confirm the topic text:
Run: `printf '' ; # in a scratch test, log detectedTitles` — or temporarily `logVerbose` the detected titles in `onData`.
Confirm a meaningful topic flows into the title when you have NOT manually renamed, and that a manually-renamed column is NOT overwritten. If Claude emits only noise (bare "claude"/path), tighten/relax `isMeaningfulConversationTitle` accordingly and re-run Task 2 tests.

- [ ] **Step 4: Commit any filter tuning**

```bash
git add apps/api/src/terminalRuntime/terminalTitle.ts apps/api/src/terminalRuntime/terminalTitle.test.ts
git commit -m "chore(rename): tune conversation-title noise filter against live session"
```

---

## Self-review notes

- **Spec coverage:** 1a manual rename → Task 4; 1b auto-sync → Tasks 1–3; `nameOrigin` precedence → Task 2 (`applyDetectedTitle`) + Task 3 handler; fix of the previously-suspected `submitTerminalRename` bug → not needed (the live code is already correct; no task spends effort there).
- **Risk:** Task 5 Step 3 is the explicit verification/tuning gate for the one fuzzy area (does Claude emit a useful title). Manual rename (Tasks 1–4 minus the parser) ships independently if auto-sync is dropped.
- **Type consistency:** `applyDetectedTitle` returns `{changed, name, origin}` used identically in Task 3; props named `isEditingName/nameDraft/onBeginNameEdit/onNameDraftChange/onSubmitNameEdit/onCancelNameEdit` on the column, mapped from `editingTerminalId/terminalNameDraft/...` at the container.
