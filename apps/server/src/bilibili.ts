import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Platform } from "@vbd/shared";
import { YTDLP_PATH } from "./config.js";
import type { CookieConfig, ScanEntry, ScanHandle } from "./ytdlp.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PAGE_SIZE = 30;
const PAGE_SLEEP_MS = 1200; // gentle pacing between pages
const SAFETY_MAX = 5000; // cap when no explicit limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ WBI signing -------------------------------- */
// Bilibili's `x/space/arc/search` now requires WBI-signed params (wts + w_rid).
// Unsigned requests trip risk-control (-412/-799) after the first page — this is
// the real reason a channel scan dies at ~30 videos, not raw request rate.

// Fixed permutation table Bilibili uses to derive the 32-char mixin key.
const MIXIN_KEY_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
  54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let wbiKeys: { imgKey: string; subKey: string; at: number } | null = null;

/** Fetch (and cache ~6h) the WBI img/sub keys from the nav endpoint. */
async function getWbiKeys(cookieHeader: string): Promise<{ imgKey: string; subKey: string }> {
  if (wbiKeys && Date.now() - wbiKeys.at < 6 * 3600_000) return wbiKeys;
  const headers: Record<string, string> = { "User-Agent": UA, Referer: "https://www.bilibili.com/" };
  if (cookieHeader) headers.Cookie = cookieHeader;
  const r = await fetch("https://api.bilibili.com/x/web-interface/nav", { headers });
  const j: any = await r.json();
  const base = (u: string) => u.split("/").pop()?.split(".")[0] ?? "";
  const imgKey = base(j?.data?.wbi_img?.img_url ?? "");
  const subKey = base(j?.data?.wbi_img?.sub_url ?? "");
  if (!imgKey || !subKey) throw new Error("Could not fetch Bilibili WBI keys");
  wbiKeys = { imgKey, subKey, at: Date.now() };
  return wbiKeys;
}

function mixinKey(imgKey: string, subKey: string): string {
  const s = imgKey + subKey;
  return MIXIN_KEY_TAB.map((i) => s[i] ?? "").join("").slice(0, 32);
}

