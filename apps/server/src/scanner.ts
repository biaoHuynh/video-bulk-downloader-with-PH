import { detectSource, platformLabel, type Platform, type Scan } from "@vbd/shared";
import { jobs, scans, videos } from "./repo.js";
import { bus } from "./events.js";
import type { CookieConfig, ScanEntry, ScanHandle } from "./ytdlp.js";
import { enumerateBilibiliSpace, isBilibiliSpace } from "./bilibili.js";
import { scanEngineFor } from "./engines/registry.js";
import { humanizeYtDlpError } from "./yterrors.js";
import { formatRemaining, isBlockError, noteBlock, noteSuccess } from "./ratelimit.js";

/** In-flight scans, so a long enumeration can be aborted by the user. */
const activeScans = new Map<string, ScanHandle>();
const canceledScans = new Set<string>();

/**
 * Abort an in-flight scan. The enumerator is stopped but any videos found so far
 * are kept (the scan is marked "canceled", not deleted) so the user can still
 * download the partial results. No-op if the scan already finished.
 */
export function cancelScan(scanId: string): boolean {
  const handle = activeScans.get(scanId);
  if (handle) {
    canceledScans.add(scanId);
    handle.cancel();
    return true;
  }
  // No live handle — e.g. a scan left "scanning" in the DB by a previous run
  // (its process died on shutdown). Unstick it so the UI can move on; any videos
  // it had already found are kept.
  const scan = scans.get(scanId);
  if (scan && scan.status === "scanning") {
    scans.setStatus(scanId, "canceled");
    bus.emit(scan.jobId, { type: "scan:done", scan: scans.get(scanId)! });
    return true;
  }
  return false;
}

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
    // - Douyin/TikTok → f2 engine (handles user channels + single videos); else
    //   yt-dlp. The registry falls back to yt-dlp when an engine binary is absent.
    const mid = isBilibiliSpace(url);
    const handle = mid
      ? enumerateBilibiliSpace(mid, cookies, onEntry, limit)
      : scanEngineFor(scanRow.platform)(url, scanRow.platform, cookies, onEntry, limit);
    activeScans.set(scanRow.id, handle);

    const { count } = await handle.promise;
    if (canceledScans.has(scanRow.id)) return finishCanceled(scanRow, detectedPlatform);
    // Refine: a single result is effectively a single-video scan.
    const sourceType = count <= 1 ? "video" : scanRow.sourceType;
    scans.setType(scanRow.id, sourceType, detectedPlatform);
    scans.setStatus(scanRow.id, "done");
    noteSuccess(detectedPlatform);
    bus.emit(scanRow.jobId, { type: "scan:done", scan: scans.get(scanRow.id)! });
  } catch (err) {
    // A user-cancelled enumerator may reject (e.g. yt-dlp killed mid-scan) — treat
    // it as a clean cancel, not a failure, and keep whatever was found.
    if (canceledScans.has(scanRow.id)) return finishCanceled(scanRow, detectedPlatform);
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
  } finally {
    activeScans.delete(scanRow.id);
    canceledScans.delete(scanRow.id);
  }
}

/** Mark a scan as canceled (keeping any partial results) and notify the UI. */
function finishCanceled(scanRow: Scan, detectedPlatform: Platform): void {
  const found = videos.listByScan(scanRow.id).length;
  scans.setType(scanRow.id, found <= 1 ? "video" : scanRow.sourceType, detectedPlatform);
  scans.setStatus(scanRow.id, "canceled");
  bus.emit(scanRow.jobId, { type: "scan:done", scan: scans.get(scanRow.id)! });
}
