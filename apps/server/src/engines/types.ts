import type { Platform } from "@vbd/shared";
import type {
  CookieConfig,
  DownloadCallbacks,
  DownloadHandle,
  DownloadOptions,
  ScanEntry,
  ScanHandle,
} from "../ytdlp.js";

/**
 * The two operations every platform engine can provide. Signatures mirror
 * `ytdlp.scan` / `ytdlp.download` exactly so the scanner/queue can swap engines
 * without any adapter. An engine may implement either or both.
 */
export type ScanFn = (
  url: string,
  platform: Platform,
  cookies: CookieConfig,
  onEntry: (entry: ScanEntry, index: number) => void,
  limit?: number,
) => ScanHandle;

export type DownloadFn = (opts: DownloadOptions, cb: DownloadCallbacks) => DownloadHandle;
