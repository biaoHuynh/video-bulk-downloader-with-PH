import type { Platform, SourceType } from "./types";

export interface SourceInfo {
  platform: Platform;
  type: SourceType;
}

/**
 * Best-effort classification of a submitted URL into {platform, type}.
 *
 * This is a heuristic to drive the UI and pick yt-dlp flags; yt-dlp itself is
 * the source of truth at scan time (its reported `_type` overrides `type` when
 * they disagree). Returns platform "unknown" for unrecognised hosts so the
 * caller can still hand the URL to yt-dlp.
 */
export function detectSource(rawUrl: string): SourceInfo {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { platform: "unknown", type: "channel" };
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname;
  const params = url.searchParams;

  // ---------------------------- YouTube ----------------------------
  if (host.endsWith("youtube.com") || host === "youtu.be") {
    if (host === "youtu.be") return { platform: "youtube", type: "video" };
    if (path.startsWith("/watch") && params.has("v"))
      return { platform: "youtube", type: "video" };
    if (path.startsWith("/shorts/") || path.startsWith("/live/"))
      return { platform: "youtube", type: "video" };
    if (path.startsWith("/playlist") && params.has("list"))
      return { platform: "youtube", type: "playlist" };
    // @handle, /channel/UC..., /c/Name, /user/Name, optionally /videos /streams
    if (
      path.startsWith("/@") ||
      path.startsWith("/channel/") ||
      path.startsWith("/c/") ||
      path.startsWith("/user/")
    )
      return { platform: "youtube", type: "channel" };
    return { platform: "youtube", type: "channel" };
  }

  // ---------------------------- TikTok -----------------------------
  if (host.endsWith("tiktok.com")) {
    if (/\/video\/\d+/.test(path) || /\/photo\/\d+/.test(path))
      return { platform: "tiktok", type: "video" };
    if (path.includes("/playlist/"))
      return { platform: "tiktok", type: "playlist" };
    if (path.startsWith("/@")) return { platform: "tiktok", type: "channel" };
    return { platform: "tiktok", type: "video" };
  }

  // ---------------------------- Douyin -----------------------------
  if (host.endsWith("douyin.com")) {
    if (path.startsWith("/video/") || path.startsWith("/note/"))
      return { platform: "douyin", type: "video" };
    if (path.startsWith("/user/")) return { platform: "douyin", type: "channel" };
    return { platform: "douyin", type: "video" };
  }

  // --------------------------- Bilibili ----------------------------
  // bilibili.com = mainland; bilibili.tv / biliintl.com = international (Bstation).
  if (
    host.endsWith("bilibili.com") ||
    host === "b23.tv" ||
    host.endsWith("bilibili.tv") ||
    host.endsWith("biliintl.com")
  ) {
    if (host.startsWith("space.")) return { platform: "bilibili", type: "channel" };
    if (host.endsWith("bilibili.tv") || host.endsWith("biliintl.com")) {
      if (/\/play\/\d+\/\d+/.test(path) || /\/video\/\d+/.test(path))
        return { platform: "bilibili", type: "video" };
      if (/\/play\/\d+/.test(path)) return { platform: "bilibili", type: "playlist" };
      return { platform: "bilibili", type: "channel" };
    }
    if (/\/video\/(BV|av)/i.test(path)) return { platform: "bilibili", type: "video" };
    if (
      path.includes("/festival/") ||
      path.includes("/medialist/") ||
      path.includes("/lists/") ||
      path.includes("seriesdetail") ||
      path.includes("collectiondetail")
    )
      return { platform: "bilibili", type: "playlist" };
    return { platform: "bilibili", type: "video" };
  }

  return { platform: "unknown", type: "channel" };
}

/** Human-readable label for a platform. */
export function platformLabel(p: Platform): string {
  switch (p) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "douyin":
      return "Douyin";
    case "bilibili":
      return "Bilibili";
    default:
      return "Unknown";
  }
}
