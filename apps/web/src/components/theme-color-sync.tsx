import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Keeps the browser-chrome tint on the page's actual background. The
 * `theme-color` metas in index.html key off the OS `prefers-color-scheme`,
 * which the in-app toggle can contradict — this reads the *rendered*
 * background after each theme change, so a palette edit in index.css can
 * never leave the chrome on a stale hex (the metas' static values are only
 * the pre-hydration guess).
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color = getComputedStyle(document.body).backgroundColor;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", color));
  }, [resolvedTheme]);

  return null;
}
