import { customAlphabet } from "nanoid";
import { db } from "./db.js";

// Alphanumeric only: avoids leading "-"/"_" that can confuse paths and CLIs.
const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);
import type {
  CookieBrowser,
  CookieMode,
  DownloadStatus,
  Job,
  Platform,
  Quality,
  Scan,
  ScanStatus,
  SourceType,
  Video,
} from "@vbd/shared";

const now = () => new Date().toISOString();

/* --------------------------------- mappers --------------------------------- */

type JobRow = {
  id: string;
  name: string;
  cookie_mode: string;
  cookie_browser: string | null;
  cookie_file_path: string | null;
  default_folder: string | null;
  quality: string | null;
  created_at: string;
  updated_at: string;
  video_count?: number;
  downloaded_count?: number;
};

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    name: r.name,
    cookieMode: r.cookie_mode as CookieMode,
    cookieBrowser: (r.cookie_browser as CookieBrowser | null) ?? null,
    cookieFilePath: r.cookie_file_path,
    defaultFolder: r.default_folder,
    quality: (r.quality as Quality) ?? "best",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    videoCount: r.video_count,
    downloadedCount: r.downloaded_count,
  };
}

type ScanRow = {
  id: string;
  job_id: string;
  source_url: string;
  source_type: string;
  platform: string;
  status: string;
  error: string | null;
  created_at: string;
  video_count?: number;
};

function toScan(r: ScanRow): Scan {
  return {
    id: r.id,
    jobId: r.job_id,
    sourceUrl: r.source_url,
    sourceType: r.source_type as SourceType,
    platform: r.platform as Platform,
    status: r.status as ScanStatus,
    error: r.error,
    createdAt: r.created_at,
    videoCount: r.video_count,
  };
}

type VideoRow = {
  id: string;
  scan_id: string;
  job_id: string;
  platform: string;
  source_id: string;
  webpage_url: string;
  title: string;
  thumbnail_url: string | null;
  duration: number | null;
  uploader: string | null;
  position: number;
  download_status: string;
  progress: number;
  speed: string | null;
  eta: string | null;
  file_path: string | null;
  filesize: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function toVideo(r: VideoRow): Video {
  return {
    id: r.id,
    scanId: r.scan_id,
    jobId: r.job_id,
    platform: r.platform as Platform,
    sourceId: r.source_id,
    webpageUrl: r.webpage_url,
    title: r.title,
    thumbnailUrl: r.thumbnail_url,
    duration: r.duration,
    uploader: r.uploader,
    position: r.position,
    downloadStatus: r.download_status as DownloadStatus,
    progress: r.progress,
    speed: r.speed,
    eta: r.eta,
    filePath: r.file_path,
    filesize: r.filesize,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---------------------------------- jobs ----------------------------------- */

const JOB_AGG = `
  (SELECT COUNT(*) FROM videos v WHERE v.job_id = j.id) AS video_count,
  (SELECT COUNT(*) FROM videos v WHERE v.job_id = j.id AND v.download_status = 'completed') AS downloaded_count
`;

export const jobs = {
  create(name: string): Job {
    const id = nanoid(12);
    const ts = now();
    db.prepare(
      `INSERT INTO jobs (id, name, cookie_mode, created_at, updated_at)
       VALUES (?, ?, 'none', ?, ?)`,
    ).run(id, name.trim() || "Untitled job", ts, ts);
    return this.get(id)!;
  },

  list(): Job[] {
    const rows = db
      .prepare(`SELECT j.*, ${JOB_AGG} FROM jobs j ORDER BY j.updated_at DESC`)
      .all() as JobRow[];
    return rows.map(toJob);
  },

  get(id: string): Job | null {
    const row = db
      .prepare(`SELECT j.*, ${JOB_AGG} FROM jobs j WHERE j.id = ?`)
      .get(id) as JobRow | undefined;
    return row ? toJob(row) : null;
  },

  /**
   * The single hidden "workspace" the whole UI uses (jobs are no longer
   * surfaced). Stored under a settings key so settings (cookies/folder) persist.
   */
  getOrCreateDefault(): Job {
    const savedId = settings.get("default_job_id");
    if (savedId) {
      const existing = this.get(savedId);
      if (existing) return existing;
    }
    const fallback = this.list()[0] ?? this.create("Workspace");
    settings.set("default_job_id", fallback.id);
    return fallback;
  },

  update(
    id: string,
    patch: {
      name?: string;
      cookieMode?: CookieMode;
      cookieBrowser?: CookieBrowser | null;
      cookieFilePath?: string | null;
      defaultFolder?: string | null;
      quality?: Quality;
    },
  ): Job | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = {
      name: patch.name ?? cur.name,
      cookie_mode: patch.cookieMode ?? cur.cookieMode,
      cookie_browser:
        patch.cookieBrowser !== undefined ? patch.cookieBrowser : cur.cookieBrowser,
      cookie_file_path:
        patch.cookieFilePath !== undefined ? patch.cookieFilePath : cur.cookieFilePath,
      default_folder:
        patch.defaultFolder !== undefined ? patch.defaultFolder : cur.defaultFolder,
      quality: patch.quality ?? cur.quality,
    };
    db.prepare(
      `UPDATE jobs SET name=?, cookie_mode=?, cookie_browser=?, cookie_file_path=?,
       default_folder=?, quality=?, updated_at=? WHERE id=?`,
    ).run(
      next.name,
      next.cookie_mode,
      next.cookie_browser,
      next.cookie_file_path,
      next.default_folder,
      next.quality,
      now(),
      id,
    );
    return this.get(id);
  },

  touch(id: string): void {
    db.prepare(`UPDATE jobs SET updated_at=? WHERE id=?`).run(now(), id);
  },

  remove(id: string): void {
    db.prepare(`DELETE FROM jobs WHERE id=?`).run(id);
  },
};

/* ---------------------------------- scans ---------------------------------- */

export const scans = {
  create(input: {
    jobId: string;
    sourceUrl: string;
    sourceType: SourceType;
    platform: Platform;
  }): Scan {
    const id = nanoid(12);
    db.prepare(
      `INSERT INTO scans (id, job_id, source_url, source_type, platform, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'scanning', ?)`,
    ).run(id, input.jobId, input.sourceUrl, input.sourceType, input.platform, now());
    jobs.touch(input.jobId);
    return this.get(id)!;
  },

  get(id: string): Scan | null {
    const row = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scan_id = s.id) AS video_count
         FROM scans s WHERE s.id = ?`,
      )
      .get(id) as ScanRow | undefined;
    return row ? toScan(row) : null;
  },

  listByJob(jobId: string): Scan[] {
    const rows = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scan_id = s.id) AS video_count
         FROM scans s WHERE s.job_id = ? ORDER BY s.created_at DESC`,
      )
      .all(jobId) as ScanRow[];
    return rows.map(toScan);
  },

  setStatus(id: string, status: ScanStatus, error: string | null = null): void {
    db.prepare(`UPDATE scans SET status=?, error=? WHERE id=?`).run(status, error, id);
  },

  setType(id: string, sourceType: SourceType, platform: Platform): void {
    db.prepare(`UPDATE scans SET source_type=?, platform=? WHERE id=?`).run(
      sourceType,
      platform,
      id,
    );
  },

  /** Delete a scan and (via ON DELETE CASCADE) all of its videos. */
  remove(id: string): void {
    db.prepare(`DELETE FROM scans WHERE id=?`).run(id);
  },
};

