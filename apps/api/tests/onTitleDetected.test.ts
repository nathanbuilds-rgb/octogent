import { describe, expect, it, vi } from "vitest";
import { applyDetectedTitle } from "../src/terminalRuntime/terminalTitle";

// Mirrors the terminalRuntime.ts onTitleDetected handler: applyDetectedTitle gate + registry mutation.
const makeHandler = (
  terminal: { tentacleName: string; nameOrigin?: string },
  persist: () => void,
) => {
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
