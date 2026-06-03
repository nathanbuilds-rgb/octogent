# Guided Tentacle Creation — Frontend Wizard (Phase 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot "Add Tentacle" form with a 3-step wizard (Details → Todos → Tools) that can generate or hand-enter todos, and fix issue #4 so the canvas "New Tentacle" button opens that same wizard instead of blind-POSTing an empty body (→ 400).

**Architecture:** `AddTentacleForm` becomes a 3-step wizard but stays **presentational** — it receives an injected `onGenerateTodos(name, description) => Promise<string[]>` prop, so the actual `POST /api/deck/tentacles/generate-todos` network call lives in the `DeckPrimaryView` container (matching the repo's "containers orchestrate, components present" boundary). A new focused `TodoChecklistEditor` handles the editable todo list. The canvas button fix lifts a small `openAddFormSignal` counter into `App.tsx`: clicking switches `activePrimaryNav` to the deck (`2`) and bumps the signal; `DeckPrimaryView` opens the wizard when the signal changes.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + jsdom + @testing-library/react. Web tests live in `apps/web/tests/**/*.test.tsx`. Biome for lint/format. Backend endpoints from Phase 2a already exist: `POST /api/deck/tentacles` accepts `todos: string[]`; `POST /api/deck/tentacles/generate-todos` returns `{ todos: string[] }`.

**Branch:** `feat/guided-tentacle-creation` (already holds Phase 2a backend; this branch is intentionally independent of Phase 1's rename work for a clean upstream PR).

---

## Context the implementer needs (verified facts)

- **Wizard file today:** `apps/web/src/components/deck/AddTentacleForm.tsx` (269 lines). Single-step form. Its `onSubmit` signature is:
  `onSubmit: (name, description, color, octopus: OctopusAppearancePayload, suggestedSkills: string[]) => void`.
  It renders: octopus preview, Name input (`<label>Name<input/></label>`), Description textarea, Suggested Skills checkboxes (only when `availableSkills.length > 0`), Color swatches, Expression/Hair chips, error div, and a submit button labeled "Create Tentacle" / "Creating...". Name is required (`name.trim().length === 0` disables submit / blocks `handleSubmit`).
- **Container:** `apps/web/src/components/DeckPrimaryView.tsx`.
  - `handleCreateTentacle` (line ~251) is the `onSubmit` handler. It POSTs to `buildDeckTentaclesUrl()` with body `{ name, description, color, octopus, suggestedSkills }`, sets `createError` from the response `error` field on failure, calls `setEmptyViewMode("idle")` + `fetchTentacles()` + `onRefreshWorkspaceSetup()` on success. State: `isCreating`, `createError`, `availableSkills`, `emptyViewMode: "idle" | "adding"`.
  - The wizard is shown when `emptyViewMode === "adding"` (around line 469), rendered as `<AddTentacleForm onSubmit={handleCreateTentacle} onCancel={() => setEmptyViewMode("idle")} isSubmitting={isCreating} error={createError} availableSkills={availableSkills} />`.
  - "Add Tentacle Manually" buttons call `setEmptyViewMode("adding")` (lines ~378, ~461).
- **URL builders:** `apps/web/src/runtime/runtimeEndpoints.ts`. Pattern (verified):
  ```ts
  export const buildDeckSkillsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
    if (!runtimeBaseUrl) {
      return "/api/deck/skills";
    }
    return buildAbsoluteUrl(runtimeBaseUrl, "/api/deck/skills");
  };
  ```
- **Issue #4 (canvas button):** `apps/web/src/App.tsx` `onCreateTentacle` (lines 558-566) currently does:
  ```ts
  onCreateTentacle: async () => {
    const response = await fetch("/api/deck/tentacles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", description: "" }),
    });
    if (!response.ok) return;
    await refreshColumns();
  },
  ```
  This empty body fails backend name validation → 400. `onCreateTentacle` is consumed by `CanvasPrimaryView` (`onCreateTentacle?: () => void`, buttons at lines 1119 & 1342) — **no change needed in CanvasPrimaryView**; only the App-supplied implementation changes.
- **View routing:** `apps/web/src/components/PrimaryViewRouter.tsx` shows `DeckPrimaryView` when `activePrimaryNav === 2`, else falls through to `CanvasPrimaryView`. `activePrimaryNav` / `setActivePrimaryNav` come from `usePersistedUiState` and are in scope in `App.tsx` (used at lines 433-434, 612). `deckPrimaryViewProps` is the object literal passed to `<PrimaryViewRouter deckPrimaryViewProps={{...}} />` (App.tsx ~467).
- **Tests:** jsdom + @testing-library/react. Existing `apps/web/tests/add-tentacle-form.test.tsx` renders `AddTentacleForm` directly and asserts the `onSubmit` argument shape. `apps/web/tests/runtimeEndpoints.test.tsx` exists for URL-builder tests. Run a single web test file with:
  `pnpm --filter @octogent/web exec vitest run tests/<file>.test.tsx`.

---

## File Structure

- **Create** `apps/web/src/components/deck/TodoChecklistEditor.tsx` — presentational editable todo list (add / edit / remove). One responsibility: manage a `string[]` via callbacks.
- **Modify** `apps/web/src/components/deck/AddTentacleForm.tsx` — convert to 3-step wizard; add `todos` to `onSubmit`; add `onGenerateTodos` prop; embed `TodoChecklistEditor`.
- **Modify** `apps/web/src/components/DeckPrimaryView.tsx` — extend `handleCreateTentacle` to send `todos`; add `handleGenerateTodos` (fetch); pass both into `AddTentacleForm`; add `openAddFormSignal` prop + effect to open the wizard.
- **Modify** `apps/web/src/runtime/runtimeEndpoints.ts` — add `buildDeckGenerateTodosUrl`.
- **Modify** `apps/web/src/App.tsx` — add `openDeckAddFormSignal` state; rewrite `onCreateTentacle` (issue #4) to nav to deck + bump the signal; pass `openAddFormSignal` into `deckPrimaryViewProps`.
- **Test** `apps/web/tests/runtimeEndpoints.test.tsx` — add a case for `buildDeckGenerateTodosUrl`.
- **Test** `apps/web/tests/TodoChecklistEditor.test.tsx` — add / edit / remove behavior.
- **Test** `apps/web/tests/add-tentacle-form.test.tsx` — extend: step navigation, generate pre-fill, create payload includes `todos`.

---

## Task 1: `buildDeckGenerateTodosUrl` URL builder

**Files:**
- Modify: `apps/web/src/runtime/runtimeEndpoints.ts` (add next to `buildDeckTentaclesUrl`)
- Test: `apps/web/tests/runtimeEndpoints.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/tests/runtimeEndpoints.test.tsx` (place inside the existing top-level `describe`, or add a new `describe`; match the file's existing import style — import `buildDeckGenerateTodosUrl` from `../src/runtime/runtimeEndpoints`):

```tsx
import { buildDeckGenerateTodosUrl } from "../src/runtime/runtimeEndpoints";

describe("buildDeckGenerateTodosUrl", () => {
  it("returns the relative path when no runtime base url is set", () => {
    expect(buildDeckGenerateTodosUrl("")).toBe("/api/deck/tentacles/generate-todos");
  });

  it("returns an absolute url when a runtime base url is provided", () => {
    expect(buildDeckGenerateTodosUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/api/deck/tentacles/generate-todos",
    );
  });
});
```

> Note: confirm the exact absolute-URL shape `buildAbsoluteUrl` produces by reading one existing builder test in the file; if `buildAbsoluteUrl` normalizes differently (e.g. trailing slash handling), match what the sibling builders' tests assert. The relative-path assertion is the one that must hold regardless.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @octogent/web exec vitest run tests/runtimeEndpoints.test.tsx`
Expected: FAIL — `buildDeckGenerateTodosUrl` is not exported.

- [ ] **Step 3: Add the builder**

In `apps/web/src/runtime/runtimeEndpoints.ts`, immediately after `buildDeckTentaclesUrl`:

```ts
export const buildDeckGenerateTodosUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/deck/tentacles/generate-todos";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/deck/tentacles/generate-todos");
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @octogent/web exec vitest run tests/runtimeEndpoints.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/runtime/runtimeEndpoints.ts apps/web/tests/runtimeEndpoints.test.tsx
git commit -m "feat(web): buildDeckGenerateTodosUrl endpoint helper"
```

---

## Task 2: `TodoChecklistEditor` component

A focused, presentational editor for a `string[]` of todo items: render each as an editable text input with a remove button, plus an "Add item" control. Fully controlled — parent owns the array.

**Files:**
- Create: `apps/web/src/components/deck/TodoChecklistEditor.tsx`
- Test: `apps/web/tests/TodoChecklistEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/TodoChecklistEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TodoChecklistEditor } from "../src/components/deck/TodoChecklistEditor";

describe("TodoChecklistEditor", () => {
  it("renders each todo as an editable input", () => {
    render(<TodoChecklistEditor items={["first", "second"]} onChange={() => {}} />);
    expect(screen.getByDisplayValue("first")).toBeInTheDocument();
    expect(screen.getByDisplayValue("second")).toBeInTheDocument();
  });

  it("adds an empty item when Add is clicked", () => {
    const onChange = vi.fn();
    render(<TodoChecklistEditor items={["first"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add (item|todo)/i }));
    expect(onChange).toHaveBeenCalledWith(["first", ""]);
  });

  it("edits an item in place", () => {
    const onChange = vi.fn();
    render(<TodoChecklistEditor items={["first", "second"]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("second"), { target: { value: "second!" } });
    expect(onChange).toHaveBeenCalledWith(["first", "second!"]);
  });

  it("removes an item", () => {
    const onChange = vi.fn();
    render(<TodoChecklistEditor items={["first", "second"]} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(["second"]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @octogent/web exec vitest run tests/TodoChecklistEditor.test.tsx`
Expected: FAIL — module not found / component not exported.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/deck/TodoChecklistEditor.tsx`:

```tsx
export type TodoChecklistEditorProps = {
  items: string[];
  onChange: (items: string[]) => void;
};

export const TodoChecklistEditor = ({ items, onChange }: TodoChecklistEditorProps) => {
  const updateAt = (index: number, value: string) => {
    onChange(items.map((item, i) => (i === index ? value : item)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...items, ""]);
  };

  return (
    <div className="deck-todo-editor">
      {items.length === 0 ? (
        <p className="deck-todo-editor-empty">No todos yet. Generate from the description or add them manually.</p>
      ) : (
        <ul className="deck-todo-editor-list">
          {items.map((item, index) => (
            // Index key is acceptable here: the list is short, fully controlled, and
            // reorder is not supported in this editor.
            <li key={index} className="deck-todo-editor-row">
              <input
                type="text"
                className="deck-todo-editor-input"
                value={item}
                onChange={(e) => updateAt(index, e.target.value)}
                placeholder="Describe a task..."
              />
              <button
                type="button"
                className="deck-todo-editor-remove"
                onClick={() => removeAt(index)}
                aria-label={`Remove todo ${index + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="deck-todo-editor-add" onClick={addItem}>
        + Add item
      </button>
    </div>
  );
};
```

> Biome may warn on the array-index `key`. Keep the explanatory comment (constraint: short, controlled, no reorder). If the project's Biome config errors rather than warns on this rule, suppress that single line with the project's standard ignore comment (check another file for the exact `biome-ignore` syntax already in use) rather than restructuring.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @octogent/web exec vitest run tests/TodoChecklistEditor.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Add minimal styles**

Find the deck stylesheet that defines `deck-add-form-*` classes (grep `deck-add-form-skills` under `apps/web/src/styles/`). In that same file, add focused rules for `.deck-todo-editor`, `.deck-todo-editor-list`, `.deck-todo-editor-row`, `.deck-todo-editor-input`, `.deck-todo-editor-remove`, `.deck-todo-editor-add`, `.deck-todo-editor-empty` — match the visual language of the surrounding deck-add-form styles (spacing, borders, colors). Keep it minimal; do not restyle existing classes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/deck/TodoChecklistEditor.tsx apps/web/tests/TodoChecklistEditor.test.tsx apps/web/src/styles/
git commit -m "feat(web): TodoChecklistEditor for editable todo lists"
```

---

## Task 3: Convert `AddTentacleForm` into a 3-step wizard

Three steps in one component via a `step` state: **① Details** (name, description, appearance), **② Todos** (Generate button + `TodoChecklistEditor`), **③ Tools** (existing skills checkboxes). Final step has the Create button. Name remains required to advance past step ①. `onSubmit` gains a 6th argument `todos: string[]`. A new `onGenerateTodos` prop performs generation (injected; the form does not fetch).

**Files:**
- Modify: `apps/web/src/components/deck/AddTentacleForm.tsx`
- Modify: `apps/web/src/components/DeckPrimaryView.tsx` (update the `onSubmit` handler signature + pass `onGenerateTodos`; full wiring in Task 4 — here, just keep it compiling)
- Test: `apps/web/tests/add-tentacle-form.test.tsx`

- [ ] **Step 1: Update the existing test + add wizard tests (write them failing)**

Replace the contents of `apps/web/tests/add-tentacle-form.test.tsx` with:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddTentacleForm } from "../src/components/deck/AddTentacleForm";

const SKILLS = [
  { name: "docs-writer", description: "Keeps docs aligned with the product.", source: "project" as const },
  { name: "release-helper", description: "Helps with release coordination.", source: "user" as const },
];

const renderForm = (overrides: Partial<React.ComponentProps<typeof AddTentacleForm>> = {}) =>
  render(
    <AddTentacleForm
      onSubmit={overrides.onSubmit ?? (() => {})}
      onCancel={overrides.onCancel ?? (() => {})}
      onGenerateTodos={overrides.onGenerateTodos ?? (async () => [])}
      isSubmitting={overrides.isSubmitting ?? false}
      error={overrides.error ?? null}
      availableSkills={overrides.availableSkills ?? SKILLS}
    />,
  );

// Advance Details -> Todos -> Tools. Name is required to leave Details.
const goToToolsStep = (name = "docs") => {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Todos
  fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Tools
};

describe("AddTentacleForm wizard", () => {
  it("does not advance past Details without a name", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // Still on Details: the Name field is visible, Todos generate button is not.
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });

  it("submits selected skills and todos through all three steps", () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    goToToolsStep("docs");
    fireEvent.click(screen.getByLabelText(/docs-writer/i));
    fireEvent.click(screen.getByRole("button", { name: /create tentacle/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      "docs",
      "",
      expect.any(String),
      expect.objectContaining({
        animation: expect.any(String),
        expression: expect.any(String),
        accessory: expect.any(String),
        hairColor: expect.any(String),
      }),
      ["docs-writer"],
      [], // todos (none added)
    );
  });

  it("pre-fills the checklist from onGenerateTodos", async () => {
    const onGenerateTodos = vi.fn(async () => ["write tests", "wire route"]);
    renderForm({ onGenerateTodos });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "auth" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "add password reset" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Todos
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(screen.getByDisplayValue("write tests")).toBeInTheDocument());
    expect(screen.getByDisplayValue("wire route")).toBeInTheDocument();
    expect(onGenerateTodos).toHaveBeenCalledWith("auth", "add password reset");
  });

  it("includes generated todos in the submit payload", async () => {
    const onSubmit = vi.fn();
    const onGenerateTodos = vi.fn(async () => ["task one"]);
    renderForm({ onSubmit, onGenerateTodos });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "auth" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Todos
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByDisplayValue("task one")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Tools
    fireEvent.click(screen.getByRole("button", { name: /create tentacle/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      "auth",
      "",
      expect.any(String),
      expect.any(Object),
      [],
      ["task one"],
    );
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @octogent/web exec vitest run tests/add-tentacle-form.test.tsx`
Expected: FAIL — no "Next" button / `onGenerateTodos` not a prop / `onSubmit` arity mismatch.

- [ ] **Step 3: Convert the component to a wizard**

Edit `apps/web/src/components/deck/AddTentacleForm.tsx`:

1. Extend the props type:
```ts
export type AddTentacleFormProps = {
  onSubmit: (
    name: string,
    description: string,
    color: string,
    octopus: OctopusAppearancePayload,
    suggestedSkills: string[],
    todos: string[],
  ) => void;
  onCancel: () => void;
  onGenerateTodos: (name: string, description: string) => Promise<string[]>;
  isSubmitting: boolean;
  error: string | null;
  availableSkills: DeckAvailableSkill[];
};
```

2. Import the editor at the top:
```ts
import { TodoChecklistEditor } from "./TodoChecklistEditor";
```

3. Add wizard + todo + generation state alongside the existing `useState` hooks:
```ts
const [step, setStep] = useState<1 | 2 | 3>(1);
const [todos, setTodos] = useState<string[]>([]);
const [isGenerating, setIsGenerating] = useState(false);
const [generateError, setGenerateError] = useState<string | null>(null);
```

4. Replace `handleSubmit` so it only submits from the final step and includes todos; add navigation helpers and a generate handler:
```ts
const trimmedTodos = () => todos.map((t) => t.trim()).filter((t) => t.length > 0);

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (name.trim().length === 0) {
    setStep(1);
    return;
  }
  onSubmit(
    name.trim(),
    description.trim(),
    selectedColor,
    {
      animation: selectedAnimation,
      expression: selectedExpression,
      accessory: selectedAccessory,
      hairColor: selectedHairColor,
    },
    selectedSkills,
    trimmedTodos(),
  );
};

const goNext = () => {
  if (step === 1 && name.trim().length === 0) return;
  setStep((s) => (s === 1 ? 2 : 3));
};

const goBack = () => {
  if (step === 1) {
    onCancel();
    return;
  }
  setStep((s) => (s === 3 ? 2 : 1));
};

const handleGenerate = async () => {
  if (name.trim().length === 0 && description.trim().length === 0) return;
  setIsGenerating(true);
  setGenerateError(null);
  try {
    const generated = await onGenerateTodos(name.trim(), description.trim());
    if (generated.length === 0) {
      setGenerateError("Couldn't generate todos — add them manually below.");
      return;
    }
    setTodos(generated);
  } catch {
    setGenerateError("Couldn't generate todos — add them manually below.");
  } finally {
    setIsGenerating(false);
  }
};
```

5. Restructure the JSX. Keep the octopus preview and header. The header "← Back" button now calls `goBack` (which cancels from step 1). Render exactly one step's body based on `step`:
   - **Step 1 (Details):** the existing Name input (keep `ref={nameRef}` and the exact `<label className="deck-add-form-label">Name<input .../></label>` structure so `getByLabelText("Name")` keeps working), the Description textarea (keep `Description` label text intact for `getByLabelText("Description")`), and the appearance controls (Color / Expression / Hair Style / Hair Color) moved here but visually de-emphasized (wrap them in a `<details className="deck-add-form-appearance"><summary>Appearance</summary>…</details>` or a clearly secondary block — your choice, but they must remain functional).
   - **Step 2 (Todos):** a "Generate from description" button (`type="button"`, label must contain "Generate", `disabled={isGenerating}`, shows "Generating…" while in flight), the `generateError` message when set, and `<TodoChecklistEditor items={todos} onChange={setTodos} />`.
   - **Step 3 (Tools):** the existing Suggested Skills checkboxes block (unchanged markup so `getByLabelText(/docs-writer/i)` keeps working). If `availableSkills.length === 0`, show a short "No skills available" note.
   - **Footer / nav:** on steps 1 & 2 render a "Next" button (`type="button"` calling `goNext`; disabled on step 1 when name is empty). On step 3 render the existing submit button labeled "Create Tentacle" / "Creating…" (`type="submit"`, disabled when `isSubmitting || name.trim().length === 0`). Optionally render a step indicator (e.g. "Step 2 of 3"). Keep the `{error && <div className="deck-add-form-error">{error}</div>}` near the footer.

   Keep using existing `deck-add-form-*` classes where they apply; add new focused class names only where needed (e.g. `deck-add-form-step`, `deck-add-form-nav`, `deck-add-form-generate`).

6. **Update the consumer so the tree compiles.** In `apps/web/src/components/DeckPrimaryView.tsx`:
   - Change `handleCreateTentacle`'s parameter list to add a trailing `todos: string[]`, and include `todos` in the POST body. (Full body below in Task 4 — for now just thread the arg through and add `todos` to the JSON.)
   - Add a temporary inline `onGenerateTodos={async () => []}` to the `<AddTentacleForm .../>` render so it type-checks. (Task 4 replaces it with the real handler.)

   Minimal change to `handleCreateTentacle`:
   ```ts
   const handleCreateTentacle = useCallback(
     async (
       name: string,
       description: string,
       color: string,
       octopus: OctopusAppearancePayload,
       suggestedSkills: string[],
       todos: string[],
     ) => {
       setIsCreating(true);
       setCreateError(null);
       try {
         const response = await fetch(buildDeckTentaclesUrl(), {
           method: "POST",
           headers: { "Content-Type": "application/json", Accept: "application/json" },
           body: JSON.stringify({ name, description, color, octopus, suggestedSkills, todos }),
         });
         // ...rest unchanged...
   ```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @octogent/web exec vitest run tests/add-tentacle-form.test.tsx`
Expected: PASS (all wizard tests). If `getByLabelText("Name"|"Description")` fails, the label/input association changed — restore the original `<label>` wrapping.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @octogent/web exec tsc --noEmit` (or `pnpm --filter @octogent/web build`) — expected: no errors.
```bash
git add apps/web/src/components/deck/AddTentacleForm.tsx apps/web/src/components/DeckPrimaryView.tsx apps/web/tests/add-tentacle-form.test.tsx
git commit -m "feat(web): turn Add Tentacle form into 3-step wizard with todos"
```

---

## Task 4: Wire generate-todos fetch + open-on-signal in `DeckPrimaryView`, and fix issue #4 in `App.tsx`

**Files:**
- Modify: `apps/web/src/components/DeckPrimaryView.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/tests/deck-add-form-open-signal.test.tsx` (new)

- [ ] **Step 1: Write the failing test for open-on-signal**

Create `apps/web/tests/deck-add-form-open-signal.test.tsx`. This mounts `DeckPrimaryView` with a stubbed `fetch` (empty tentacles + skills) and asserts that bumping `openAddFormSignal` opens the wizard (the Name field appears).

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeckPrimaryView } from "../src/components/DeckPrimaryView";

// DeckPrimaryView fetches tentacles + skills on mount. Return empty arrays.
const installFetchStub = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = url.includes("/skills") ? [] : [];
      return {
        ok: true,
        json: async () => body,
      } as Response;
    }),
  );
};

// Minimal props. Read DeckPrimaryView's prop type and fill required props with
// no-op stubs; only `openAddFormSignal` matters for this test. If the prop list
// is large, build a `baseProps` object of `() => {}` / sensible defaults.
const baseProps = {
  // FILL IN required props as no-ops — see DeckPrimaryView props type.
  onRefreshWorkspaceSetup: async () => {},
  openAddFormSignal: 0,
} as unknown as React.ComponentProps<typeof DeckPrimaryView>;

describe("DeckPrimaryView open-add-form signal", () => {
  beforeEach(installFetchStub);
  afterEach(() => vi.unstubAllGlobals());

  it("opens the wizard when openAddFormSignal increments", async () => {
    const { rerender } = render(<DeckPrimaryView {...baseProps} openAddFormSignal={0} />);
    // Wizard not open initially.
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    rerender(<DeckPrimaryView {...baseProps} openAddFormSignal={1} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
  });
});
```

> The implementer MUST read `DeckPrimaryView`'s full props type and populate `baseProps` with valid no-op values for every required prop (the `as unknown as` cast covers types, but missing callbacks invoked during render/mount will throw). If mounting `DeckPrimaryView` in jsdom proves impractical due to deep dependencies, fall back to asserting the behavior through the existing `app-shell-navigation.test.tsx` harness instead, or test the open-signal effect on a thin extracted hook — but prefer the direct mount. Document whichever path you took.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @octogent/web exec vitest run tests/deck-add-form-open-signal.test.tsx`
Expected: FAIL — `openAddFormSignal` not a prop / wizard does not open.

- [ ] **Step 3: Implement in `DeckPrimaryView`**

1. Add `openAddFormSignal?: number` to the `DeckPrimaryView` props type.
2. Destructure it in the component signature.
3. Add an effect that opens the wizard when the signal changes to a truthy value (skip the initial `0`):
```ts
useEffect(() => {
  if (openAddFormSignal && openAddFormSignal > 0) {
    setEmptyViewMode("adding");
  }
}, [openAddFormSignal]);
```
4. Add the real generate handler:
```ts
const handleGenerateTodos = useCallback(async (name: string, description: string) => {
  const response = await fetch(buildDeckGenerateTodosUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as { todos?: unknown } | null;
  if (!body || !Array.isArray(body.todos)) return [];
  return body.todos.filter((t): t is string => typeof t === "string");
}, []);
```
   Add the import: `buildDeckGenerateTodosUrl` from `../runtime/runtimeEndpoints` (match the existing import grouping of the other `buildDeck*` imports).
5. Replace the temporary `onGenerateTodos={async () => []}` on the `<AddTentacleForm .../>` render with `onGenerateTodos={handleGenerateTodos}`.

- [ ] **Step 4: Implement issue #4 in `App.tsx`**

1. Add state near the other UI state:
```ts
const [openDeckAddFormSignal, setOpenDeckAddFormSignal] = useState(0);
```
2. Replace the `onCreateTentacle` handler (lines ~558-566) with:
```ts
onCreateTentacle: () => {
  setActivePrimaryNav(2);
  setOpenDeckAddFormSignal((n) => n + 1);
},
```
   (`onCreateTentacle` in `CanvasPrimaryView` is typed `() => void`; an async wrapper is no longer needed. Confirm no caller awaits its return.)
3. In the `deckPrimaryViewProps={{ ... }}` object literal, add: `openAddFormSignal: openDeckAddFormSignal,`.

- [ ] **Step 5: Run tests + typecheck + lint**

Run, expecting all PASS:
- `pnpm --filter @octogent/web exec vitest run tests/deck-add-form-open-signal.test.tsx`
- `pnpm --filter @octogent/web test`
- `pnpm --filter @octogent/web build`
- `pnpm lint` (run `pnpm format` then re-lint if formatting is flagged)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/DeckPrimaryView.tsx apps/web/src/App.tsx apps/web/tests/deck-add-form-open-signal.test.tsx
git commit -m "feat(web): wire generate-todos + open wizard from canvas New Tentacle (issue #4)"
```

---

## Task 5: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full web + api suites + root build + lint**

Run, expecting all PASS:
- `pnpm --filter @octogent/web test`
- `pnpm --filter @octogent/api test`
- `pnpm build`
- `pnpm lint`

- [ ] **Step 2: Manual smoke (optional, needs claude installed)**

Start octogent from a project (`pnpm dev`). Then:
1. Deck → "Add Tentacle Manually" → wizard opens at Details. Enter a name + description → Next → step Todos.
2. Click "Generate from description" → within ~30s the checklist pre-fills (or shows the "couldn't generate — add manually" message). Edit / add / remove items. → Next → Tools. Pick a skill. → Create Tentacle.
3. Confirm a new deck card appears with a populated todo progress bar.
4. Go to the canvas, click "New Tentacle" → the app switches to the Deck view with the wizard already open. Confirm no 400 in the network tab.
5. Inspect `<project>/.octogent/tentacles/<name>/todo.md` → contains `- [ ] <todo>` lines.

- [ ] **Step 3: Report**

Summarize test counts, build/lint status, and the smoke result (or note claude unavailability).

---

## Self-review notes

- **Spec coverage** (`docs/superpowers/specs/2026-06-02-tentacle-ergonomics-design.md`, Part 2):
  - 3-step wizard (Details → Todos → Tools) → Task 3.
  - Generate todos via the Phase 2a endpoint, editable, manual always available, generation never blocks creation → Task 3 (form) + Task 4 (`handleGenerateTodos` returns `[]` on any failure; the wizard surfaces "add manually" and still lets you Create).
  - `createDeckTentacle` writes todos → done in Phase 2a; payload now carries `todos` → Tasks 3-4.
  - Both entry points open the wizard: deck "Add Tentacle Manually" (already opens it) + canvas "New Tentacle" / issue #4 → Task 4.
  - Duplicate-name error surfaced in the wizard → existing `createError` path, unchanged, still shown in the footer.
- **Type consistency:** `onSubmit(name, description, color, octopus, suggestedSkills, todos)` (6 args) used identically in `AddTentacleForm`, its test, and `handleCreateTentacle`. `onGenerateTodos(name, description) => Promise<string[]>` used identically in form, test, and `handleGenerateTodos`. `openAddFormSignal: number` prop matches `openDeckAddFormSignal` state. `buildDeckGenerateTodosUrl(runtimeBaseUrl?)` matches sibling builders.
- **Architecture:** the form is presentational (no fetch); network calls (`buildDeckTentaclesUrl`, `buildDeckGenerateTodosUrl`) live in the `DeckPrimaryView` container; App owns cross-view nav state. Matches the repo's container/component boundary.
- **Independence:** this plan touches only `apps/web` and is independent of Phase 1's rename edits, so `feat/guided-tentacle-creation` stays a clean topical branch for an upstream PR; it merges into `dirty` afterward.
