import type { TerminalNameOrigin } from "./types";

const BEL = "\x07";
const ESC = "\x1b";
const MAX_CARRY = 4096; // cap the cross-chunk buffer so a runaway stream can't grow unbounded

/**
 * Stateful scanner that extracts terminal-title strings (OSC 0/1/2) from a PTY
 * byte stream. Handles sequences split across chunks by carrying an unterminated
 * tail. Never throws.
 */
export const createTitleScanner = (): ((chunk: string) => string[]) => {
  // Per-instance regex: the `g` flag makes exec() stateful via lastIndex, so each
  // scanner must own its own RegExp to avoid cross-instance state corruption.
  const titleRe = new RegExp(`${ESC}\\][012];([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`, "g");
  let carry = "";
  return (chunk: string): string[] => {
    const buffer = carry + chunk;
    const titles: string[] = [];
    titleRe.lastIndex = 0;
    let lastEnd = 0;
    for (let match = titleRe.exec(buffer); match !== null; match = titleRe.exec(buffer)) {
      titles.push(match[1] ?? "");
      lastEnd = titleRe.lastIndex;
    }
    // Keep any trailing partial title-open sequence for the next chunk.
    const lastOpen = buffer.lastIndexOf(`${ESC}]`);
    carry = lastOpen >= lastEnd ? buffer.slice(lastOpen).slice(0, MAX_CARRY) : "";
    return titles;
  };
};

const NOISE_NAMES = new Set(["", "claude", "zsh", "-zsh", "bash", "-bash", "sh", "fish", "node"]);

/**
 * Heuristic: is this terminal title a real conversation topic worth adopting as
 * the tentacle name, vs. shell/program noise or a path?
 *
 * NOTE: tune against a captured live Claude session before finalizing.
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
