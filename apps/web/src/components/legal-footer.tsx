import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * The one home for the Terms/Privacy footer links — the authed shell, the
 * splash, and the static pages all render this, so adding a link or restyling
 * touches one file. Width/border differences stay at the call site via
 * `className`.
 */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex items-center gap-4 py-4 text-xs text-muted-foreground", className)}>
      <Link to="/terms" className="hover:text-foreground">
        Terms
      </Link>
      <Link to="/privacy" className="hover:text-foreground">
        Privacy
      </Link>
    </footer>
  );
}
