import { describe, expect, it, vi } from "vitest";
import { generateTodosFromDescription, parseGeneratedTodos } from "../src/deck/generateTodos";

describe("parseGeneratedTodos", () => {
  it("extracts checklist items, stripping the marker and checkbox", () => {
    expect(parseGeneratedTodos("- [ ] First task\n- [ ] Second task\n")).toEqual([
      "First task",
      "Second task",
    ]);
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
    expect(
      await generateTodosFromDescription("auth", "build auth", { resolveBinary: () => null }),
    ).toEqual([]);
  });
  it("runs the binary and parses its stdout", async () => {
    const run = vi.fn().mockResolvedValue("- [ ] task one\n- [ ] task two\n");
    const todos = await generateTodosFromDescription("auth", "build auth", {
      resolveBinary: () => "/usr/bin/claude",
      run,
    });
    expect(todos).toEqual(["task one", "task two"]);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe("/usr/bin/claude");
    const args: string[] = run.mock.calls[0]?.[1] ?? [];
    expect(args).toContain("-p");
    expect(args).toContain("--strict-mcp-config");
    expect(args.join(" ")).toContain("disableAllHooks");
  });
  it("returns [] when the run throws (timeout / claude error)", async () => {
    const run = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(
      await generateTodosFromDescription("auth", "build auth", {
        resolveBinary: () => "/usr/bin/claude",
        run,
      }),
    ).toEqual([]);
  });
});
