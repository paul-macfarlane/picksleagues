/**
 * The app mark (LNCH-7): a tilted football whose laces are a checkmark — the
 * pick stitched into the ball. Geometry and colors are duplicated in the
 * static brand assets (`public/favicon.svg`, `public/*.png`), which can't
 * import this component — a mark change edits both or they drift. The PWA
 * icon set regenerates from `scripts/render-pwa-icons.mjs`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      {/* Only the ball rotates — the check stays axis-aligned or it stops
          reading as a check. */}
      <path
        d="M0.5 16 C5 5 27 5 31.5 16 C27 27 5 27 0.5 16 Z"
        transform="rotate(-45 16 16)"
        className="fill-brand"
      />
      <path
        d="M10 16.5 L14.3 20.8 L22.5 11.5"
        fill="none"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-brand-foreground"
      />
    </svg>
  );
}
