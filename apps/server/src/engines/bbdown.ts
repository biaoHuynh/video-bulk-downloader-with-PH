import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import type { Quality } from "@vbd/shared";
import { BBDOWN_PATH, FFMPEG_PATH, bbdownExists } from "../config.js";
import { buildCookieHeader } from "../bilibili.js";
import type { DownloadHandle, DownloadResult } from "../ytdlp.js";
import { killTree } from "./shared.js";
import type { DownloadFn } from "./types.js";

/**
 * Bilibili download engine, backed by the bundled `bin/BBDown.exe`. Channel
 * listing stays on the web-API enumerator in bilibili.ts; this only customises
 * downloads — BBDown fixes the cookie-less 412 (downloads 1080p via WBI when
 * signed in), prefers H.264, and muxes via our bundled ffmpeg.
 *
 * Notes from probing BBDown 1.6.3:
 *  - It downloads stream clips into `<work-dir>/<aid>/` then muxes the final file
 *    into the work-dir root, removing the temp folder on success. We point
 *    `--work-dir` at the queue's isolated tmpDir, then move the finished file out.
 *  - Its progress bar is a Spectre.Console widget that emits nothing when stdout
 *    is piped (non-TTY), so we synthesise progress by polling tmpDir bytes
 *    against the selected stream size parsed from stdout.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MEDIA_EXT = new Set([".mp4", ".mkv", ".flv", ".mov", ".webm", ".m4a", ".aac", ".mp3", ".opus"]);

/** dfn (display-format-name) preference lists per quality cap. best → none. */
const DFN: Partial<Record<Quality, string>> = {
  "1080": "1080P 高码率,1080P 高清,720P 高清,480P 清晰,360P 流畅",
  "720": "720P 高清,480P 清晰,360P 流畅",
  "480": "480P 清晰,360P 流畅",
  "360": "360P 流畅",
};

export function bbdownAvailable(): boolean {
  return bbdownExists();
}

/** Recursively list media files under `dir` (skips .vclip/.aclip temp + covers). */
function findMedia(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (MEDIA_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Total bytes of all files under `dir` (used to synthesise download progress). */
function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return total;
}

function statSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export const bbdownDownload: DownloadFn = (opts, cb): DownloadHandle => {
  const { webpageUrl, folder, quality, tmpDir, cookies } = opts;
  let canceled = false;
  let child: ReturnType<typeof spawn> | null = null;
  let poll: NodeJS.Timeout | null = null;

  const promise = (async (): Promise<DownloadResult> => {
    const { header } = await buildCookieHeader(cookies);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(folder, { recursive: true });

    const args = [
      webpageUrl,
      "--work-dir",
      tmpDir,
      "--ffmpeg-path",
      FFMPEG_PATH,
      "-e",
      "avc,hevc,av1",
      "--skip-subtitle",
      "--skip-cover",
      "--skip-ai",
      "-F",
      "<videoTitle> [<bvid>]",
      "-ua",
      UA,
    ];
    if (quality === "audio") args.push("--audio-only");
    else if (DFN[quality]) args.push("-q", DFN[quality]!);
    if (header) args.push("-c", header);

    child = spawn(BBDOWN_PATH, args, { windowsHide: true });

    const recent: string[] = []; // ring buffer of last output lines for error context
    let totalBytes = 0;
    const pushLine = (line: string) => {
      recent.push(line);
      if (recent.length > 12) recent.shift();
      // Selected streams print as "[选择] [480P ..] .. [~79.81 MB]" — lines that
      // start with "[" (the catalogue lines start with "N." so are excluded).
      if (/^\s*\[/.test(line) && !/^\s*\d/.test(line)) {
        const m = line.match(/~\s*([\d.]+)\s*MB/);
        if (m) totalBytes += Math.round(parseFloat(m[1]!) * 1048576);
      }
    };

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", pushLine);
    child.stderr!.on("data", (d) => {
      for (const l of d.toString().split(/\r?\n/)) if (l.trim()) pushLine(l);
    });

    // Synthesised progress: poll downloaded bytes vs the selected total.
    let lastBytes = 0;
    let lastTime = Date.now();
    poll = setInterval(() => {
      const cur = dirSize(tmpDir);
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      const speed = dt > 0 ? (cur - lastBytes) / dt : 0;
      lastBytes = cur;
      lastTime = now;
      const pct = totalBytes > 0 ? Math.min(99, (cur / totalBytes) * 100) : 0;
      const speedStr = speed > 0 ? `${(speed / 1048576).toFixed(2)}MiB/s` : null;
      cb.onProgress(pct, speedStr, null);
    }, 1000);

    const code = await new Promise<number | null>((resolve, reject) => {
      child!.on("error", reject);
      child!.on("close", resolve);
    });
    if (poll) clearInterval(poll);
    rl.close();

    if (canceled) throw new Error("canceled");
    if (code !== 0) {
      throw new Error(recent.filter(Boolean).slice(-4).join("\n") || `BBDown exited with code ${code}`);
    }

    // BBDown removed its <aid> temp folder; the muxed file is the largest media
    // file left under the isolated work-dir.
    const media = findMedia(tmpDir).sort((a, b) => statSize(b) - statSize(a));
    if (media.length === 0) {
      throw new Error("BBDown finished but produced no media file");
    }
    let src = media[0]!;

    // audio → mp3 for parity with the yt-dlp engine.
    if (quality === "audio" && path.extname(src).toLowerCase() !== ".mp3") {
      const mp3 = path.join(path.dirname(src), path.basename(src, path.extname(src)) + ".mp3");
      const r = spawnSync(
        FFMPEG_PATH,
        ["-y", "-i", src, "-vn", "-acodec", "libmp3lame", "-q:a", "2", mp3],
        { windowsHide: true },
      );
      if (r.status !== 0) {
        throw new Error("ffmpeg audio extraction failed: " + (r.stderr?.toString().slice(-300) ?? ""));
      }
      src = mp3;
    }

    const dest = path.join(folder, path.basename(src));
    fs.renameSync(src, dest);
    cb.onProgress(100, null, null);
    const filesize = statSize(dest) || null;
    cb.onFilePath?.(dest);
    return { filePath: dest, filesize };
  })();

  return {
    promise,
    cancel: () => {
      canceled = true;
      if (poll) clearInterval(poll);
      if (child) killTree(child as Parameters<typeof killTree>[0]);
    },
  };
};
