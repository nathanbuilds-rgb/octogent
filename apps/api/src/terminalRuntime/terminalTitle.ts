import type { TerminalNameOrigin } from "./types";

const BEL = "\x07";
const ESC = "\x1b";
// OSC title set: ESC ] (0|1|2) ; <title> (BEL | ESC \)
// Build the regex dynamically to avoid literal control characters in the regex literal,
// which Biome's noControlCharactersInRegex rule disallows.
const OSC_TITLE_RE = new RegExp(
  `${ESC}\\][012];([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`,
  "g",
);
const MAX_CARRY = 4096; // cap the cross-chunk buffer so a runaway stream can't grow unbounded

/**
 * Stateful scanner that extracts terminal-title strings (OSC 0/1/2) from a PTY
 * byte stream. Handles sequences split across chunks by carrying an unterminated
 * tail. Never throws.
 */
export const createTitleScanner = (): ((chunk: string) => string[]) => {
  let carry = "";
  return (chunk: string): string[] => {
    const buffer = carry + chunk;
    const titles: string[] = [];
    OSC_TITLE_RE.lastIndex = 0;
    let lastEnd = 0;
    for (
      let match = OSC_TITLE_RE.exec(buffer);
      match !== null;
      match = OSC_TITLE_RE.exec(buffer)
    ) {
      titles.push(match[1] ?? "");
      lastEnd = OSC_TITLE_RE.lastIndex;
    }
    // Keep any trailing partial title-open sequence for the next chunk.
    const lastOpen = buffer.lastIndexOf(`${ESC}]`);
    if (lastOpen >= lastEnd) {
      carry = buffer.slice(lastOpen).slice(0, MAX_CARRY);
    } else {
      carry = "";
    }
    return titles;
  };
};

const NOISE_NAMES = new Set([
  "",
  "claude",
  "zsh",
  "-zsh",
  "bash",
  "-bash",
  "sh",
  "fish",
  "node",
]);

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
