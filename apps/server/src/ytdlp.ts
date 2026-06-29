import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import type { CookieBrowser, CookieMode, Platform, Quality } from "@vbd/shared";
import { FFMPEG_DIR, YTDLP_PATH } from "./config.js";
import { throttleArgs } from "./ratelimit.js";
import { killTree, parseProgressLine, PROGRESS_PREFIX } from "./engines/shared.js";

/** Cookie configuration extracted from a job. */
export interface CookieConfig {
  cookieMode: CookieMode;
  cookieBrowser: CookieBrowser | null;
  cookieFilePath: string | null;
}

function cookieArgs(c: CookieConfig): string[] {
  if (c.cookieMode === "browser" && c.cookieBrowser) {
    return ["--cookies-from-browser", c.cookieBrowser];
  }
  if (c.cookieMode === "file" && c.cookieFilePath) {
    return ["--cookies", c.cookieFilePath];
  }
  return [];
}

/**
 * yt-dlp 2026+ needs a JS runtime for full YouTube extraction (Deno by default).
 * We point it at Node: explicitly at our own node binary in dev, overridable via
 * VBD_JS_RUNTIME for the packaged build (e.g. a bundled deno/node).
 */
function jsRuntimeArgs(): string[] {
  const override = process.env.VBD_JS_RUNTIME;
  if (override) return ["--js-runtimes", override];
  const exe = process.execPath;
  if (/node(\.exe)?$/i.test(exe)) return ["--js-runtimes", `node:${exe}`];
  return ["--js-runtimes", "node"];
}

/* -------------------------------- version ---------------------------------- */

export async function getVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let errored = false;
    const child = spawn(YTDLP_PATH, ["--version"], { windowsHide: true });
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => {
      errored = true;
      resolve(null);
    });
    child.on("close", (code) => {
      if (errored) return;
      resolve(code === 0 ? out.trim() || null : null);
    });
  });
}

export async function updateYtDlp(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(YTDLP_PATH, ["-U"], { windowsHide: true });
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (e) => resolve({ ok: false, output: String(e) }));
    child.on("close", (code) => resolve({ ok: code === 0, output: out.trim() }));
  });
}

/* ---------------------------------- scan ----------------------------------- */

export interface ScanEntry {
  sourceId: string;
  title: string;
  webpageUrl: string;
  thumbnailUrl: string | null;
  duration: number | null;
  uploader: string | null;
  platform: Platform;
}

function pickThumbnail(j: any, platform: Platform, id: string): string | null {
  if (typeof j.thumbnail === "string" && j.thumbnail) return j.thumbnail;
  if (Array.isArray(j.thumbnails) && j.thumbnails.length > 0) {
    const last = j.thumbnails[j.thumbnails.length - 1];
    if (last?.url) return last.url as string;
  }
  if (platform === "youtube" && id) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  return null;
}

function buildWebpageUrl(j: any, platform: Platform, id: string): string {
  if (typeof j.webpage_url === "string" && j.webpage_url) return j.webpage_url;
  if (typeof j.url === "string" && /^https?:\/\//.test(j.url)) return j.url;
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${id}`;
    case "bilibili":
      return `https://www.bilibili.com/video/${id}`;
    default:
      return j.url ?? id;
  }
}

const SMUGGLE_MARK = "#__youtubedl_smuggle=";

/**
 * Some extractors (e.g. bilibili.tv) append yt-dlp-internal "smuggled" JSON to the
 * entry URL as a fragment. Strip it for a clean, linkable URL and recover the
 * thumbnail/title it carries (the flat entry's own thumbnail field is often null).
 */
function splitSmuggle(u: string): { url: string; data: Record<string, any> | null } {
  const i = u.indexOf(SMUGGLE_MARK);
  if (i === -1) return { url: u, data: null };
  const clean = u.slice(0, i);
  try {
    const enc = u.slice(i + SMUGGLE_MARK.length).replace(/\+/g, " ");
    return { url: clean, data: JSON.parse(decodeURIComponent(enc)) };
  } catch {
    return { url: clean, data: null };
  }
}

function extractorToPlatform(j: any, fallback: Platform): Platform {
  const key = String(j.ie_key ?? j.extractor_key ?? j.extractor ?? "").toLowerCase();
  if (key.includes("youtube")) return "youtube";
  if (key.includes("douyin")) return "douyin";
  if (key.includes("tiktok")) return "tiktok";
  if (key.includes("bili")) return "bilibili";
  return fallback;
}

export interface ScanHandle {
  promise: Promise<{ count: number }>;
  cancel: () => void;
}

/**
 * Enumerate a channel/playlist/video URL. Streams one entry at a time via
 * `onEntry` (parsed from `--flat-playlist --dump-json`, one JSON per line).
 */
