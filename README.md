# Video Bulk Downloader

Bulk-download videos from a **TikTok / Douyin / Bilibili / YouTube** channel (or a
single video URL). Paste a channel URL → the tool lists every video with thumbnails →
check-select the ones you want → **Download** → they save sequentially into a folder you
pick via a native dialog.

Work is organized into **jobs**: each job keeps its own scan history and downloaded
videos.

## Stack

| Layer    | Tech                                                            |
| -------- | -------------------------------------------------------------- |
| Frontend | Next.js (App Router) + Tailwind v4 + TanStack Query            |
| Backend  | Node.js + Fastify (TypeScript), SQLite (`better-sqlite3`)       |
| Engine   | `yt-dlp` (standalone binary) + `ffmpeg` for merging            |
| Realtime | Server-Sent Events (scan results + download progress stream in) |

Monorepo (pnpm workspaces):

```
apps/web        Next.js UI
apps/server     Fastify API + yt-dlp orchestration + download queue
packages/shared Shared TS types + URL/platform detection
bin/            yt-dlp.exe, ffmpeg.exe, ffprobe.exe (fetched by `pnpm setup`)
data/           SQLite db + default downloads dir
scripts/        fetch-binaries.mjs
```

## Prerequisites

- Node.js ≥ 20 (tested on 22)
- pnpm ≥ 10

## Setup

```bash
pnpm install        # install workspace deps (better-sqlite3 uses a prebuilt binary)
pnpm setup          # download yt-dlp + ffmpeg into ./bin  (Windows: also unzips ffmpeg)
```

## Run (development)

```bash
pnpm dev            # runs the API (:4319) and the Next.js UI (:3000) together
```

Then open http://localhost:3000.

Run them separately if you prefer:

```bash
pnpm dev:server     # Fastify API on http://127.0.0.1:4319
pnpm dev:web        # Next.js on http://localhost:3000
```

## How it works

1. **Create a job** on the home page, then open it.
2. Paste a **channel URL** (lists all videos) or a **single video URL** (just that one)
   and click **Scan**. Results stream in live.
3. Tick the videos you want (or select-all) and click **Download**. A native folder
   picker opens; choose a destination. Downloads run **one at a time**, with live
   progress, into `<folder>/<uploader>/<title> [id].mp4`.
4. **Cookies** (top-right of a job): set "From browser" (Chrome/Edge/Firefox/…) or point
   at a `cookies.txt` file — needed for Douyin and region/age-restricted content.
5. **yt-dlp** can be updated in-app from the top bar (TikTok/Douyin extractors change
   often — update if a scan stops working).

## Configuration (env)

| Variable               | Default                     | Purpose                                  |
| ---------------------- | --------------------------- | ---------------------------------------- |
| `VBD_PORT`             | `4319`                      | API port                                 |
| `VBD_BIN_DIR`          | `./bin`                     | Location of yt-dlp/ffmpeg                 |
| `VBD_DATA_DIR`         | `./data`                    | SQLite db + default downloads            |
| `VBD_JS_RUNTIME`       | auto (Node)                 | JS runtime yt-dlp uses for YouTube       |
| `NEXT_PUBLIC_API_BASE` | `http://127.0.0.1:4319`     | API base the UI calls (web)              |

## Notes & roadmap

- yt-dlp 2026+ needs a JS runtime for full YouTube extraction; the server points it at
  Node automatically.
- Downloads write to the **machine running the backend** (your machine in local mode).
- **Next up (P4):** package as a Windows desktop app with Electron — bundle
  `yt-dlp.exe`/`ffmpeg.exe`, replace the folder picker with Electron's native dialog, and
  enable Next.js `output: "standalone"`.

> Respect each platform's Terms of Service and copyright. Download only content you have
> the right to.
