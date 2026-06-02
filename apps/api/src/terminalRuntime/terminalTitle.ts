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

const NOISE_NAMES = new Set([
  "",
  "claude",
  "claude code",
  "zsh",
  "-zsh",
  "bash",
  "-bash",
  "sh",
  "fish",
  "node",
]);

// Claude prefixes the terminal title with an animated status glyph (e.g. "✳ " or
// braille spinner frames "⠂ "/"⠐ "). Strip the leading glyph run so the adopted name
// is the STABLE topic text, not a per-frame string. Targeted set on purpose: it must
// not strip "/" or "~" (those still mark a path title to reject).
const STATUS_PREFIX_RE = /^[\s⠀-⣿✳✴✻✽❖⏺•·●]+/u;
const normalizeTitle = (title: string): string => title.replace(STATUS_PREFIX_RE, "").trim();

/**
 * Heuristic: is this terminal title a real conversation topic worth adopting as
 * the tentacle name, vs. shell/program noise or a path?
 *
 * Normalizes away Claude's animated status-glyph prefix before applying checks,
 * so the same topic with different spinner frames is treated identically.
 */
export const isMeaningfulConversationTitle = (title: string): boolean => {
  const trimmed = normalizeTitle(title);
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
  if (!isMeaningfulConversationTitle(title)) return { changed: false };
  const cleaned = normalizeTitle(title);
  if (cleaned === currentName) return { changed: false };
  return { changed: true, name: cleaned, origin: "conversation" };
};
