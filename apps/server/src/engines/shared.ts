import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YTDLP_PATH, isWindows } from "../config.js";
import type { CookieConfig } from "../ytdlp.js";

/**
 * Helpers shared by every download/scan engine (yt-dlp, f2, BBDown). Kept here so
 * each engine spawns child processes, parses progress, and resolves cookies the
 * same way — `ytdlp.ts` imports these too so behaviour stays identical.
 */

/** Kill a process and (on Windows) its whole child tree (ffmpeg, PyInstaller child, …). */
export function killTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid == null) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

/* ------------------------------- progress ---------------------------------- */

/** Marker an engine prints on stdout so we can pick progress lines out of noise. */
export const PROGRESS_PREFIX = "vbdprog:";

function parsePercent(s: string): number | null {
  const m = s.match(/([\d.]+)\s*%/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a progress field, mapping "N/A"/"Unknown" placeholders to null. */
function cleanField(s: string): string | null {
  const t = s.trim();
  if (!t || t === "N/A" || /unknown/i.test(t)) return null;
  return t;
}

export interface ProgressLine {
  pct: number | null;
  speed: string | null;
  eta: string | null;
}

/**
 * Parse a `vbdprog:<pct>%|<speed>|<eta>` line. Returns null for lines without the
 * prefix so callers can keep handling other stdout (e.g. the final file path).
 */
export function parseProgressLine(line: string): ProgressLine | null {
  const idx = line.indexOf(PROGRESS_PREFIX);
  if (idx === -1) return null;
  const payload = line.slice(idx + PROGRESS_PREFIX.length);
  const [pctStr = "", speedStr = "", etaStr = ""] = payload.split("|");
  return { pct: parsePercent(pctStr), speed: cleanField(speedStr), eta: cleanField(etaStr) };
}

/* -------------------------------- cookies ---------------------------------- */

export interface CookieFile {
  /** A cookies.txt path to hand to an engine that only accepts a file, or null. */
  path: string | null;
  /** Remove any temp file created for this resolution (no-op for file mode). */
  cleanup: () => void;
}

const noop = (): void => {};

/**
 * Resolve a {@link CookieConfig} down to a cookies.txt path for engines (f2,
 * BBDown) that only accept a file:
 *  - file mode    → the user's path as-is
 *  - browser mode → export the full browser jar via yt-dlp into a temp file
 *  - none         → { path: null }
 *
 * `urlHint` is the URL yt-dlp runs against while exporting (it still dumps the
 * complete jar, so any reachable URL on the right site works). Caller MUST call
 * `cleanup()` once the engine process has exited.
 */
export async function materializeCookieFile(
  cookies: CookieConfig,
  urlHint: string,
): Promise<CookieFile> {
  if (cookies.cookieMode === "file" && cookies.cookieFilePath) {
    return { path: cookies.cookieFilePath, cleanup: noop };
  }
  if (cookies.cookieMode === "browser" && cookies.cookieBrowser) {
    const tmp = path.join(os.tmpdir(), `vbd-cookies-${process.pid}-${Date.now()}.txt`);
    await new Promise<void>((resolve) => {
      const child = spawn(
        YTDLP_PATH,
        [
          "--cookies-from-browser",
          cookies.cookieBrowser!,
          "--cookies",
          tmp,
          "--simulate",
          "--no-warnings",
          "--ignore-errors",
          urlHint,
        ],
        { windowsHide: true },
      );
      child.on("error", () => resolve());
      child.on("close", () => resolve());
    });
    const ok = fs.existsSync(tmp) && fs.statSync(tmp).size > 0;
    const cleanup = () => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    };
    return ok ? { path: tmp, cleanup } : { path: null, cleanup };
  }
  return { path: null, cleanup: noop };
}
