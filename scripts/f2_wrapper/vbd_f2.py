#!/usr/bin/env python3
"""
vbd_f2 — a thin, stable CLI bridge between VideoBulkDownloader (Node) and the
`f2` library, used for Douyin + TikTok (where yt-dlp's extractors are flaky).

We use f2 ONLY for the hard part — fetching signed metadata (a_bogus / X-Bogus +
cookies). The actual file download, progress reporting, and final-path printing
are done here so the Node side gets the exact same contract as every other engine:

  vbd_f2 list <url> [--cookie-file P] [--limit N]
      -> one NDJSON object per line on stdout, fields matching ScanEntry:
         {sourceId,title,webpageUrl,thumbnailUrl,duration,uploader,platform}

  vbd_f2 download <url> <folder> [--cookie-file P] [--quality Q] [--tmp D] [--ffmpeg DIR]
      -> progress lines `vbdprog:<pct>%|<speed>|<eta>` on stdout, then a final
         line with the absolute saved-file path. Exit !=0 + stderr on failure.

Requires Python >= 3.10 (f2's requirement). Built into bin/f2.exe via PyInstaller
(scripts/build-f2.mjs). All of f2's own logging / rich console output is forced
to stderr so stdout carries only our protocol.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import time
from typing import Any, Iterable

# --- Force every library's stdout noise to stderr; keep a clean data channel. ---
# f2 prints rich `Rule(...)` banners and logs to stdout; we must not let that
# corrupt our NDJSON / progress protocol. Duplicate the real stdout, then point
# fd 1 at fd 2 (stderr) so anything that writes to "stdout" lands on stderr.
_DATA = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr  # belt-and-suspenders for Python-level writes


def emit(obj: dict) -> None:
    _DATA.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _DATA.flush()


def emit_line(line: str) -> None:
    _DATA.write(line + "\n")
    _DATA.flush()


def die(msg: str, code: int = 1) -> "None":
    sys.stderr.write(msg.rstrip() + "\n")
    sys.stderr.flush()
    sys.exit(code)


# --------------------------------- cookies ---------------------------------- #

def cookie_header_from_file(path: str | None, hosts: Iterable[str]) -> str:
    """Parse a Netscape cookies.txt into a 'name=value; ...' string for `hosts`."""
    if not path or not os.path.exists(path):
        return ""
    pairs: list[str] = []
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("#"):
                    continue
                cols = line.split("\t")
                if len(cols) < 7:
                    continue
                domain = cols[0].lower()
                if not any(h in domain for h in hosts):
                    continue
                pairs.append(f"{cols[5]}={cols[6]}")
    except OSError:
        return ""
    return "; ".join(pairs)


# ------------------------------ f2 plumbing --------------------------------- #

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

APPS = {
    "douyin": {
        "hosts": ("douyin.com",),
        "referer": "https://www.douyin.com/",
        "video_url": "https://www.douyin.com/video/{id}",
    },
    "tiktok": {
        "hosts": ("tiktok.com",),
        "referer": "https://www.tiktok.com/",
        "video_url": "https://www.tiktok.com/@/video/{id}",
    },
}


def platform_of(url: str) -> str:
    return "tiktok" if "tiktok.com" in url.lower() else "douyin"


def is_user_url(url: str, platform: str) -> bool:
    u = url.lower()
    if "/video/" in u or "/note/" in u or "/photo/" in u:
        return False
    if platform == "douyin":
        return "/user/" in u
    return "/@" in u  # tiktok profile


# Extract IDs ourselves instead of using f2's *IdFetcher, which fires a
# COOKIE-LESS request and reads the redirected URL — Douyin's anti-bot redirects
# that to its homepage, so a valid `/video/<id>` link "isn't supported". Regexing
# the URL we were given (and, for short links, a cookie-aware redirect) is robust.
_VIDEO_ID_RE = re.compile(r"(?:/video/|/note/|/share/video/|modal_id=)(\d{6,})")
_SEC_UID_PATH_RE = re.compile(r"/user/([^/?#&]+)")
_SEC_UID_QUERY_RE = re.compile(r"sec_uid=([^&/?#]+)")


def _find_aweme_id(s: str) -> str | None:
    m = _VIDEO_ID_RE.search(s)
    return m.group(1) if m else None


def _find_sec_uid(s: str) -> str | None:
    m = _SEC_UID_PATH_RE.search(s) or _SEC_UID_QUERY_RE.search(s)
    return m.group(1) if m else None


def _resolve_final_url(url: str, platform: str, cookie: str) -> str:
    """Follow redirects (with our headers + cookie) for short links like v.douyin.com."""
    import httpx

    headers = {"User-Agent": UA, "Referer": APPS[platform]["referer"]}
    if cookie:
        headers["Cookie"] = cookie
    try:
        with httpx.Client(follow_redirects=True, timeout=15, headers=headers) as c:
            return str(c.get(url).url)
    except Exception:
        return url


def resolve_aweme_id(url: str, platform: str, cookie: str) -> str:
    aid = _find_aweme_id(url) or _find_aweme_id(_resolve_final_url(url, platform, cookie))
    if not aid:
        raise ValueError(f"Could not find a {platform} video id in: {url}")
    return aid


async def resolve_sec_uid(url: str, platform: str, cookie: str) -> str:
    sec = _find_sec_uid(url) or _find_sec_uid(_resolve_final_url(url, platform, cookie))
    if sec:
        return sec
    # TikTok profiles (/@name) carry no sec_uid in the URL → fall back to f2's
    # lookup (less anti-bot than Douyin, so its cookie-less request usually works).
    _, SecUserIdFetcher, _ = load_app(platform)
    return await SecUserIdFetcher.get_sec_user_id(url)


def build_kwargs(platform: str, cookie: str) -> dict:
    return {
        "headers": {"User-Agent": UA, "Referer": APPS[platform]["referer"]},
        "proxies": {"http://": None, "https://": None},
        "cookie": cookie,
        "timeout": 8,
        "page_counts": 20,
        "mode": "post",
    }


def load_app(platform: str):
    """Return (Handler, SecUserIdFetcher, AwemeIdFetcher) for the platform."""
    if platform == "tiktok":
        from f2.apps.tiktok.handler import TiktokHandler as Handler  # type: ignore
        from f2.apps.tiktok.utils import SecUserIdFetcher, AwemeIdFetcher  # type: ignore
    else:
        from f2.apps.douyin.handler import DouyinHandler as Handler  # type: ignore
        from f2.apps.douyin.utils import SecUserIdFetcher, AwemeIdFetcher  # type: ignore
    return Handler, SecUserIdFetcher, AwemeIdFetcher


def _first(v: Any) -> Any:
    """f2 filters expose JSONPath list attrs; single-item filters give 1-lists."""
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _at(v: Any, i: int) -> Any:
    if isinstance(v, list):
        return v[i] if i < len(v) else None
    return v if i == 0 else None


def _play_url(addr: Any) -> str | None:
    """video_play_addr item is itself a url_list (mirrors); take the first."""
    if isinstance(addr, list):
        return addr[0] if addr else None
    return addr or None


def _duration_s(ms: Any) -> int | None:
    try:
        return round(float(ms) / 1000) if ms else None
    except (TypeError, ValueError):
        return None


# --------------------------------- list ------------------------------------- #

async def do_list(url: str, cookie: str, limit: int) -> None:
    platform = platform_of(url)
    Handler, _SecUser, _AwemeId = load_app(platform)
    kwargs = build_kwargs(platform, cookie)
    handler = Handler(kwargs)
    vurl = APPS[platform]["video_url"]
    index = 0
    cap = limit if limit and limit > 0 else 10_000

    if is_user_url(url, platform):
        sec_uid = await resolve_sec_uid(url, platform, cookie)
        async for page in handler.fetch_user_post_videos(
            sec_uid, 0, 0, kwargs["page_counts"], cap
        ):
            ids = page.aweme_id or []
            n = len(ids) if isinstance(ids, list) else 1
            for i in range(n):
                if index >= cap:
                    return
                sid = str(_at(page.aweme_id, i) or "")
                if not sid:
                    continue
                emit(
                    {
                        "sourceId": sid,
                        "title": (str(_at(page.desc, i) or sid).strip() or sid),
                        "webpageUrl": vurl.format(id=sid),
                        "thumbnailUrl": _at(page.cover, i),
                        "duration": _duration_s(_at(page.video_duration, i)),
                        "uploader": _at(page.nickname, i),
                        "platform": platform,
                    }
                )
                index += 1
        return

    # single video / note
    aweme_id = resolve_aweme_id(url, platform, cookie)
    v = await handler.fetch_one_video(aweme_id)
    sid = str(_first(v.aweme_id) or aweme_id)
    dur = getattr(v, "duration", None)
    emit(
        {
            "sourceId": sid,
            "title": (str(_first(v.desc) or sid).strip() or sid),
            "webpageUrl": vurl.format(id=sid),
            "thumbnailUrl": _first(getattr(v, "cover", None)),
            "duration": _duration_s(_first(dur)),
            "uploader": _first(v.nickname),
            "platform": platform,
        }
    )


# -------------------------------- download ---------------------------------- #

async def do_download(
    url: str, folder: str, cookie: str, quality: str, tmp: str, ffmpeg_dir: str | None
) -> None:
    import httpx

    platform = platform_of(url)
    Handler, _SecUser, _AwemeId = load_app(platform)
    kwargs = build_kwargs(platform, cookie)
    handler = Handler(kwargs)

    aweme_id = resolve_aweme_id(url, platform, cookie)
    v = await handler.fetch_one_video(aweme_id)
    sid = str(_first(v.aweme_id) or aweme_id)
    play = _play_url(_first(v.video_play_addr))
    if not play:
        die(f"No downloadable video stream for {sid} (image post or region-locked?)")

    os.makedirs(folder, exist_ok=True)
    os.makedirs(tmp, exist_ok=True)
    tmp_path = os.path.join(tmp, f"{sid}.mp4")
    headers = {"User-Agent": UA, "Referer": APPS[platform]["referer"]}
    if cookie:
        headers["Cookie"] = cookie

    started = time.time()
    downloaded = 0
    last_emit = 0.0
    with httpx.stream(
        "GET", play, headers=headers, follow_redirects=True, timeout=30
    ) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length") or 0)
        with open(tmp_path, "wb") as fh:
            for chunk in r.iter_bytes(chunk_size=262144):
                fh.write(chunk)
                downloaded += len(chunk)
                now = time.time()
                if now - last_emit >= 0.3:
                    last_emit = now
                    spd = downloaded / max(now - started, 0.001)
                    pct = (downloaded / total * 100) if total else 0
                    eta = ((total - downloaded) / spd) if (total and spd) else 0
                    emit_line(
                        f"vbdprog:{pct:.1f}%|{spd/1048576:.2f}MiB/s|{int(eta)}s"
                    )
    emit_line("vbdprog:100%|--|0s")

    final = os.path.join(folder, f"{sid}.mp4")
    if quality == "audio":
        final = os.path.join(folder, f"{sid}.mp3")
        ff_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        ff = os.path.join(ffmpeg_dir, ff_name) if ffmpeg_dir else "ffmpeg"
        cmd = [ff, "-y", "-i", tmp_path, "-vn", "-acodec", "libmp3lame", "-q:a", "2", final]
        proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            die("ffmpeg audio extraction failed:\n" + proc.stderr.decode("utf-8", "ignore"))
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    else:
        os.replace(tmp_path, final)

    emit_line(final)  # last bare line = absolute saved path (like after_move:filepath)


# ---------------------------------- main ------------------------------------ #

def main() -> None:
    ap = argparse.ArgumentParser(prog="vbd_f2")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("list")
    pl.add_argument("url")
    pl.add_argument("--cookie-file")
    pl.add_argument("--limit", type=int, default=0)

    pd = sub.add_parser("download")
    pd.add_argument("url")
    pd.add_argument("folder")
    pd.add_argument("--cookie-file")
    pd.add_argument("--quality", default="best")
    pd.add_argument("--tmp", default=".")
    pd.add_argument("--ffmpeg")

    args = ap.parse_args()
    platform = platform_of(args.url)
    cookie = cookie_header_from_file(args.cookie_file, APPS[platform]["hosts"])

    # Silence f2's own logger as much as possible (its console output already
    # goes to stderr via the fd redirect above).
    try:
        import logging

        logging.disable(logging.CRITICAL)
    except Exception:
        pass

    try:
        if args.cmd == "list":
            asyncio.run(do_list(args.url, cookie, args.limit))
        else:
            asyncio.run(
                do_download(
                    args.url, args.folder, cookie, args.quality, args.tmp, args.ffmpeg
                )
            )
    except SystemExit:
        raise
    except Exception as e:  # surface a clean one-line reason to Node
        die(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