export function scan(
  url: string,
  platform: Platform,
  cookies: CookieConfig,
  onEntry: (entry: ScanEntry, index: number) => void,
  limit?: number,
): ScanHandle {
  const args = [
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--ignore-errors",
    "--no-progress",
    ...(limit && limit > 0 ? ["--playlist-end", String(limit)] : []),
    ...throttleArgs(platform, "scan"),
    ...jsRuntimeArgs(),
    ...cookieArgs(cookies),
    url,
  ];

  const child = spawn(YTDLP_PATH, args, { windowsHide: true });
  let index = 0;
  let stderr = "";

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let j: any;
    try {
      j = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (j._type === "playlist") return; // container object, skip
    const id = String(j.id ?? "");
    if (!id) return;
    const p = extractorToPlatform(j, platform);
    const { url: webpageUrl, data: smuggled } = splitSmuggle(buildWebpageUrl(j, p, id));
    onEntry(
      {
        sourceId: id,
        title: String(j.title ?? j.fulltitle ?? smuggled?.title ?? id),
        webpageUrl,
        thumbnailUrl: pickThumbnail(j, p, id) ?? smuggled?.thumbnail ?? null,
        duration:
          typeof j.duration === "number"
            ? j.duration
            : typeof smuggled?.duration === "number"
              ? smuggled.duration
              : null,
        uploader: j.uploader ?? j.channel ?? j.uploader_id ?? null,
        platform: p,
      },
      index++,
    );
  });

  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  const promise = new Promise<{ count: number }>((resolve, reject) => {
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      rl.close();
      // yt-dlp returns non-zero when some entries failed; tolerate if we got any.
      if (index > 0 || code === 0) {
        resolve({ count: index });
      } else {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });

  return { promise, cancel: () => killTree(child) };
}

/* -------------------------------- download --------------------------------- */

const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s`;

export interface DownloadCallbacks {
  onProgress: (progress: number, speed: string | null, eta: string | null) => void;
  onFilePath?: (filePath: string) => void;
}

export interface DownloadResult {
  filePath: string | null;
  filesize: number | null;
}

export interface DownloadHandle {
  promise: Promise<DownloadResult>;
  cancel: () => void;
}

/**
 * Build format-selection args for a quality preset. Prefers H.264 + AAC so the
 * .mp4 plays natively on Windows (HEVC/AV1 need extra, sometimes paid, codecs).
 */
function formatArgs(quality: Quality): string[] {
  if (quality === "audio") {
    return ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"];
  }
  const sort = ["-S", "vcodec:h264,res,fps,acodec:aac"];
  const merge = ["--merge-output-format", "mp4"];
  if (quality === "best") {
    return ["-f", "bv*+ba/b", ...sort, ...merge];
  }
  // Cap the video height (1080/720/480/360).
  return ["-f", `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`, ...sort, ...merge];
}

export interface DownloadOptions {
  webpageUrl: string;
  folder: string;
  platform: Platform;
  quality: Quality;
  /** Dir for in-progress/fragment files (--paths temp); deleting it removes partials. */
  tmpDir: string;
  cookies: CookieConfig;
}

export function download(opts: DownloadOptions, cb: DownloadCallbacks): DownloadHandle {
  const { webpageUrl, folder, platform, quality, tmpDir, cookies } = opts;
  const args = [
    "--no-playlist",
    "--newline",
    // `--print` makes yt-dlp quiet; `--progress` forces progress output anyway.
    "--progress",
    "--no-simulate",
    ...formatArgs(quality),
    "--no-mtime",
    "--socket-timeout",
    "30",
    // Per-platform pacing + retries (sleep-requests/interval, limit-rate, retries).
    ...throttleArgs(platform, "download"),
    "--ffmpeg-location",
    FFMPEG_DIR,
    "-P",
    folder,
    // Keep partial/fragment files isolated so a cancel can wipe them cleanly.
    "--paths",
    `temp:${tmpDir}`,
    "-o",
    "%(uploader,channel,uploader_id)s/%(title).200B [%(id)s].%(ext)s",
    "--progress-template",
    PROGRESS_TEMPLATE,
    "--print",
    "after_move:filepath",
    "--no-warnings",
    ...jsRuntimeArgs(),
    ...cookieArgs(cookies),
    webpageUrl,
  ];

  const child = spawn(YTDLP_PATH, args, { windowsHide: true });
  let canceled = false;
  let finalPath: string | null = null;
  let stderr = "";

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    const prog = parseProgressLine(trimmed);
    if (prog) {
      cb.onProgress(prog.pct ?? 0, prog.speed, prog.eta);
      return;
    }
    // Lines that aren't progress and look like a path are the after_move:filepath print.
    if (trimmed && !trimmed.startsWith("[")) {
      finalPath = trimmed;
    }
  });

  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  const promise = new Promise<DownloadResult>((resolve, reject) => {
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      rl.close();
      if (canceled) {
        reject(new Error("canceled"));
        return;
      }
      if (code === 0) {
        let filesize: number | null = null;
        if (finalPath && fs.existsSync(finalPath)) {
          try {
            filesize = fs.statSync(finalPath).size;
          } catch {
            /* ignore */
          }
        }
        if (finalPath) cb.onFilePath?.(finalPath);
        resolve({ filePath: finalPath, filesize });
      } else {
        reject(new Error(stderr.trim().split("\n").slice(-3).join("\n") || `yt-dlp exited with code ${code}`));
      }
    });
  });

  return {
    promise,
    cancel: () => {
      canceled = true;
      killTree(child);
    },
  };
}
