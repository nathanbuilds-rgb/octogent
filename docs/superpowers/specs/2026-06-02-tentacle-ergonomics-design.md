# Tentacle Ergonomics: Rename + Guided Creation

**Date:** 2026-06-02
**Status:** Approved design, pre-implementation
**Branch:** `feat/tentacle-ergonomics`

## Overview

Two ergonomic improvements to how operators name and create tentacles:

1. **Rename running agent tentacles** — both a manual inline rename in the UI and
   automatic syncing of the title from the agent's live conversation name.
2. **Guided "Add Tentacle Manually"** — replace the one-shot form (which silently
   produces an empty, dormant tentacle folder) with a short wizard that collects or
   generates todos from the description and lets the operator pick tools, so the new
   tentacle is actually set up to work.

These are independent and ship as two phases.

## Background / current state

- Terminal rename is fully built on the backend (`renameTerminal` in
  `apps/api/src/terminalRuntime.ts:624`, exposed as `PATCH /api/terminals/:id` in
  `apps/api/src/createApiServer/terminalRoutes.ts:263`). The web client even has
  `submitTerminalRename()` (`apps/web/src/app/hooks/useTerminalMutations.ts:72`) — but
  **nothing in the UI calls it**, and the column title is static text
  (`apps/web/src/components/canvas/CanvasTerminalColumn.tsx:55`).
- `submitTerminalRename()` has a latent bug: it sets the error message even on success.
- octogent receives **no** title/rename signal today — transcript events
  (`packages/core/src/domain/conversation.ts`) have no title field, and hooks don't
  carry one. Auto-naming today only happens once, from the first prompt
  (`apps/api/src/terminalRuntime/hookProcessor.ts:310`, `nameOrigin: generated → prompt`).
- "Add Tentacle Manually" (`apps/web/src/components/deck/ActionCards.tsx:109` →
  `AddTentacleForm.tsx` → `POST /api/deck/tentacles`) calls `createDeckTentacle`
  (`apps/api/src/deck/readDeckTentacles.ts:480`), which writes `CONTEXT.md`, an **empty**
  `todo.md` (`"# Todo\n"`), and a deck-state entry. No running agent, no todos → "nothing
  happens" from the operator's view.
- There is **no server-side LLM**; all model interaction is via spawned `claude` CLIs.
  Prompt templates are string interpolation only (`promptResolver.ts`).

## Scope

**In scope:** renaming the running agent terminals (canvas columns, which hold a live
conversation); the guided creation wizard for deck tentacles.

**Out of scope:** renaming deck folder cards (their name is their folder identity / ID —
renaming = moving a folder); changing the agent execution model; any new API-key/SDK
dependency.

---

## Part 1 — Rename

### 1a. Manual inline rename

- **UI:** In `CanvasTerminalColumn.tsx`, the title `<span>` becomes inline-editable:
  double-click (or a small pencil affordance) swaps it for an `<input>` prefilled with the
  current name. Enter commits, Esc cancels, blur commits.
- **Wiring:** Commit calls the existing `PATCH /api/terminals/:id` via a fixed
  `submitTerminalRename()`. Fix the bug so the error is set **only** on a non-OK response.
  The visible name updates from the existing `terminal-updated` broadcast (no optimistic
  local state needed, though we may add it for snappiness).
- **Origin:** A manual rename sets `nameOrigin = "user"`, which makes the name sticky.

### 1b. Auto-sync from conversation

- **Source:** Claude Code sets the terminal tab title to the conversation topic and
  updates it on `/rename` (the `terminalTitleFromRename` setting, default on). octogent
  already reads every PTY byte in `sessionRuntime` `onData`.
