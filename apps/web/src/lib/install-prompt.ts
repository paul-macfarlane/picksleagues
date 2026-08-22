import { useCallback, useSyncExternalStore } from "react";

/**
 * The browser-side half of installability (LNCH-16). Chromium announces it
 * with a `beforeinstallprompt` event fired once, early in the page's life —
 * usually before any route that might show an Install button has mounted —
 * so the listener lives at module scope and `main.tsx` imports this module
 * for that side effect. iOS Safari never announces anything; the only
 * affordance there is telling the member where Share → Add to Home Screen
 * lives. Everything else renders no affordance at all.
 */

export const INSTALL_PATH = {
  /** Chromium handed us a deferred prompt; `install()` shows it. */
  native: "native",
  /** iOS Safari: instructions only. */
  ios: "ios",
  none: "none",
} as const;
export type InstallPath = (typeof INSTALL_PATH)[keyof typeof INSTALL_PATH];

// The event isn't in lib.dom yet (Chromium-only, never standardized).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_STORAGE_KEY = "picksleagues-install-dismissed";

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
    notify();
  });
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

// iPadOS reports itself as a Mac; the touch-point count is what separates it.
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Guarded like every other device preference: storage throws in some private
// modes, and a profile card must not take the page down with it.
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function currentPath(): InstallPath {
  if (typeof window === "undefined" || isStandalone() || readDismissed()) return INSTALL_PATH.none;
  if (deferredPrompt) return INSTALL_PATH.native;
  if (isIos()) return INSTALL_PATH.ios;
  return INSTALL_PATH.none;
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
