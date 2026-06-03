# Guided Tentacle Creation — Backend (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend foundation for a guided "Add Tentacle" flow: persist operator-provided todos into a new tentacle's `todo.md`, and add an endpoint that generates a draft todo list from a description via a headless `claude -p` call.

**Architecture:** Extend `createDeckTentacle` + the `POST /api/deck/tentacles` route to accept an optional `todos: string[]`, written into `todo.md` as a Markdown checklist (via a pure `buildTodoMarkdown` helper). Add a self-contained `generateTodos` module that resolves the `claude` binary and runs one isolated, non-interactive `claude -p "<prompt>"` (print mode, `execFile` — no PTY), then parses the output into clean task strings. Expose it as `POST /api/deck/tentacles/generate-todos`. The frontend wizard (Phase 2b) consumes these.

**Tech Stack:** TypeScript, Node HTTP server (`apps/api`), `node:child_process` execFile, Vitest, Biome.

**Why self-contained:** This branch (`feat/guided-tentacle-creation`) is off `main` for a clean upstream PR. It deliberately does NOT import from `claudeUsage.ts` (which differs on the usage-scraper branch) — it duplicates two tiny helpers (`which claude`, env scrub) to avoid a merge conflict and keep the PR independent. The generation prompt is an inline constant (no `prompts/` template / no `promptsDir` plumbing into the route).

**Verify commands:** `pnpm --filter @octogent/api exec vitest run <file>`; full api suite `pnpm --filter @octogent/api test`; typecheck `pnpm --filter @octogent/api build`; lint `pnpm lint`.

---

## Task 1: Persist todos into a new tentacle's `todo.md`

**Files:**
- Modify: `apps/api/src/deck/readDeckTentacles.ts` (`CreateDeckTentacleInput` ~line 468; `createDeckTentacle` ~line 480, the `todo.md` write at ~line 509, and the returned summary ~line 521-538)
- Modify: `apps/api/src/createApiServer/deckRoutes.ts` (`POST /api/deck/tentacles` handler ~line 86)
- Test: `apps/api/tests/buildTodoMarkdown.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `apps/api/tests/buildTodoMarkdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTodoMarkdown } from "../src/deck/readDeckTentacles";

