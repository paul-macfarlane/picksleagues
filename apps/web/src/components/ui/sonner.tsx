import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Top, not sonner's bottom-right default: at phone width the toast is
      // near-full-width along the bottom, which collides with any bottom-`fixed`
      // action bar (league/pickem-picks.tsx's save bar, z-20) — including the
      // failure toast whose own recovery instruction is "press Save again",
      // covered by the very toast telling you to press it. Sonner's toast
      // z-index (999999999) sits outside the app's own header(40)/tabs(30)/
      // bar(20)/overlays(50) ladder entirely, so it can't be reconciled by
      // lowering it — moving position is the fix that removes the whole class
      // of bottom-fixed collisions. A future bottom-fixed element must keep
      // this constraint in mind rather than re-introducing a bottom toaster.
      position="top-center"
      // Offset below the sticky header rather than under it — the same
      // `--app-header-height` custom property TabNav's own sticky offset
      // (tab-nav.tsx) already reads, so this tracks the header's real height
      // (which changes when SimClockBanner mounts/unmounts) instead of a
      // hardcoded number that would drift.
      offset={{ top: "calc(var(--app-header-height, 0px) + 1rem)" }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
