import type { Platform } from "@vbd/shared";

/**
 * Per-platform request pacing + adaptive cooldown, so the tool spaces requests
 * to avoid tripping anti-bot limits, and backs off when a block is detected
 * (hammering a flagged IP only extends the ban).
 *
 * Tuning is grounded in observed behaviour:
 *  - Bilibili: aggressive per-IP 412 anti-crawler (minutes→hours); needs the
 *    heaviest pacing + cookies.
 *  - YouTube: rate-limits sessions "for up to an hour"; yt-dlp's own `sleep`
 *    preset uses --sleep-requests 0.75.
 *  - TikTok/Douyin: rate-limit anonymous requests; cookies + pacing help.
 * `--sleep-requests` (delay between extraction HTTP requests) is the main lever.
 */
interface Policy {
  /** seconds between extraction HTTP requests (scan pagination + per-video metadata) */
  sleepRequests: number;
  /** random sleep (min..max seconds) before each download */
  downloadSleepMin: number;
  downloadSleepMax: number;
  /** optional --limit-rate (e.g. "8M") to look less like a scraper */
  limitRate?: string;
  /** yt-dlp internal retries */
  retries: number;
  /** base cooldown applied on the first detected block */
  cooldownBaseMs: number;
}

const MIN = 60_000;

const POLICIES: Record<Platform, Policy> = {
  bilibili: { sleepRequests: 1.5, downloadSleepMin: 2, downloadSleepMax: 6, retries: 5, cooldownBaseMs: 20 * MIN },
  youtube: { sleepRequests: 0.75, downloadSleepMin: 0, downloadSleepMax: 0, retries: 10, cooldownBaseMs: 30 * MIN },
  tiktok: { sleepRequests: 1.0, downloadSleepMin: 1, downloadSleepMax: 4, retries: 10, cooldownBaseMs: 10 * MIN },
  douyin: { sleepRequests: 1.0, downloadSleepMin: 1, downloadSleepMax: 4, retries: 10, cooldownBaseMs: 15 * MIN },
  unknown: { sleepRequests: 0.75, downloadSleepMin: 0, downloadSleepMax: 0, retries: 10, cooldownBaseMs: 15 * MIN },
};

const COOLDOWN_CAP_MS = 2 * 60 * MIN; // 2 hours

function policy(p: Platform): Policy {
  return POLICIES[p] ?? POLICIES.unknown;
}

/** yt-dlp flags that pace requests for a given platform + mode. */
export function throttleArgs(platform: Platform, mode: "scan" | "download"): string[] {
  const p = policy(platform);
  const args = [
    "--sleep-requests",
    String(p.sleepRequests),
    "--retries",
    String(p.retries),
    "--fragment-retries",
    String(p.retries),
  ];
  if (mode === "download") {
    if (p.downloadSleepMin > 0) {
      args.push(
        "--sleep-interval",
        String(p.downloadSleepMin),
        "--max-sleep-interval",
        String(Math.max(p.downloadSleepMin, p.downloadSleepMax)),
      );
    }
    if (p.limitRate) args.push("--limit-rate", p.limitRate);
  }
  return args;
}

/** Does this yt-dlp error look like an anti-bot / rate-limit block? */
export function isBlockError(message: string): boolean {
  return /http error 412|precondition failed|http error 429|too many requests|rate.?limit|try again later|temporarily blocked|access denied/i.test(
    message,
  );
}

/* ------------------------------- cooldowns -------------------------------- */

interface CooldownState {
  until: number;
  strikes: number;
}

const cooldowns = new Map<Platform, CooldownState>();

/** Record a block; returns the new cooldown end timestamp (ms). Exponential per strike. */
export function noteBlock(platform: Platform): number {
  const p = policy(platform);
  const prev = cooldowns.get(platform);
  const strikes = (prev?.strikes ?? 0) + 1;
  const dur = Math.min(p.cooldownBaseMs * 2 ** (strikes - 1), COOLDOWN_CAP_MS);
  const until = Date.now() + dur;
  cooldowns.set(platform, { until, strikes });
  return until;
}

/** Record a success; decays the strike count and clears expired cooldowns. */
export function noteSuccess(platform: Platform): void {
  const cur = cooldowns.get(platform);
  if (!cur) return;
  if (Date.now() >= cur.until) {
    cooldowns.delete(platform);
  } else {
    cooldowns.set(platform, { ...cur, strikes: Math.max(0, cur.strikes - 1) });
  }
}

/** Milliseconds remaining in a platform's cooldown, or 0 if none. */
export function cooldownRemainingMs(platform: Platform): number {
  const cur = cooldowns.get(platform);
  if (!cur) return 0;
  return Math.max(0, cur.until - Date.now());
}

export interface CooldownInfo {
  platform: Platform;
  remainingMs: number;
  until: number;
}

export function activeCooldowns(): CooldownInfo[] {
  const out: CooldownInfo[] = [];
  for (const [platform, st] of cooldowns) {
    const remainingMs = st.until - Date.now();
    if (remainingMs > 0) out.push({ platform, remainingMs, until: st.until });
  }
  return out;
}

export function formatRemaining(ms: number): string {
  const m = Math.ceil(ms / MIN);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}
