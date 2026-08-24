import { useCallback, useSyncExternalStore } from "react";

/**
 * The browser-side half of installability (LNCH-16). Chromium announces it
 * with a `beforeinstallprompt` event fired once, early in the page's life —
 * usually before any route that might show an Install button has mounted —
 * so the listener lives at module scope and `main.tsx` imports this module
 * for that side effect. iOS Safari never announces anything; the only
 * affordance there is telling the member where Share → Add to Home Screen
 * lives. Android gets the same instruction treatment when no prompt was
 * captured (MOB-8) — Firefox never fires the event, and Chrome holds it back
 * until its installability heuristics pass, which used to leave a phone that
 * *can* install the app with no affordance at all. Desktop browsers with
 * neither path render nothing.
 */

export const INSTALL_PATH = {
  /** Chromium handed us a deferred prompt; `install()` shows it. */
  native: "native",
  /** iOS Safari: instructions only. */
  ios: "ios",
  /**
   * Android with no captured prompt (Firefox always; Chrome until its
   * installability heuristics pass): menu instructions only (MOB-8).
   */
  android: "android",
  none: "none",
} as const;
export type InstallPath = (typeof INSTALL_PATH)[keyof typeof INSTALL_PATH];

// The event isn't in lib.dom yet (Chromium-only, never standardized).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_STORAGE_KEY = "picksleagues-install-dismissed";
const INSTALLED_STORAGE_KEY = "picksleagues-install-completed";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's own mini-infobar; the profile card is the one prompt.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    // Persisted, not just in-memory: this browser tab never becomes
    // standalone, so without a durable record the Android path would offer
    // manual install instructions for an app the member just installed —
    // on this visit and every one after.
    try {
      localStorage.setItem(INSTALLED_STORAGE_KEY, "1");
    } catch {
      // The in-memory prompt reset still hides the card for this visit.
    }
    notify();
  });
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Which family of manual install instructions fits this device, as the
 * `INSTALL_PATH` member to serve when no deferred prompt outranks it (a
 * parallel platform vocabulary would alias these values one-for-one). Pure so
 * the UA edge cases stay pinned by unit test — iPadOS reports itself as a
 * Mac, and the touch-point count is what separates it from one.
 */
export function detectInstallPlatform(
  ua: string,
  maxTouchPoints: number,
): typeof INSTALL_PATH.ios | typeof INSTALL_PATH.android | typeof INSTALL_PATH.none {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1))
    return INSTALL_PATH.ios;
  if (/Android/.test(ua)) return INSTALL_PATH.android;
  return INSTALL_PATH.none;
}

// Guarded like every other device preference: storage throws in some private
// modes, and a profile card must not take the page down with it.
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function currentPath(): InstallPath {
  if (
    typeof window === "undefined" ||
    isStandalone() ||
    readFlag(DISMISSED_STORAGE_KEY) ||
    readFlag(INSTALLED_STORAGE_KEY)
  )
    return INSTALL_PATH.none;
  if (deferredPrompt) return INSTALL_PATH.native;
  return detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallPrompt() {
  const path = useSyncExternalStore(subscribe, currentPath, () => INSTALL_PATH.none);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    // A deferred prompt is single-use whatever the member chooses; Chrome
    // fires a fresh event later if the app is still installable.
    deferredPrompt = null;
    await prompt.prompt();
    notify();
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
    } catch {
      // Dismissal simply doesn't persist.
    }
    notify();
  }, []);

  return { path, install, dismiss };
}
