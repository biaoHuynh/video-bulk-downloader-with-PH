# Video Bulk Downloader

Bulk-download videos from a YouTube, TikTok, Douyin, or Bilibili channel — or from a
single video URL. Paste a link, the app lists every video with thumbnails, you select
what you want, and it downloads them sequentially into a folder of your choice with live
progress.

Runs as a local web app, or as a packaged Windows desktop app built on Electron.

## Features

- Bulk listing of an entire channel or playlist, or a single video.
- Per-platform download engines — the best tool for each site — with automatic yt-dlp fallback.
- Live scan results and download progress over Server-Sent Events.
- Quality presets: best, 1080p, 720p, 480p, 360p, or audio-only (MP3). H.264 + AAC is
  preferred where the platform offers a choice, so files play on Windows without extra codecs.
- Sequential download queue with per-item cancel, retry-with-backoff, and isolated temp files.
- Per-platform request pacing and an adaptive cooldown that pauses a blocked platform and
  resumes automatically.
- Authentication via embedded login (desktop) or cookies (browser export / cookies.txt).
- Scan history you can reload, re-scan, or delete; in-progress scans can be stopped.

## Supported platforms

The scanner and download queue choose an engine per platform through
`apps/server/src/engines/registry.ts`. Every engine implements the same interface, and the
registry falls back to yt-dlp whenever an optional binary is not present.

| Platform | List (scan)      | Download |
| -------- | ---------------- | -------- |
| YouTube  | yt-dlp           | yt-dlp   |
| TikTok   | yt-dlp           | yt-dlp   |
| Douyin   | f2               | f2       |
| Bilibili | Bilibili web API | BBDown   |

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — YouTube and TikTok; both extractors are reliable.
- **[f2](https://github.com/Johnserf-Seed/f2)** — Douyin. It signs requests (a_bogus) where
  yt-dlp's Douyin extractor fails. Shipped as a self-contained executable built from the
  wrapper in `scripts/f2_wrapper/`.
- **[BBDown](https://github.com/nilaoda/BBDown)** — Bilibili downloads: 1080p without login via
  WBI signing, codec selection, and reliable muxing. Channel listing uses Bilibili's web API
  directly (also WBI-signed).

## Tech stack

| Layer    | Technology                                          |
| -------- | --------------------------------------------------- |
| Frontend | Next.js (App Router), Tailwind CSS v4, TanStack Query |
| Backend  | Node.js, Fastify, SQLite (better-sqlite3)           |
| Desktop  | Electron (bundles the UI and server in one process) |
| Media    | ffmpeg for muxing and audio extraction              |

Monorepo, managed with pnpm workspaces:

```
apps/web         Next.js UI
apps/server      Fastify API, per-platform engines, download queue
packages/shared  Shared types and URL/platform detection
electron/        Electron main/preload (embedded login, native dialogs)
scripts/         Binary fetch and f2 build scripts
bin/             yt-dlp, ffmpeg, ffprobe, BBDown, f2 (downloaded or built locally)
```

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- Python >= 3.10 — optional, only to build the Douyin engine (`pnpm build:f2`). Without it,
  Douyin falls back to yt-dlp, which is currently unreliable for that site.
- Windows is required for the desktop build and for the bundled BBDown and ffmpeg binaries.
  The web app also runs on other platforms with yt-dlp, but BBDown, f2, and the prebuilt
  ffmpeg are Windows-only here.

## Installation

```bash
pnpm install        # install dependencies
pnpm setup          # download yt-dlp, ffmpeg, and BBDown into ./bin
pnpm build:f2       # optional: build bin/f2.exe for Douyin (requires Python >= 3.10)
```

## Development

```bash
pnpm dev            # API on port 4319 and the UI on port 3000
```

Open http://localhost:3000. To run the processes separately:

```bash
pnpm dev:server
pnpm dev:web
```

## Desktop app

The desktop build runs the Fastify server in-process, serves the static UI, and loads it in
a native window. Its main advantage is embedded login: a sign-in window captures session
cookies directly from the app's own browser session, which avoids the locked cookie-database
problem on Windows.

### Build the installer

`pnpm dist:app` produces a Windows installer end to end — it fetches the binaries, builds the
optional Douyin engine, sets the correct native-module ABI, then packages everything. Use this
to ship a standalone app that installs and launches from the Start menu, with no terminal:

```bash
pnpm dist:app              # full build -> release/<product>-<version>-setup.exe
pnpm dist:app --skip-f2    # skip the optional Douyin (f2) engine
```

For day-to-day work you can still run the lower-level scripts directly:

```bash
pnpm app:rebuild    # rebuild better-sqlite3 for Electron's ABI (first time only)
pnpm app            # build and launch the desktop app (no installer)
pnpm dist           # package the installer only (assumes binaries + ABI are ready)
```

Native module note: `better-sqlite3` is compiled per runtime. `pnpm dist:app` and
`pnpm app:rebuild` set the Electron ABI; switch back for web development with
`pnpm rebuild:node`.

## Usage

1. Paste a channel or playlist URL (lists all videos) or a single video URL, then click
   Scan. Results stream in live and appear in the History panel.
2. Select videos (or use the select helpers) and click Download. Choose a target folder
   once; later downloads reuse it. Files are saved into that folder, named by title and id.
3. For private or region-restricted content, sign in (desktop) or provide cookies (web).
4. Use the History panel to reload, re-scan, or delete a past scan. Stop an in-progress scan
   with the Stop button.

## Authentication

Some content requires a logged-in session — notably Douyin, and region- or age-restricted
Bilibili and TikTok.

- Desktop: use Sign in. A login window opens; after you log in and close it, the session
  cookies are saved. The check mark appears only when a real session cookie is captured;
  anonymous cookies do not count.
- Web: choose "From browser", or point to an exported `cookies.txt` file.

## Rate limiting

Requests are paced per platform, and a detected block (for example, Bilibili HTTP 412) starts
an adaptive cooldown shown in the UI; queued downloads wait and resume automatically. Bilibili
in particular enforces per-IP risk control, so a logged-in session is the most effective
remedy — a flagged IP may still need time or a different network.

## Configuration

| Variable               | Default                 | Purpose                                |
| ---------------------- | ----------------------- | -------------------------------------- |
| `VBD_PORT`             | `4319`                  | API port                               |
| `VBD_BIN_DIR`          | `./bin`                 | Location of the binaries               |
| `VBD_DATA_DIR`         | `./data`                | SQLite database and default downloads  |
| `VBD_JS_RUNTIME`       | auto (Node)             | JS runtime yt-dlp uses for YouTube     |
| `NEXT_PUBLIC_API_BASE` | `http://127.0.0.1:4319` | API base URL used by the web UI        |

## Contributing

Issues and pull requests are welcome. Please run `pnpm typecheck` before submitting. To add a
platform, implement the scan/download interface in `apps/server/src/engines/` and register it
in `apps/server/src/engines/registry.ts`.

## License

No license has been declared yet. Add a `LICENSE` file (for example, MIT) to define how others
may use this project.

## Disclaimer

This tool is intended for personal use. Respect each platform's Terms of Service and copyright,
and download only content you have the right to access.
