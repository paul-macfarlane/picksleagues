import { cn } from "@/lib/utils";

const TEAM_LOGO_DIMENSIONS = {
  sm: 20,
  default: 24,
} as const;

const TEAM_LOGO_SIZE_CLASS: Record<keyof typeof TEAM_LOGO_DIMENSIONS, string> = {
  sm: "size-5",
  default: "size-6",
};

/**
 * Renders whichever of a team's two logo variants matches the active theme.
 * Both `<img>`s are always in the DOM, toggled by the root `.dark` class
 * (index.css `@custom-variant dark`, stamped by the theme toggle) — a
 * CSS-only switch so this tracks the in-app toggle, not just OS
 * `prefers-color-scheme`, without reading theme state in JS. A team missing
 * one variant shows the other in both themes; a team missing both (2 locally)
 * renders nothing, so the caller's abbreviation/name text — always rendered
 * alongside this — stands alone instead of a broken-image icon.
 */
export function TeamLogo({
  logoLightUrl,
  logoDarkUrl,
  size = "default",
  className,
}: {
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  size?: keyof typeof TEAM_LOGO_DIMENSIONS;
  className?: string;
}) {
  if (!logoLightUrl && !logoDarkUrl) return null;
  const dimension = TEAM_LOGO_DIMENSIONS[size];
  const sizeClass = TEAM_LOGO_SIZE_CLASS[size];

  return (
    <>
      {logoLightUrl && (
        <img
          src={logoLightUrl}
          alt=""
          width={dimension}
          height={dimension}
          className={cn(sizeClass, "shrink-0", logoDarkUrl && "dark:hidden", className)}
        />
      )}
      {logoDarkUrl && (
        <img
          src={logoDarkUrl}
          alt=""
          width={dimension}
          height={dimension}
          className={cn(sizeClass, "shrink-0", logoLightUrl && "hidden dark:block", className)}
        />
      )}
    </>
  );
}
