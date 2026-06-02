import { describe, expect, it } from "vitest";
import {
  applyDetectedTitle,
  createTitleScanner,
  isMeaningfulConversationTitle,
} from "../src/terminalRuntime/terminalTitle";

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
    for (const noise of [
      "",
      "claude",
      "zsh",
      "-zsh",
      "bash",
      "node",
      "/Users/x/dev/proj",
      "~/dev",
    ]) {
      expect(isMeaningfulConversationTitle(noise)).toBe(false);
    }
  });

  it("accepts a real conversation topic", () => {
    expect(isMeaningfulConversationTitle("Refactor auth flow")).toBe(true);
  });

  it("accepts a glyph-prefixed real Claude topic and strips the glyph", () => {
    expect(isMeaningfulConversationTitle("✳ Rename Python variable x to count")).toBe(true);
    expect(isMeaningfulConversationTitle("⠂ Rename Python variable x to count")).toBe(true);
  });

  it("rejects the glyph-prefixed default 'Claude Code' title", () => {
    expect(isMeaningfulConversationTitle("✳ Claude Code")).toBe(false);
    expect(isMeaningfulConversationTitle("⠐ Claude Code")).toBe(false);
  });
});

describe("applyDetectedTitle", () => {
  it("updates when origin is not user and the title is new", () => {
    expect(
      applyDetectedTitle({
        currentName: "Octogent Terminal 1",
        origin: "generated",
        title: "Refactor auth flow",
      }),
    ).toEqual({ changed: true, name: "Refactor auth flow", origin: "conversation" });
  });

  it("never overrides a user-set name", () => {
    expect(
      applyDetectedTitle({ currentName: "My name", origin: "user", title: "Refactor auth flow" }),
    ).toEqual({ changed: false });
  });

  it("ignores noise titles and no-op titles", () => {
    expect(applyDetectedTitle({ currentName: "x", origin: "prompt", title: "zsh" })).toEqual({
      changed: false,
    });
    expect(applyDetectedTitle({ currentName: "Same", origin: "prompt", title: "Same" })).toEqual({
      changed: false,
    });
  });

  it("strips the status glyph from the adopted name", () => {
    expect(
      applyDetectedTitle({
        currentName: "Octogent Terminal 1",
        origin: "generated",
        title: "✳ Rename Python variable x to count",
      }),
    ).toEqual({ changed: true, name: "Rename Python variable x to count", origin: "conversation" });
  });

  it("treats animation frames of the same topic as a no-op", () => {
    expect(
      applyDetectedTitle({
        currentName: "Rename Python variable x to count",
        origin: "conversation",
        title: "⠐ Rename Python variable x to count",
      }),
    ).toEqual({ changed: false });
  });
});