/** Sign params: add `wts`, sort, md5(query+mixinKey) → `w_rid`. Returns a query string. */
function encWbi(params: Record<string, string | number>, imgKey: string, subKey: string): string {
  const mk = mixinKey(imgKey, subKey);
  const signed: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(signed)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(signed[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  const wRid = crypto.createHash("md5").update(query + mk).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

/** Returns the user mid if `url` is a Bilibili space (channel) URL, else null. */
export function isBilibiliSpace(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim());
    if (!u.hostname.toLowerCase().startsWith("space.bilibili.com")) return null;
    const m = u.pathname.match(/^\/(\d+)/);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** "MM:SS" or "HH:MM:SS" → seconds. */
export function parseLength(s: string | undefined): number | null {
  if (!s) return null;
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Bilibili thumbnails come as `//i0.hdslb.com/...` (or http). Force https. */
export function normalizePic(pic: string | undefined): string | null {
  if (!pic) return null;
  if (pic.startsWith("//")) return "https:" + pic;
  if (pic.startsWith("http://")) return "https://" + pic.slice("http://".length);
  return pic;
}

/** Parse a Netscape cookies.txt into a "name=value; …" header (bilibili.com only). */
export function cookiesFromFile(file: string): string {
  try {
    const txt = fs.readFileSync(file, "utf8");
    const pairs: string[] = [];
    for (const line of txt.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const cols = line.split("\t");
      if (cols.length < 7) continue;
      if (!cols[0]!.toLowerCase().includes("bilibili.com")) continue;
      pairs.push(`${cols[5]}=${cols[6]}`);
    }
    return pairs.join("; ");
  } catch {
    return "";
  }
}

/** Best-effort: export browser cookies via yt-dlp to a temp file, read bilibili ones, delete it. */
async function cookiesFromBrowser(
  browser: string,
): Promise<{ cookies: string; error: "locked" | "decrypt" | "empty" | null }> {
  const tmp = path.join(os.tmpdir(), `vbd-cookies-${process.pid}-${Date.now()}.txt`);
  let stderr = "";
  try {
    await new Promise<void>((resolve) => {
      const child = spawn(
        YTDLP_PATH,
        [
          "--cookies-from-browser",
          browser,
          "--cookies",
          tmp,
          "--simulate",
          "--no-warnings",
          "--ignore-errors",
          "https://www.bilibili.com/",
        ],
        { windowsHide: true },
      );
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", () => resolve());
      child.on("close", () => resolve());
    });
    const cookies = fs.existsSync(tmp) ? cookiesFromFile(tmp) : "";
    let error: "locked" | "decrypt" | "empty" | null = null;
    if (!/SESSDATA/i.test(cookies)) {
      if (/could not copy|permission denied|in use|locked/i.test(stderr)) error = "locked";
      else if (/decrypt|dpapi/i.test(stderr)) error = "decrypt";
      else error = "empty";
    }
    return { cookies, error };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** Build a Cookie header: a freshly-primed buvid3 plus any login cookies the job provides. */
export async function buildCookieHeader(
  cookies: CookieConfig,
): Promise<{ header: string; hasLogin: boolean }> {
  const parts: string[] = [];
  try {
    const r = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA } });
    const setCookies: string[] = (r.headers as any).getSetCookie?.() ?? [];
    const b3 = setCookies.find((c) => c.startsWith("buvid3="));
    if (b3) parts.push(b3.split(";")[0]!);
  } catch {
    /* ignore — proceed without buvid3 */
  }

  if (cookies.cookieMode === "file" && cookies.cookieFilePath) {
    const c = cookiesFromFile(cookies.cookieFilePath);
    if (c) parts.push(c);
  } else if (cookies.cookieMode === "browser" && cookies.cookieBrowser) {
    // If the user explicitly chose browser login but we can't read it, fail loudly
    // (otherwise we'd silently fall back to buvid3 and just get rate-limited).
    const { cookies: c, error } = await cookiesFromBrowser(cookies.cookieBrowser);
    if (error) {
      const why =
        error === "locked"
          ? `${cookies.cookieBrowser} is open and locks its cookie database`
          : error === "decrypt"
            ? "cookie decryption failed"
            : "no logged-in cookie found (check you're logged in to the right browser profile)";
      throw new Error(
        `Couldn't read ${cookies.cookieBrowser} login cookies (${why}). ` +
          `Fully quit ${cookies.cookieBrowser} and retry, or export a cookies.txt ` +
          `(“Get cookies.txt LOCALLY” extension) and set Cookies = “cookies.txt file”.`,
      );
    }
    parts.push(c);
  }
  const header = parts.join("; ");
  return { header, hasLogin: /SESSDATA=/i.test(header) };
}

/**
 * Enumerate a Bilibili user's videos via the web API. Richer than yt-dlp's flat
 * scan (titles + thumbnails + duration in one request per 30 videos) and paces
 * itself to avoid the per-IP risk-control. Throws a block-style error on -412 /
 * -352 / -799 so the scanner records a cooldown.
 */
export function enumerateBilibiliSpace(
  mid: string,
  cookies: CookieConfig,
  onEntry: (entry: ScanEntry, index: number) => void,
  limit?: number,
): ScanHandle {
  let canceled = false;
  const controller = new AbortController();

  const promise = (async (): Promise<{ count: number }> => {
    const { header: cookieHeader, hasLogin } = await buildCookieHeader(cookies);
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Referer: `https://space.bilibili.com/${mid}/video`,
    };
    if (cookieHeader) headers.Cookie = cookieHeader;

    // Sign requests (WBI) so every page looks legitimate — without this the API
    // trips risk-control right after page 1, which is the "blocked at 30 videos" bug.
    // Best-effort: if the keys can't be fetched, fall back to unsigned (no worse
    // than before) rather than failing the whole scan.
    let wbi: { imgKey: string; subKey: string } | null = null;
    try {
      wbi = await getWbiKeys(cookieHeader);
    } catch {
      /* proceed unsigned */
    }

    // When Bilibili blocks us, the right advice depends on whether we sent a login.
    const blocked = (detail: string): Error =>
      hasLogin
        ? // real rate-limit despite login → block error → scanner sets a cooldown
          new Error(
            `Bilibili rate-limited this request (${detail}) even though you're signed in — ` +
              `this IP is flagged. Wait 15–60 min or switch network/VPN.`,
          )
        : // no login was sent → actionable, and intentionally free of block-keywords
          // (e.g. -799) so it doesn't trigger a cooldown — fix cookies and retry now.
          new Error(
            "Bilibili needs login to list this channel — no SESSDATA cookie was sent. " +
              "Click “Sign in: Bilibili”, finish logging in, close that window, then scan again.",
          );

    const max = limit && limit > 0 ? limit : SAFETY_MAX;
    let pn = 1;
    let index = 0;
    let total = Infinity;

    while (!canceled && index < total && index < max) {
      const q = wbi
        ? encWbi({ mid, ps: PAGE_SIZE, pn, order: "pubdate" }, wbi.imgKey, wbi.subKey)
        : `mid=${mid}&ps=${PAGE_SIZE}&pn=${pn}&order=pubdate`;
      const url = `https://api.bilibili.com/x/space/arc/search?${q}`;
      const res = await fetch(url, { headers, signal: controller.signal });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) {
        throw blocked(`HTTP ${res.status} non-JSON challenge`);
      }
      const j: any = await res.json();
      if (j.code !== 0) {
        throw blocked(`code ${j.code}: ${j.message || "请求被拦截"}`);
      }
      total = j.data?.page?.count ?? 0;
      const vlist: any[] = j.data?.list?.vlist ?? [];
      if (vlist.length === 0) break;

      for (const v of vlist) {
        if (canceled || index >= max) break;
        const bvid = String(v.bvid ?? "");
        if (!bvid) continue;
        onEntry(
          {
            sourceId: bvid,
            title: String(v.title ?? bvid),
            webpageUrl: `https://www.bilibili.com/video/${bvid}`,
            thumbnailUrl: normalizePic(v.pic),
            duration: parseLength(v.length),
            uploader: v.author ?? null,
            platform: "bilibili" as Platform,
          },
          index++,
        );
      }
      pn++;
      if (!canceled && index < total && index < max) await sleep(PAGE_SLEEP_MS);
    }
    return { count: index };
  })();

  return {
    promise,
    cancel: () => {
      canceled = true;
      controller.abort();
    },
  };
}
