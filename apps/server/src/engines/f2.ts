import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import type { Platform } from "@vbd/shared";
import { F2_PATH, FFMPEG_DIR, f2Exists } from "../config.js";
import type { DownloadHandle, DownloadResult, ScanHandle } from "../ytdlp.js";
import { killTree, materializeCookieFile, parseProgressLine } from "./shared.js";
import type { DownloadFn, ScanFn } from "./types.js";

/**
 * Douyin + TikTok engine, backed by the bundled `bin/f2.exe` — a PyInstaller
 * build of the f2 library wrapped by scripts/f2_wrapper/vbd_f2.py. f2 handles the
 * hard part (a_bogus / X-Bogus signing + cookies) that yt-dlp's Douyin extractor
 * keeps failing on. The wrapper speaks our exact contract:
 *   list <url>      → NDJSON lines matching ScanEntry
 *   download <url>… → `vbdprog:` progress lines + a final absolute path line
 * so parsing here is identical to the yt-dlp engine.
 */

export function f2Available(): boolean {
  return f2Exists();
}

function normPlatform(p: unknown): Platform {
  return p === "tiktok" ? "tiktok" : "douyin";
}

export const f2Scan: ScanFn = (url, _platform, cookies, onEntry, limit): ScanHandle => {
  let canceled = false;
  let child: ReturnType<typeof spawn> | null = null;
  let cleanupCookie: () => void = () => {};

  const promise = (async (): Promise<{ count: number }> => {
    const cf = await materializeCookieFile(cookies, url);
    cleanupCookie = cf.cleanup;

    const args = ["list", url];
    if (cf.path) args.push("--cookie-file", cf.path);
    if (limit && limit > 0) args.push("--limit", String(limit));

    child = spawn(F2_PATH, args, { windowsHide: true });
    let index = 0;
    let stderr = "";

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t.startsWith("{")) return;
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        return;
      }
      if (!j.sourceId) return;
      onEntry(
        {
          sourceId: String(j.sourceId),
          title: String(j.title ?? j.sourceId),
          webpageUrl: String(j.webpageUrl),
          thumbnailUrl: j.thumbnailUrl ?? null,
          duration: typeof j.duration === "number" ? j.duration : null,
          uploader: j.uploader ?? null,
          platform: normPlatform(j.platform),
        },
        index++,
      );
    });
    child.stderr!.on("data", (d) => (stderr += d.toString()));

    const code = await new Promise<number | null>((resolve, reject) => {
      child!.on("error", reject);
      child!.on("close", resolve);
    });
    rl.close();
    // Tolerate a non-zero exit if we still streamed entries (matches ytScan).
    if (index > 0 || code === 0) return { count: index };
    throw new Error(stderr.trim() || `f2 exited with code ${code}`);
  })();

  return {
    promise: promise.finally(() => cleanupCookie()),
    cancel: () => {
      canceled = true;
      if (child) killTree(child as Parameters<typeof killTree>[0]);
    },
  };
};

export const f2Download: DownloadFn = (opts, cb): DownloadHandle => {
  const { webpageUrl, folder, quality, tmpDir, cookies } = opts;
  let canceled = false;
  let child: ReturnType<typeof spawn> | null = null;
  let cleanupCookie: () => void = () => {};

  const promise = (async (): Promise<DownloadResult> => {
    const cf = await materializeCookieFile(cookies, webpageUrl);
    cleanupCookie = cf.cleanup;
    fs.mkdirSync(folder, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const args = [
      "download",
      webpageUrl,
      folder,
      "--quality",
      quality,
      "--tmp",
      tmpDir,
      "--ffmpeg",
      FFMPEG_DIR,
    ];
    if (cf.path) args.push("--cookie-file", cf.path);

    child = spawn(F2_PATH, args, { windowsHide: true });
    let finalPath: string | null = null;
    let stderr = "";

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const t = line.trim();
      const prog = parseProgressLine(t);
      if (prog) {
        cb.onProgress(prog.pct ?? 0, prog.speed, prog.eta);
        return;
      }
      if (t && !t.startsWith("[")) finalPath = t;
    });
    child.stderr!.on("data", (d) => (stderr += d.toString()));

    const code = await new Promise<number | null>((resolve, reject) => {
      child!.on("error", reject);
      child!.on("close", resolve);
    });
    rl.close();
    if (canceled) throw new Error("canceled");
    if (code !== 0) {
      throw new Error(stderr.trim().split("\n").slice(-3).join("\n") || `f2 exited with code ${code}`);
    }

    let filesize: number | null = null;
    if (finalPath && fs.existsSync(finalPath)) {
      try {
        filesize = fs.statSync(finalPath).size;
      } catch {
        /* ignore */
      }
    }
    if (finalPath) cb.onFilePath?.(finalPath);
    return { filePath: finalPath, filesize };
  })();

  return {
    promise: promise.finally(() => cleanupCookie()),
    cancel: () => {
      canceled = true;
      if (child) killTree(child as Parameters<typeof killTree>[0]);
    },
  };
};
