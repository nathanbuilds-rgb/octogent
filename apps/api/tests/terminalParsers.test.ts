import { describe, expect, it } from "vitest";
import { parseTerminalNameOrigin } from "../src/createApiServer/terminalParsers";

describe("parseTerminalNameOrigin", () => {
  it("accepts the conversation origin", () => {
    expect(parseTerminalNameOrigin({ nameOrigin: "conversation" })).toEqual({
      nameOrigin: "conversation",
      error: null,
    });
  });

  it("ignores unknown origins", () => {
    expect(parseTerminalNameOrigin({ nameOrigin: "bogus" })).toEqual({
      nameOrigin: undefined,
      error: "Terminal name origin must be 'generated', 'user', 'prompt', or 'conversation'.",
    });
  });
});
