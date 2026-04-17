"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";

// Mount gate: SSR + initial-hydration return false, post-mount returns true.
// Gates the theme-dependent src switch until next-themes resolves on the
// client, avoiding a hydration mismatch. Preferred over `useEffect + useState`
// because useSyncExternalStore produces the correct value in a single render
// (no second commit/re-render just to flip `mounted`).
const emptySubscribe = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

interface TeamLogoProps {
  logoUrl: string | null;
  logoDarkUrl: string | null;
  alt: string;
  width: number;
  height: number;
  className?: string;
}

export function TeamLogo({
  logoUrl,
  logoDarkUrl,
  alt,
  width,
  height,
  className,
}: TeamLogoProps) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, getTrue, getFalse);
  const [darkFailed, setDarkFailed] = useState(false);

  const useDark =
    mounted && resolvedTheme === "dark" && !!logoDarkUrl && !darkFailed;
  const src = useDark ? logoDarkUrl : logoUrl;

  if (!src) return null;

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={
        useDark
          ? () => {
              if (process.env.NODE_ENV !== "production") {
                console.warn(`TeamLogo: dark logo failed to load: ${src}`);
              }
              setDarkFailed(true);
            }
          : undefined
      }
    />
  );
}
