import { useEffect, useState } from "react";
import { ImageUrlSchema } from "@picksleagues/schemas";

// How long the member must stop typing before we fetch a candidate avatar.
// Long enough that typing a URL costs one request rather than one per prefix.
const SETTLE_MS = 400;

export type AvatarPreview = {
  /** The avatar to render now. Never a URL we haven't already confirmed loads. */
  src: string | null;
  /** A syntactically valid candidate that failed to load — worth telling the member. */
  failed: boolean;
};

function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * The avatar to show while the member is editing their image URL, so they see
 * what they're about to save instead of discovering it after the fact.
 *
 * The candidate is loaded off-screen and swapped in only once it actually
 * decodes. Pointing the rendered `<img>` straight at the field value would
 * fire a request per keystroke and flap the avatar between the fallback
 * initials and the image for every prefix of the URL — and a half-typed URL is
 * a broken image far more often than it is a real one.
 *
 * An empty field previews `providerImage` rather than nothing: emptying the
 * field is the clear, and the clear reverts to the provider's avatar
 * (ADR-0022). Previewing the saved value there would show the member the very
 * image they just removed.
 *
 * Presentation policy — what a screen shows, not a domain rule. Deliberately
 * untested per `.claude/rules/engineering.md` §Quality; the rules underneath it
 * (what validates, what persists, what clears) are pinned in the API tests.
 */
export function useAvatarPreview({
  draft,
  savedImage,
  providerImage,
}: {
  draft: string;
  savedImage: string | null;
  providerImage: string | null;
}): AvatarPreview {
  const candidate = useSettled(draft.trim(), SETTLE_MS);
  const isCandidateUrl = candidate !== "" && ImageUrlSchema.safeParse(candidate).success;
  // Keyed by url so a probe that resolves after the member has typed on can be
  // recognized as stale rather than shown against the wrong candidate.
  const [probe, setProbe] = useState<{ url: string; ok: boolean } | null>(null);

  useEffect(() => {
    // No reset on candidate change: `probe` is keyed by url, so a result for a
    // previous candidate already reads as "not probed yet" below.
    if (!isCandidateUrl) return;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setProbe({ url: candidate, ok: true });
    };
    image.onerror = () => {
      if (!cancelled) setProbe({ url: candidate, ok: false });
    };
    image.src = candidate;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [candidate, isCandidateUrl]);

  if (candidate === "") return { src: providerImage, failed: false };
  // Not a URL yet. The field's own validator owns that complaint at submit —
  // here the avatar just holds steady at what's currently saved.
  if (!isCandidateUrl) return { src: savedImage, failed: false };
  if (probe?.url !== candidate) return { src: savedImage, failed: false };
  return probe.ok ? { src: candidate, failed: false } : { src: savedImage, failed: true };
}
