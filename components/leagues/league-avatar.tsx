"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: "size-8 text-sm",
  md: "size-10 text-base",
  lg: "size-14 text-lg",
} as const;

type LeagueAvatarSize = keyof typeof SIZE_CLASSES;

export function LeagueAvatar({
  name,
  imageUrl,
  size = "md",
  className,
}: {
  name: string;
  imageUrl?: string | null;
  size?: LeagueAvatarSize;
  className?: string;
}) {
  const src = imageUrl && imageUrl.trim().length > 0 ? imageUrl.trim() : null;
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg bg-muted",
        SIZE_CLASSES[size],
        className,
      )}
      aria-hidden
    >
      <LeagueAvatarImage key={src ?? "no-src"} src={src} name={name} />
    </div>
  );
}

function LeagueAvatarImage({
  src,
  name,
}: {
  src: string | null;
  name: string;
}) {
  const [errored, setErrored] = useState(false);
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";

  if (src === null || errored) {
    return (
      <div className="flex h-full w-full items-center justify-center font-semibold text-muted-foreground">
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      onError={() => setErrored(true)}
    />
  );
}
