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
