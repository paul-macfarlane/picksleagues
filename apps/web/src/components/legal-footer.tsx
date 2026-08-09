import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

// Router CONCATENATES base and active classNames (no tailwind-merge), so the
// active classes only add weight/color on top of the base.
const footerLinkActiveProps = {
  className: "font-medium text-foreground",
  "aria-current": "page" as const,
};

/**
 * The one home for the site footer links — the authed shell, the splash, and
 * the static pages all render this, so adding a link or restyling touches one
 * file. Width/border differences stay at the call site via `className`. The
 * page the reader is on is highlighted so the footer doubles as a "you are
 * here" on the legal pages themselves.
 */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex items-center gap-4 py-4 text-xs text-muted-foreground", className)}>
      <Link to="/terms" className="hover:text-foreground" activeProps={footerLinkActiveProps}>
        Terms
      </Link>
      <Link to="/privacy" className="hover:text-foreground" activeProps={footerLinkActiveProps}>
        Privacy
      </Link>
      <a
        href="https://github.com/paul-macfarlane/picksleagues"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground"
      >
        GitHub
      </a>
    </footer>
  );
}
