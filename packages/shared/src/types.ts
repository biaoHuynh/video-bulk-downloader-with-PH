/** Supported platforms. `unknown` means we let yt-dlp decide. */
export type Platform = "youtube" | "tiktok" | "douyin" | "bilibili" | "unknown";

export const PLATFORMS: Platform[] = [
  "youtube",
  "tiktok",
  "douyin",
  "bilibili",
];

/** What kind of thing a submitted URL points at. */
export type SourceType = "channel" | "playlist" | "video";

export type ScanStatus = "scanning" | "done" | "error";

export type DownloadStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "completed"
  | "error"
  | "skipped"
  | "canceled";

/** How a job authenticates yt-dlp for scans + downloads. */
export type CookieMode = "none" | "browser" | "file";
export type CookieBrowser = "chrome" | "edge" | "firefox" | "brave" | "opera" | "vivaldi";

export interface Job {
  id: string;
  name: string;
  cookieMode: CookieMode;
  cookieBrowser: CookieBrowser | null;
  cookieFilePath: string | null;
  defaultFolder: string | null;
  createdAt: string;
  updatedAt: string;
  /** Aggregates filled in by list/detail endpoints. */
  videoCount?: number;
  downloadedCount?: number;
}

export interface Scan {
  id: string;
  jobId: string;
  sourceUrl: string;
  sourceType: SourceType;
  platform: Platform;
  status: ScanStatus;
  error: string | null;
  createdAt: string;
  videoCount?: number;
}

export interface Video {
  id: string;
  scanId: string;
  jobId: string;
  platform: Platform;
  sourceId: string;
  webpageUrl: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  uploader: string | null;
  position: number;
  downloadStatus: DownloadStatus;
  progress: number;
  speed: string | null;
  eta: string | null;
  filePath: string | null;
  filesize: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------- API request DTOs ---------------------------- */

export interface CreateJobInput {
  name: string;
}

export interface UpdateJobInput {
  name?: string;
  cookieMode?: CookieMode;
  cookieBrowser?: CookieBrowser | null;
  cookieFilePath?: string | null;
  defaultFolder?: string | null;
}

export interface ScanInput {
  url: string;
  /** Max number of videos to enumerate (maps to yt-dlp --playlist-end). */
  limit?: number;
}

export interface DownloadInput {
  videoIds: string[];
  folder: string;
}

/* ------------------------------- SSE events -------------------------------- */

export type ServerEvent =
  | { type: "scan:started"; scan: Scan }
  | { type: "scan:progress"; scanId: string; found: number }
  | { type: "scan:done"; scan: Scan }
  | { type: "scan:error"; scanId: string; error: string }
  | { type: "video:added"; video: Video }
  | {
      type: "download:progress";
      videoId: string;
      progress: number;
      speed: string | null;
      eta: string | null;
    }
  | { type: "video:status"; video: Video }
  | { type: "queue:state"; jobId: string; queued: number; active: string | null };

/* --------------------------------- system ---------------------------------- */

export interface YtDlpVersion {
  version: string | null;
  binaryPath: string;
  available: boolean;
}
