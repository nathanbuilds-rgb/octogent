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
    // Require a list marker: "- ", "* ", "1. ", or "1) ".
    const markerMatch = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.*)$/);
    if (!markerMatch) continue;
    // Strip an optional leading checkbox ("[ ]", "[x]", "[X]", "[]" or any single-char box).
    const text = (markerMatch[1] ?? "")
      .trim()
      .replace(/^\[[^\]]?\]\s*/, "")
      .trim();
    if (text.length === 0) continue;
    todos.push(text);
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
  if (!binary) return [];
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
