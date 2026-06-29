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
| Engines  | per-platform, best-of-breed (see below) + `ffmpeg` for merging |
| Realtime | Server-Sent Events (scan results + download progress stream in) |

### Per-platform engines

Instead of forcing every site through one tool, the scanner/queue pick the best engine per
platform via `apps/server/src/engines/registry.ts` (each engine shares the same
`ScanHandle`/`DownloadHandle` contract, and the registry **falls back to yt-dlp** whenever a
specialised binary is missing — so a plain `pnpm setup` install still works):

| Platform   | List (scan)                | Download                    |
| ---------- | -------------------------- | --------------------------- |
| YouTube    | `yt-dlp`                   | `yt-dlp`                    |
| TikTok     | `yt-dlp`                   | `yt-dlp`                    |
| Douyin     | `f2` (`bin/f2.exe`)        | `f2`                        |
| Bilibili   | web API (`bilibili.ts`)    | `BBDown` (`bin/BBDown.exe`) |

- **`f2`** ([Johnserf-Seed/f2](https://github.com/Johnserf-Seed/f2)) signs Douyin requests
  properly (a_bogus) — yt-dlp's Douyin extractor is unreliable. Shipped as a PyInstaller exe
  built from our wrapper (`scripts/f2_wrapper/vbd_f2.py`). **TikTok stays on yt-dlp** (its
  TikTok extractor works well; f2's TikTok path needs a real msToken that TikTok rejects).
- **`BBDown`** ([nilaoda/BBDown](https://github.com/nilaoda/BBDown)) is the best Bilibili
  downloader: 1080p without login (WBI), proper codec selection, no 412 grief.

Monorepo (pnpm workspaces):

```
apps/web        Next.js UI
apps/server     Fastify API + per-platform engines (src/engines/) + download queue
packages/shared Shared TS types + URL/platform detection
bin/            yt-dlp.exe, ffmpeg.exe, ffprobe.exe, BBDown.exe (pnpm setup); f2.exe (pnpm build:f2)
data/           SQLite db + default downloads dir
scripts/        fetch-binaries.mjs, build-f2.mjs, f2_wrapper/vbd_f2.py
```

## Prerequisites

- Node.js ≥ 20 (tested on 22)
- pnpm ≥ 10
- **Python ≥ 3.10** — only if you want the Douyin/TikTok engine (`pnpm build:f2`). Without it,
  those platforms fall back to yt-dlp (which currently fails on Douyin).

## Setup

```bash
pnpm install        # install workspace deps (better-sqlite3 uses a prebuilt binary)
pnpm setup          # download yt-dlp + ffmpeg + BBDown into ./bin  (Windows)
pnpm build:f2       # OPTIONAL: build bin/f2.exe (Douyin/TikTok engine) — needs Python ≥ 3.10
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

Single-page workspace — no navigation:
1. Paste a **channel URL** (lists all videos) or a **single video URL** (just that one)
   and click **Scan**. Results stream in live; each scan appears in the **History** panel
   (click a row to reload it).
2. Tick the videos you want (or select-all / "Not done") and click **Download**. A native
   folder picker opens (pick once; later downloads reuse it). Downloads run **one at a
   time** with live progress into `<folder>/<uploader>/<title> [id].mp4` (H.264 preferred
   so the mp4 plays without extra codecs).
3. **Cookies**: needed for Douyin and region/age-restricted Bilibili/TikTok. In the
   **desktop app**, use **Sign in** (embedded login — most reliable). In web mode, use the
   cookie selector ("From browser" or a `cookies.txt` file).
4. **Rate-limiting**: requests are paced per platform; on a block (e.g. Bilibili 412) the
   platform is paused with a cooldown (banner shows remaining time) and resumes
   automatically.
5. **yt-dlp** can be updated from the top bar (TikTok/Douyin extractors change often).

## Configuration (env)

| Variable               | Default                     | Purpose                                  |
| ---------------------- | --------------------------- | ---------------------------------------- |
| `VBD_PORT`             | `4319`                      | API port                                 |
| `VBD_BIN_DIR`          | `./bin`                     | Location of yt-dlp/ffmpeg                 |
| `VBD_DATA_DIR`         | `./data`                    | SQLite db + default downloads            |
| `VBD_JS_RUNTIME`       | auto (Node)                 | JS runtime yt-dlp uses for YouTube       |
| `NEXT_PUBLIC_API_BASE` | `http://127.0.0.1:4319`     | API base the UI calls (web)              |

## Desktop app (Electron)

The app wraps the UI + server in Electron (one process: Fastify serves the Next static
export + API; a window loads it). The big win: an **embedded login** (Sign in) reads
cookies from the app's own browser session, so Bilibili/Douyin/TikTok logins work without
the Chrome cookie-DB-lock problems. The ✓ next to a platform appears only when a real
logged-in session cookie was captured (e.g. Douyin `sessionid`) — anonymous cookies don't
count. Douyin/TikTok listing + download then go through the `f2` engine using those cookies.

```bash
pnpm setup            # ensure bin/ has yt-dlp + ffmpeg
pnpm app:rebuild      # rebuild better-sqlite3 for Electron's ABI (first time)
pnpm app              # build export + bundle + launch the app
pnpm dist             # build the Windows NSIS installer → release/
```

> **Native module ABI:** `better-sqlite3` is compiled per-runtime. After `pnpm app:rebuild`
> (Electron ABI), web mode (`pnpm dev`) needs `pnpm rebuild:node` to switch back, and
> vice-versa.

## Notes

- yt-dlp 2026+ needs a JS runtime for full YouTube extraction; the server points it at
  Node automatically.
- Downloads write to the machine running the app.
- Bilibili/Douyin enforce per-IP rate limits; logged-in cookies + the built-in pacing help,
  but a flagged IP still needs time or a different network.

> Respect each platform's Terms of Service and copyright. Download only content you have
> the right to.
