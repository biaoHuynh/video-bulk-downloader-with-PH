import type { Platform } from "@vbd/shared";
import { scan as ytScan, download as ytDownload } from "../ytdlp.js";
import { f2Available, f2Scan, f2Download } from "./f2.js";
import { bbdownAvailable, bbdownDownload } from "./bbdown.js";
import type { DownloadFn, ScanFn } from "./types.js";

/**
 * Pick the best available engine per platform, falling back to yt-dlp whenever a
 * specialised binary is missing (so plain web/dev — which only fetches yt-dlp +
 * ffmpeg — keeps working). Bilibili *channel* listing is handled separately in
 * scanner.ts via the web API; here Bilibili only customises downloads (BBDown).
 *
 * Note: only **Douyin** uses f2 — yt-dlp's Douyin extractor is broken, but its
 * TikTok one works well (and f2's TikTok path needs a real msToken that TikTok
 * rejects when synthesised), so TikTok stays on yt-dlp.
 */

export function scanEngineFor(platform: Platform): ScanFn {
  if (platform === "douyin" && f2Available()) return f2Scan;
  return ytScan;
}

export function downloadEngineFor(platform: Platform): DownloadFn {
  if (platform === "douyin" && f2Available()) return f2Download;
  if (platform === "bilibili" && bbdownAvailable()) return bbdownDownload;
  return ytDownload;
}
