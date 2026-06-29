import { detectSource, platformLabel, type Platform, type Scan } from "@vbd/shared";
import { jobs, scans, videos } from "./repo.js";
import { bus } from "./events.js";
import { scan as ytScan, type CookieConfig, type ScanEntry } from "./ytdlp.js";
import { enumerateBilibiliSpace, isBilibiliSpace } from "./bilibili.js";
import { getDouyinEnumerator } from "./native.js";
import { humanizeYtDlpError } from "./yterrors.js";
import { formatRemaining, isBlockError, noteBlock, noteSuccess } from "./ratelimit.js";

/** Create a scan record and start enumerating in the background. */
export function startScan(jobId: string, url: string, limit?: number): Scan {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Job not found");

  const info = detectSource(url);
  const scanRow = scans.create({
    jobId,
    sourceUrl: url.trim(),
    sourceType: info.type,
    platform: info.platform,
  });

  bus.emit(jobId, { type: "scan:started", scan: scanRow });
  void runScan(
    scanRow,
    url.trim(),
    {
      cookieMode: job.cookieMode,
      cookieBrowser: job.cookieBrowser,
      cookieFilePath: job.cookieFilePath,
    },
    limit,
  );

  return scanRow;
}

async function runScan(
  scanRow: Scan,
  url: string,
  cookies: CookieConfig,
  limit?: number,
): Promise<void> {
  let detectedPlatform: Platform = scanRow.platform;
  try {
    const onEntry = (entry: ScanEntry, index: number) => {
      const video = videos.insert({
        scanId: scanRow.id,
        jobId: scanRow.jobId,
        platform: entry.platform,
        sourceId: entry.sourceId,
        webpageUrl: entry.webpageUrl,
        title: entry.title,
        thumbnailUrl: entry.thumbnailUrl,
        duration: entry.duration,
        uploader: entry.uploader,
        position: index,
      });
      detectedPlatform = entry.platform;
      bus.emit(scanRow.jobId, { type: "video:added", video });
      bus.emit(scanRow.jobId, { type: "scan:progress", scanId: scanRow.id, found: index + 1 });
    };

    // Pick the enumerator:
    // - Bilibili user page → direct web API (richer + cookie-aware).
    // - Douyin channel → native (Electron) enumerator if available (yt-dlp has none).
    // - else → yt-dlp flat scan.
    const mid = isBilibiliSpace(url);
    const douyin = getDouyinEnumerator();
    const handle = mid
      ? enumerateBilibiliSpace(mid, cookies, onEntry, limit)
      : scanRow.platform === "douyin" && scanRow.sourceType === "channel" && douyin
        ? douyin(url, cookies, onEntry, limit)
        : ytScan(url, scanRow.platform, cookies, onEntry, limit);

    const { count } = await handle.promise;
    // Refine: a single result is effectively a single-video scan.
    const sourceType = count <= 1 ? "video" : scanRow.sourceType;
    scans.setType(scanRow.id, sourceType, detectedPlatform);
    scans.setStatus(scanRow.id, "done");
    noteSuccess(detectedPlatform);
    bus.emit(scanRow.jobId, { type: "scan:done", scan: scans.get(scanRow.id)! });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let message: string;
    if (isBlockError(raw)) {
      const until = noteBlock(scanRow.platform);
      const tip =
        scanRow.platform === "bilibili"
          ? "If not signed in, use Sign in; if already signed in, this IP is flagged — wait 15–60 min or switch network/VPN."
          : "Set Cookies = From browser, or switch network/VPN.";
      message =
        `${platformLabel(scanRow.platform)} blocked this request (rate-limit). ` +
        `Pausing this platform ~${formatRemaining(until - Date.now())}. ${tip}`;
    } else {
      message = humanizeYtDlpError(raw, {
        platform: scanRow.platform,
        sourceType: scanRow.sourceType,
      });
    }
    scans.setStatus(scanRow.id, "error", message);
    bus.emit(scanRow.jobId, { type: "scan:error", scanId: scanRow.id, error: message });
  }
}
