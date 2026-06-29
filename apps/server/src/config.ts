import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Module dir. Uses import.meta.url under tsx/ESM (web mode); falls back to cwd
 * when bundled to CJS for Electron (where import.meta.url is undefined and these
 * paths are overridden by VBD_* env anyway).
 */
function moduleDir(): string {
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    /* ignore */
  }
  return process.cwd();
}

const __dirname = moduleDir();

/** Repo root in dev (apps/server/src -> ../../..). */
const repoRoot = path.resolve(__dirname, "../../..");

const isWindows = os.platform() === "win32";

function exe(name: string): string {
  return isWindows ? `${name}.exe` : name;
}

/**
 * Directory holding yt-dlp / ffmpeg / ffprobe.
 * - dev: <repoRoot>/bin
 * - packaged (Electron): set VBD_BIN_DIR to process.resourcesPath/bin
 */
export const BIN_DIR = process.env.VBD_BIN_DIR
  ? path.resolve(process.env.VBD_BIN_DIR)
  : path.join(repoRoot, "bin");

/** Writable app data dir (SQLite db + default downloads). */
export const DATA_DIR = process.env.VBD_DATA_DIR
  ? path.resolve(process.env.VBD_DATA_DIR)
  : path.join(repoRoot, "data");

export const DB_PATH = path.join(DATA_DIR, "app.db");
export const DEFAULT_DOWNLOAD_DIR = path.join(DATA_DIR, "downloads");

/**
 * Static web build (Next export) served by Fastify inside Electron.
 * - dev/web: <repoRoot>/apps/web/out (if built)
 * - packaged: set VBD_WEB_DIR to the bundled export path
 */
export const WEB_DIR = process.env.VBD_WEB_DIR
  ? path.resolve(process.env.VBD_WEB_DIR)
  : path.join(repoRoot, "apps", "web", "out");

export const YTDLP_PATH = path.join(BIN_DIR, exe("yt-dlp"));
export const FFMPEG_PATH = path.join(BIN_DIR, exe("ffmpeg"));
/** Passed to yt-dlp as --ffmpeg-location (a directory). */
export const FFMPEG_DIR = BIN_DIR;

/** Per-platform "best" engines (optional). Absent → registry falls back to yt-dlp. */
export const F2_PATH = path.join(BIN_DIR, exe("f2"));
export const BBDOWN_PATH = path.join(BIN_DIR, exe("BBDown"));

export const PORT = Number(process.env.VBD_PORT ?? process.env.PORT ?? 4319);
export const HOST = process.env.VBD_HOST ?? "127.0.0.1";

/** CORS origin for the Next.js dev server. */
export const WEB_ORIGIN = process.env.VBD_WEB_ORIGIN ?? "http://localhost:3000";

export function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });
}

export function ytdlpExists(): boolean {
  return fs.existsSync(YTDLP_PATH);
}

export function f2Exists(): boolean {
  return fs.existsSync(F2_PATH);
}

export function bbdownExists(): boolean {
  return fs.existsSync(BBDOWN_PATH);
}

export { isWindows };