/* --------------------------------- videos ---------------------------------- */

export interface NewVideo {
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
}

export const videos = {
  insert(v: NewVideo): Video {
    const id = nanoid(12);
    const ts = now();
    db.prepare(
      `INSERT INTO videos
       (id, scan_id, job_id, platform, source_id, webpage_url, title, thumbnail_url,
        duration, uploader, position, download_status, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 0, ?, ?)`,
    ).run(
      id,
      v.scanId,
      v.jobId,
      v.platform,
      v.sourceId,
      v.webpageUrl,
      v.title,
      v.thumbnailUrl,
      v.duration,
      v.uploader,
      v.position,
      ts,
      ts,
    );
    return this.get(id)!;
  },

  get(id: string): Video | null {
    const row = db.prepare(`SELECT * FROM videos WHERE id=?`).get(id) as
      | VideoRow
      | undefined;
    return row ? toVideo(row) : null;
  },

  listByScan(scanId: string): Video[] {
    const rows = db
      .prepare(`SELECT * FROM videos WHERE scan_id=? ORDER BY position ASC`)
      .all(scanId) as VideoRow[];
    return rows.map(toVideo);
  },

  listByJob(jobId: string): Video[] {
    const rows = db
      .prepare(`SELECT * FROM videos WHERE job_id=? ORDER BY created_at DESC`)
      .all(jobId) as VideoRow[];
    return rows.map(toVideo);
  },

  listByIds(ids: string[]): Video[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT * FROM videos WHERE id IN (${placeholders})`)
      .all(...ids) as VideoRow[];
    return rows.map(toVideo);
  },

  setStatus(
    id: string,
    status: DownloadStatus,
    fields: Partial<{
      progress: number;
      error: string | null;
      filePath: string | null;
      filesize: number | null;
      speed: string | null;
      eta: string | null;
    }> = {},
  ): Video | null {
    const cur = this.get(id);
    if (!cur) return null;
    db.prepare(
      `UPDATE videos SET download_status=?, progress=?, error=?, file_path=?, filesize=?,
       speed=?, eta=?, updated_at=? WHERE id=?`,
    ).run(
      status,
      fields.progress ?? cur.progress,
      fields.error !== undefined ? fields.error : cur.error,
      fields.filePath !== undefined ? fields.filePath : cur.filePath,
      fields.filesize !== undefined ? fields.filesize : cur.filesize,
      fields.speed !== undefined ? fields.speed : cur.speed,
      fields.eta !== undefined ? fields.eta : cur.eta,
      now(),
      id,
    );
    return this.get(id);
  },

  setProgress(id: string, progress: number, speed: string | null, eta: string | null): void {
    db.prepare(
      `UPDATE videos SET progress=?, speed=?, eta=?, updated_at=? WHERE id=?`,
    ).run(progress, speed, eta, now(), id);
  },
};

/* -------------------------------- settings --------------------------------- */

export const settings = {
  get(key: string): string | null {
    const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as
      | { value: string | null }
      | undefined;
    return row?.value ?? null;
  },
  set(key: string, value: string | null): void {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(key, value);
  },
};
