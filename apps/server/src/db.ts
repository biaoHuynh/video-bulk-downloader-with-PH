import Database from "better-sqlite3";
import { DB_PATH, ensureDirs } from "./config.js";

ensureDirs();

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  cookie_mode      TEXT NOT NULL DEFAULT 'none',
  cookie_browser   TEXT,
  cookie_file_path TEXT,
  default_folder   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_url  TEXT NOT NULL,
  source_type TEXT NOT NULL,
  platform    TEXT NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_job ON scans(job_id);

CREATE TABLE IF NOT EXISTS videos (
  id              TEXT PRIMARY KEY,
  scan_id         TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  webpage_url     TEXT NOT NULL,
  title           TEXT NOT NULL,
  thumbnail_url   TEXT,
  duration        REAL,
  uploader        TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  download_status TEXT NOT NULL DEFAULT 'idle',
  progress        REAL NOT NULL DEFAULT 0,
  speed           TEXT,
  eta             TEXT,
  file_path       TEXT,
  filesize        INTEGER,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_scan ON videos(scan_id);
CREATE INDEX IF NOT EXISTS idx_videos_job ON videos(job_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

export function initDb(): void {
  db.exec(SCHEMA);
  // Any download left mid-flight by a crash/restart is no longer running.
  db.prepare(
    `UPDATE videos SET download_status = 'error', error = 'Interrupted (server restarted)', updated_at = ?
     WHERE download_status IN ('downloading', 'queued')`,
  ).run(new Date().toISOString());
}
