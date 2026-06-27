import type { Platform, SourceType } from "@vbd/shared";

/**
 * Turn a raw yt-dlp stderr blob into a short, actionable message for the UI.
 * Keeps the original around (trimmed) when nothing matches.
 */
export function humanizeYtDlpError(
  raw: string,
  ctx: { platform: Platform; sourceType: SourceType },
): string {
  const msg = raw.trim();

  // Douyin has no user/channel extractor in yt-dlp.
  if (/unsupported url/i.test(msg) && ctx.platform === "douyin" && ctx.sourceType === "channel") {
    return (
      "Listing a whole Douyin channel isn't supported yet — it's planned for the desktop " +
      "(Electron) build via an embedded browser. For now, paste individual Douyin video " +
      "URLs (douyin.com/video/…) with Cookies set to “From browser”."
    );
  }

  // Bilibili anti-crawler: 412 after too many anonymous requests from this IP.
  if (/http error 412|precondition failed/i.test(msg)) {
    return (
      "Bilibili is rate-limiting this network (HTTP 412 anti-bot). Fix: set Cookies to " +
      "“From browser” — just open bilibili.com in that browser once (no login needed), then " +
      "retry. If it persists, the IP is temporarily flagged: wait ~15–30 min or switch network/VPN."
    );
  }

  if (/fresh cookies|sign in to confirm|not a bot|unable to extract.*render data/i.test(msg)) {
    return (
      "This content needs your browser cookies. Set Cookies (top-right) to “From browser”, " +
      "make sure you've opened the site in that browser recently, then scan again."
    );
  }

  if (/private|login required|members-?only|requires authentication|account.*(private|terminated)/i.test(msg)) {
    return "This content is private or requires login. Set cookies for a logged-in account, then retry.";
  }

  if (/unsupported url/i.test(msg)) {
    return (
      "This URL isn't supported by yt-dlp (or the site changed its URL scheme). " +
      "Double-check the link, or try a direct video URL."
    );
  }

  if (/unavailable|removed|deleted|not available/i.test(msg)) {
    return "This video/page is unavailable (removed, region-locked, or deleted).";
  }

  // Fall back to the last meaningful line of yt-dlp output.
  const lastLine = msg.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return lastLine?.slice(0, 400) ?? "Scan failed";
}
