import type { Platform } from "@vbd/shared";

declare global {
  interface Window {
    /** Present only when running inside the Electron shell (preload bridge). */
    electronAPI?: {
      isElectron: true;
      /** Native folder picker → chosen absolute path, or null if cancelled. */
      pickFolder(initialDir?: string): Promise<string | null>;
      /**
       * Open an embedded login window for a platform. Returns the captured
       * cookies.txt path (or null) plus whether a real logged-in session cookie
       * was found (drives the ✓ — anonymous cookies don't count).
       */
      login(platform: Platform): Promise<{ path: string | null; loggedIn: boolean }>;
    };
  }
}

export {};
