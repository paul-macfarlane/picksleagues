import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { identityLines, initialsOf } from "@/lib/user";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// The one renderer of the repo's decided identity display rule (PKM UX
// feedback): display name is primary, @username is secondary and shown
// wherever there's room. Every surface that displays another user —
// standings, week detail, member lists, the session menu, the profile
// header — renders through this component so the presentation can't drift
// per call site again (engineering rules: "Derived user-display values have
// one home").
const userIdentityVariants = cva("flex min-w-0 items-center", {
  variants: {
    variant: {
      // Two lines — name over @username — for surfaces with room.
      roomy: "gap-3",
      // One line, name only: the tightest surfaces (a fixed-width table row)
      // drop the username rather than compete with the name for space or
      // truncate the name itself.
      compact: "gap-1.5",
    },
  },
  defaultVariants: {
    variant: "roomy",
  },
});

export interface UserIdentityProps extends VariantProps<typeof userIdentityVariants> {
  displayName: string;
  username?: string | null;
  image?: string | null;
  /** Renders the "(You)" marker next to the name. */
  isViewer?: boolean;
  avatarSize?: "sm" | "default" | "lg";
  /** False for text-only renders (e.g. a dropdown label next to its own trigger avatar). */
  showAvatar?: boolean;
  /**
   * Escape hatch for the one legitimate exception to "never show email on an
   * identity surface": the session menu, which shows the *viewer's own*
   * (possibly pre-claim) account and falls back to email exactly like
   * `handleOf`. Every other call site leaves this unset — a null username
   * elsewhere degrades to name-only, never email.
   */
  secondaryOverride?: string | null;
  className?: string;
  /** Extra lines rendered below the name/username stack (e.g. role · joined date). */
  children?: ReactNode;
}

export function UserIdentity({
  displayName,
  username = null,
  image,
  isViewer = false,
  variant = "roomy",
  avatarSize = "default",
  showAvatar = true,
  secondaryOverride,
  className,
  children,
}: UserIdentityProps) {
  const { primary, secondary: derivedSecondary } = identityLines(
    { displayName, username },
    variant ?? "roomy",
  );
  const secondary = secondaryOverride !== undefined ? secondaryOverride : derivedSecondary;

  return (
    <div className={cn(userIdentityVariants({ variant }), className)}>
      {showAvatar && (
        <Avatar size={avatarSize} className="shrink-0">
          <AvatarImage src={image ?? undefined} alt="" />
          <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
        </Avatar>
      )}
      <div className="flex min-w-0 flex-col justify-center">
        <span className="block truncate text-sm font-medium text-foreground">
          {primary}
          {isViewer && <span className="font-normal text-muted-foreground"> (You)</span>}
        </span>
        {secondary && (
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {secondary}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