- **Parser:** Add an OSC title extractor for `ESC ] 0 ; <title> BEL`, `ESC ] 2 ; <title>`
  (and `ESC ] 1 ;`), terminated by BEL (`\x07`) or ST (`ESC \`). It must buffer partial
  sequences split across chunks and ignore malformed input without throwing.
- **Apply rule:** When a meaningful title arrives **and the terminal's `nameOrigin !==
  "user"`**, update `tentacleName`, set `nameOrigin = "conversation"`, persist the
  registry, and broadcast `terminal-updated` + the WS `rename` message.
- **Precedence:** `user` > `conversation` > `prompt` > `generated`. Add `"conversation"`
  to `TerminalNameOrigin` (`apps/api/src/terminalRuntime/types.ts`).
- **Noise filter:** Drop titles that are bare shell/program names or the cwd (`zsh`,
  lone `claude`, a path). Only adopt a title once it looks like a real topic. **This
  filter is the one fuzzy part and will be tuned against a captured real Claude session
  during implementation** (capture the actual OSC stream first; if Claude does not emit a
  useful topic title, fall back to manual-only for 1b and note it).

### Data flow

- Manual: input → `PATCH /api/terminals/:id` → `renameTerminal` (origin=user) →
  `terminal-updated` broadcast → UI updates.
- Auto: PTY chunk → OSC parse → (origin≠user) update name → persist + broadcast → UI.

### Error handling

- Fix `submitTerminalRename` success-path bug. Empty names rejected by the backend
  (already validated). Esc cancels cleanly. OSC parser never throws; partial/garbage
  ignored; only changed titles trigger an update (dedup).

### Testing

- Unit: OSC title extraction (BEL vs ST terminators, split-chunk buffering, noise
  filtering, no-throw on garbage).
- Unit: `nameOrigin` precedence (user sticky; conversation overrides prompt/generated).
- Component: inline-edit commit/cancel issues the PATCH; column re-renders on broadcast.

---

## Part 2 — Guided "Add Tentacle Manually"

### Wizard

Convert `AddTentacleForm.tsx` from a single step into three (single component, step
state). Appearance (color/octopus) stays but is de-emphasized.

```
① Details                ② Todos                          ③ Tools          → Create
  name (required)          [ Generate from description ]     skill checkboxes
  description              editable checklist:               (existing
  appearance (optional)      add / edit / remove / reorder    DeckAvailableSkill list)
```

- **② Generate todos:** New `POST /api/deck/tentacles/generate-todos { description, name? }`.
  Server runs a **headless `claude -p`** (print mode) with the resource-isolation flags
  `--strict-mcp-config --settings '{"disableAllHooks":true}'` (the same isolation added in
  the usage-scraper fix) against a new `prompts/generate-todos.md` template. Parse the
  returned checklist into clean strings; return `{ todos: string[] }`. The operator edits
  the result. Manual entry is always available; generation only pre-fills. Single,
  user-triggered, one-shot call with a timeout — not a loop.
- **Create:** Extend `CreateDeckTentacleInput` and `createDeckTentacle`
  (`apps/api/src/deck/readDeckTentacles.ts:480`) to accept optional `todos: string[]`,
  writing them into `todo.md` as `- [ ] <todo>` lines instead of an empty header. Extend
  the `POST /api/deck/tentacles` route (`deckRoutes.ts`) to parse `todos`. Skills continue
  to be written into `CONTEXT.md` (`applySuggestedSkillsToContext`) as today.
- **Result:** A normal deck card with a populated todo progress bar and skills, matching
  the existing cards.

### Data flow

- Generate: wizard → `POST /generate-todos` → `claude -p` → parsed todos → editable list.
- Create: wizard → `POST /api/deck/tentacles { …, todos }` → `createDeckTentacle` writes
  `CONTEXT.md` + populated `todo.md` + deck state → 201 → existing refetch → card appears.

### Error handling

- `generate-todos`: `claude` missing / timeout / empty parse → return an error the wizard
  surfaces as "couldn't generate — add them manually." Generation failure **never blocks**
  creation.
- Duplicate name already returns "A tentacle with this name already exists" — surface it
  in the wizard.
- Wizard validation: name required; todos and tools optional. Back/Next preserves state.

### Testing

- Unit: todo-output parser (`claude -p` text → `string[]`), `todo.md` writer (todos →
  markdown), `createDeckTentacle` with todos, generate-todos timeout/empty paths.
- Component: wizard step navigation, "Generate" pre-fill + edit, create payload includes
  `todos`.

---

## Architecture boundaries

- LLM spawn (`generate-todos`) and the `todo.md` write live in `apps/api` (infrastructure).
- Wizard UI lives in `apps/web/src/components/deck`.
- `todos` is a plain `string[]`; no `packages/core` change required beyond the
  `TerminalNameOrigin` addition for Part 1.
- Orchestration stays thin: routes wire to runtime/deck functions; no business logic in
  route handlers or top-level React containers.

## Dependencies / sequencing

- Part 2's headless-claude isolation flags come from the usage-scraper fix
  (`fix/usage-scraper-resource-storm`). Implementation should base on or merge that work so
  the isolation helper is shared rather than duplicated.
- Two phases, independently shippable: **Phase 1 = Rename**, **Phase 2 = Guided creation**.

## Open risk

- Part 1b depends on Claude emitting a useful conversation title via OSC. Verified pattern
  exists (`]2;claude` seen in PTY output); the *content* (topic vs bare "claude") must be
  confirmed against a live session before finalizing the noise filter. Fallback: manual
  rename (1a) ships regardless.
