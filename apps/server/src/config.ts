import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export const YTDLP_PATH = path.join(BIN_DIR, exe("yt-dlp"));
export const FFMPEG_PATH = path.join(BIN_DIR, exe("ffmpeg"));
/** Passed to yt-dlp as --ffmpeg-location (a directory). */
export const FFMPEG_DIR = BIN_DIR;

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

export { isWindows };