describe("buildTodoMarkdown", () => {
  it("renders an empty header when there are no todos", () => {
    expect(buildTodoMarkdown([])).toBe("# Todo\n");
  });

  it("renders each todo as an unchecked checklist item", () => {
    expect(buildTodoMarkdown(["inspect reconnect path", "add regression test"])).toBe(
      "# Todo\n- [ ] inspect reconnect path\n- [ ] add regression test\n",
    );
  });

  it("trims and drops blank entries", () => {
    expect(buildTodoMarkdown(["  keep  ", "", "   "])).toBe("# Todo\n- [ ] keep\n");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @octogent/api exec vitest run tests/buildTodoMarkdown.test.ts`
Expected: FAIL — `buildTodoMarkdown` is not exported.

- [ ] **Step 3: Add the pure helper and use it in `createDeckTentacle`**

In `apps/api/src/deck/readDeckTentacles.ts`, add this exported helper near `parseTodoProgress`:

```ts
/** Build a todo.md body from plain task strings (unchecked checklist items). */
export const buildTodoMarkdown = (todos: string[]): string => {
  const cleaned = todos.map((todo) => todo.trim()).filter((todo) => todo.length > 0);
  if (cleaned.length === 0) {
    return "# Todo\n";
  }
  return `# Todo\n${cleaned.map((todo) => `- [ ] ${todo}`).join("\n")}\n`;
};
```

Extend `CreateDeckTentacleInput` (currently lines 468-474) to add `todos`:

```ts
type CreateDeckTentacleInput = {
  name: string;
  description: string;
  color: string;
  octopus: DeckOctopusAppearance;
  suggestedSkills?: string[];
  todos?: string[];
};
```

In `createDeckTentacle`, replace the `todo.md` write line:
```ts
  writeFileSync(join(tentacleDir, "todo.md"), "# Todo\n");
```
with:
```ts
  const todos = (input.todos ?? []).map((todo) => todo.trim()).filter((todo) => todo.length > 0);
  writeFileSync(join(tentacleDir, "todo.md"), buildTodoMarkdown(todos));
```

In the returned `tentacle` summary (currently `todoTotal: 0, todoDone: 0, todoItems: []`), reflect the created todos:
```ts
      todoTotal: todos.length,
      todoDone: 0,
      todoItems: todos.map((text) => ({ text, done: false })),
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @octogent/api exec vitest run tests/buildTodoMarkdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Parse `todos` in the POST route**

In `apps/api/src/createApiServer/deckRoutes.ts`, inside the `POST` block of `handleDeckTentaclesRoute` (after the `suggestedSkills` parse, ~line 95), add:

```ts
    const todos =
      body && Array.isArray(body.todos)
        ? body.todos.filter((todo): todo is string => typeof todo === "string")
        : [];
```
and pass it into the create call:
```ts
    const result = createDeckTentacle(
      workspaceCwd,
      { name, description, color, octopus, suggestedSkills, todos },
      projectStateDir,
    );
```

- [ ] **Step 6: Run full api tests + typecheck + lint**

Run: `pnpm --filter @octogent/api test` then `pnpm --filter @octogent/api build` then `pnpm lint`
Expected: all PASS; no Biome errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/deck/readDeckTentacles.ts apps/api/src/createApiServer/deckRoutes.ts apps/api/tests/buildTodoMarkdown.test.ts
git commit -m "feat(deck): persist provided todos into new tentacle's todo.md"
```

---

## Task 2: `generateTodos` module (parser + headless `claude -p` call)

**Files:**
- Create: `apps/api/src/deck/generateTodos.ts`
- Test: `apps/api/tests/generateTodos.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/generateTodos.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { generateTodosFromDescription, parseGeneratedTodos } from "../src/deck/generateTodos";

describe("parseGeneratedTodos", () => {
  it("extracts checklist items, stripping the marker and checkbox", () => {
    const raw = "- [ ] First task\n- [ ] Second task\n";
    expect(parseGeneratedTodos(raw)).toEqual(["First task", "Second task"]);
  });

  it("handles bullets and numbered lists, ignoring prose", () => {
    const raw = "Here is your plan:\n* Do the thing\n- Another thing\n1. Numbered thing\nThanks!";
    expect(parseGeneratedTodos(raw)).toEqual(["Do the thing", "Another thing", "Numbered thing"]);
  });

  it("returns [] for output with no list items", () => {
    expect(parseGeneratedTodos("I could not determine any tasks.")).toEqual([]);
  });

  it("caps the number of todos at 20", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `- [ ] task ${i}`).join("\n");
    expect(parseGeneratedTodos(raw)).toHaveLength(20);
  });
});

describe("generateTodosFromDescription", () => {
  it("returns [] when the claude binary is not found", async () => {
    const todos = await generateTodosFromDescription("auth", "build auth", {
      resolveBinary: () => null,
    });
    expect(todos).toEqual([]);
  });

  it("runs the binary and parses its stdout", async () => {
    const run = vi.fn().mockResolvedValue("- [ ] task one\n- [ ] task two\n");
    const todos = await generateTodosFromDescription("auth", "build auth", {
      resolveBinary: () => "/usr/bin/claude",
      run,
    });
    expect(todos).toEqual(["task one", "task two"]);
    expect(run).toHaveBeenCalledOnce();
    const [binary, args] = run.mock.calls[0];
    expect(binary).toBe("/usr/bin/claude");
    expect(args).toContain("-p");
    expect(args).toContain("--strict-mcp-config");
    expect(args.join(" ")).toContain("disableAllHooks");
  });

  it("returns [] when the run throws (timeout / claude error)", async () => {
    const run = vi.fn().mockRejectedValue(new Error("timeout"));
    const todos = await generateTodosFromDescription("auth", "build auth", {
      resolveBinary: () => "/usr/bin/claude",
      run,
    });
    expect(todos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @octogent/api exec vitest run tests/generateTodos.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/api/src/deck/generateTodos.ts`:

```ts
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GENERATE_TIMEOUT_MS = 60_000;
const MAX_TODOS = 20;
const MAX_OUTPUT_BYTES = 1_000_000;

// Resolve the claude binary the same lightweight way the usage probe does.
// Duplicated (not imported) to keep this branch independent of claudeUsage.ts.
const resolveClaudeBinary = (): string | null => {
  try {
    const result = execFileSync("which", ["claude"], { timeout: 3_000, encoding: "utf8" }).trim();
    return result || null;
  } catch {
    return null;
  }
};

// Strip CLAUDECODE/ANTHROPIC_* so the probe runs as a clean, isolated session.
const scrubbedEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "CLAUDECODE") continue;
    if (key.startsWith("ANTHROPIC_")) continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
};

const buildPrompt = (name: string, description: string): string =>
  [
    "You are scoping a focused engineering task list for a work unit.",
    name ? `Work unit name: ${name}` : "",
    `Description: ${description}`,
    "",
    "Output ONLY a Markdown checklist of concrete, actionable todos — one per line as",
    '"- [ ] <task>". No preamble, no commentary, no headings. Keep it under 12 items.',
  ]
    .filter((line) => line.length > 0)
    .join("\n");

/** Parse a claude response into clean task strings (markers/checkboxes stripped). */
export const parseGeneratedTodos = (raw: string): string[] => {
  const todos: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    // Accept "- [ ] x", "- [x] x", "- x", "* x", "1. x", "1) x"
    const match = trimmed.match(/^(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/);
    if (!match) continue;
    const text = (match[1] ?? "").trim();
    if (text.length > 0) {
      todos.push(text);
    }
    if (todos.length >= MAX_TODOS) break;
  }
  return todos;
};

export type GenerateTodosDeps = {
  resolveBinary?: () => string | null;
  run?: (binary: string, args: string[]) => Promise<string>;
};

/**
 * Generate a draft todo list from a description by running one isolated,
 * non-interactive `claude -p` (print mode). Best-effort: returns [] on any
 * failure (binary missing, timeout, claude error) — never throws.
 */
export const generateTodosFromDescription = async (
  name: string,
  description: string,
  deps: GenerateTodosDeps = {},
): Promise<string[]> => {
  const binary = (deps.resolveBinary ?? resolveClaudeBinary)();
  if (!binary) {
    return [];
  }
  const args = [
    "-p",
    buildPrompt(name, description),
    "--strict-mcp-config",
    "--settings",
    '{"disableAllHooks":true}',
  ];
  try {
    const stdout = deps.run
      ? await deps.run(binary, args)
      : (
          await execFileAsync(binary, args, {
            timeout: GENERATE_TIMEOUT_MS,
            env: scrubbedEnv(),
            maxBuffer: MAX_OUTPUT_BYTES,
            encoding: "utf8",
          })
        ).stdout;
    return parseGeneratedTodos(stdout);
  } catch {
    return [];
  }
};
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @octogent/api exec vitest run tests/generateTodos.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @octogent/api build` then `pnpm lint`
Expected: clean. (If Biome flags the regex character class, keep behavior identical.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/deck/generateTodos.ts apps/api/tests/generateTodos.test.ts
git commit -m "feat(deck): generate draft todos from a description via headless claude -p"
```

---

## Task 3: `POST /api/deck/tentacles/generate-todos` route

**Files:**
- Modify: `apps/api/src/createApiServer/deckRoutes.ts` (add handler + import)
- Modify: `apps/api/src/createApiServer/requestHandler.ts` (register handler BEFORE `handleDeckTentacleItemRoute`)
- Test: `apps/api/tests/deckGenerateTodosRoute.test.ts`

- [ ] **Step 1: Write the failing test (validation path, no claude spawn)**

Create `apps/api/tests/deckGenerateTodosRoute.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleDeckGenerateTodosRoute } from "../src/createApiServer/deckRoutes";

// Minimal fake ServerResponse capturing status + JSON body.
const makeResponse = () => {
  const res: {
    statusCode?: number;
    body?: unknown;
    writeHead: (status: number, headers?: unknown) => typeof res;
    end: (chunk?: string) => void;
  } = {
    writeHead(status) {
      res.statusCode = status;
      return res;
    },
    end(chunk) {
      res.body = chunk ? JSON.parse(chunk) : undefined;
    },
  };
  return res;
};

const makeRequest = (method: string, jsonBody: unknown) => {
  const body = JSON.stringify(jsonBody);
  // Async-iterable request stub for readJsonBody.
  return {
    method,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
  } as never;
};

describe("handleDeckGenerateTodosRoute", () => {
  it("returns false for a non-matching path", async () => {
    const handled = await handleDeckGenerateTodosRoute(
      {
        request: makeRequest("POST", {}),
        response: makeResponse() as never,
        requestUrl: new URL("http://x/api/deck/tentacles"),
        corsOrigin: null,
      },
      { workspaceCwd: "/tmp" } as never,
    );
    expect(handled).toBe(false);
  });

  it("400s when description is missing", async () => {
    const res = makeResponse();
    const handled = await handleDeckGenerateTodosRoute(
      {
        request: makeRequest("POST", { name: "auth" }),
        response: res as never,
        requestUrl: new URL("http://x/api/deck/tentacles/generate-todos"),
        corsOrigin: null,
      },
      { workspaceCwd: "/tmp" } as never,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });
});
```

> Note: confirm `readJsonBody`'s exact stream contract by reading `routeHelpers.ts`; if it reads via `request.on("data"/"end")` rather than async-iteration, adapt `makeRequest` to an `EventEmitter`-style stub (emit `data` then `end`). The assertion (path miss → false; missing description → 400) is what matters.

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @octogent/api exec vitest run tests/deckGenerateTodosRoute.test.ts`
Expected: FAIL — `handleDeckGenerateTodosRoute` not exported.

- [ ] **Step 3: Add the route handler**

In `apps/api/src/createApiServer/deckRoutes.ts`, add to the imports from `../deck/readDeckTentacles`'s sibling — actually import from the new module:
```ts
import { generateTodosFromDescription } from "../deck/generateTodos";
```
Add the handler (place it near `handleDeckTentaclesRoute`):
```ts
const DECK_GENERATE_TODOS_PATH = "/api/deck/tentacles/generate-todos";

export const handleDeckGenerateTodosRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  _deps,
) => {
  if (requestUrl.pathname !== DECK_GENERATE_TODOS_PATH) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) return true;

  const body = bodyReadResult.payload as Record<string, unknown> | null;
  const description =
    body && typeof body.description === "string" ? body.description.trim() : "";
  const name = body && typeof body.name === "string" ? body.name : "";
  if (description.length === 0) {
    writeJson(response, 400, { error: "description (non-empty string) is required" }, corsOrigin);
    return true;
  }

  const todos = await generateTodosFromDescription(name, description);
  writeJson(response, 200, { todos }, corsOrigin);
  return true;
};
```
(`generateTodosFromDescription` already swallows its own errors and returns `[]`, so the route never needs a try/catch — an empty `todos` array is the graceful "couldn't generate" signal the UI handles.)

- [ ] **Step 4: Register the route BEFORE the item route**

In `apps/api/src/createApiServer/requestHandler.ts`: add `handleDeckGenerateTodosRoute` to the import block from `./deckRoutes`, and insert it into the `"deck"` array in `API_ROUTE_MAP` **immediately after `handleDeckTentaclesRoute` and before `handleDeckTentacleItemRoute`**:
```ts
    "deck",
    [
      handleDeckSkillsRoute,
      handleDeckTentaclesRoute,
      handleDeckGenerateTodosRoute,
      handleDeckTentacleItemRoute,
      // ...rest unchanged
    ],
```
This ordering is REQUIRED: `handleDeckTentacleItemRoute` matches `/api/deck/tentacles/{id}` and would otherwise treat `generate-todos` as a tentacle id and return 405 for the POST.

- [ ] **Step 5: Run tests, verify pass + typecheck + lint**

Run: `pnpm --filter @octogent/api exec vitest run tests/deckGenerateTodosRoute.test.ts` then `pnpm --filter @octogent/api test` then `pnpm --filter @octogent/api build` then `pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/createApiServer/deckRoutes.ts apps/api/src/createApiServer/requestHandler.ts apps/api/tests/deckGenerateTodosRoute.test.ts
git commit -m "feat(deck): POST /api/deck/tentacles/generate-todos endpoint"
```

---

## Task 4: Manual end-to-end smoke (optional, needs claude installed)

- [ ] **Step 1:** Start octogent from a project, then:
```bash
curl -s -X POST http://127.0.0.1:8787/api/deck/tentacles/generate-todos \
  -H 'Content-Type: application/json' \
  -d '{"name":"auth","description":"Add password reset via email with token expiry"}'
```
Expect `{ "todos": ["...", "..."] }` within ~30s (or `{ "todos": [] }` if claude is unavailable — graceful).

- [ ] **Step 2:** Create a tentacle with todos and confirm `todo.md`:
```bash
curl -s -X POST http://127.0.0.1:8787/api/deck/tentacles \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke-test","description":"d","todos":["first","second"]}'
cat <project>/.octogent/tentacles/smoke-test/todo.md   # → "# Todo\n- [ ] first\n- [ ] second\n"
```
Then delete the smoke-test tentacle folder + deck-state entry.

---

## Self-review notes

- **Spec coverage:** "generate todos from description via headless `claude -p`" → Task 2 + Task 3; "createDeckTentacle accepts todos[] → write to todo.md" → Task 1. (Frontend wizard + issue #4 rewire are Phase 2b, a separate plan.)
- **Type consistency:** `generateTodosFromDescription(name, description, deps?)` and `parseGeneratedTodos(raw): string[]` used identically across tasks/tests; `buildTodoMarkdown(todos: string[]): string`; `CreateDeckTentacleInput.todos?: string[]`; route returns `{ todos: string[] }`.
- **Isolation:** duplicates `resolveClaudeBinary`/`scrubbedEnv` (≈10 lines) rather than importing from `claudeUsage.ts`, so this branch merges cleanly into `dirty` (which has a modified `claudeUsage.ts`) without conflict and PRs to upstream independently. The `--strict-mcp-config --settings '{"disableAllHooks":true}'` flags match the isolation hardening proven in the usage-scraper fix.
- **Graceful failure:** generation never throws; `[]` is the "couldn't generate, enter manually" signal Phase 2b surfaces.
