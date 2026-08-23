import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

// Router CONCATENATES base and active classNames (no tailwind-merge), so the
// active classes only add weight/color on top of the base.
const footerLinkActiveProps = {
  className: "font-medium text-foreground",
  "aria-current": "page" as const,
};

/**
 * The one home for the site links — the footer below wraps them for the
 * splash, the static pages, and the signed-in shells at `sm` and up; the
 * profile page's About section renders them bare on phones, where the
 * footer is hidden (a footer under a bottom tab bar reads as stray content
 * rather than chrome). Adding a link or restyling touches one file. The
 * page the reader is on is highlighted so the list doubles as a "you are
 * here" on the legal pages themselves.
 */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
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
    </div>
  );
}

// Width/border differences stay at the call site via `className`.
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex items-center py-4 text-xs text-muted-foreground", className)}>
      <LegalLinks />
    </footer>
  );
}
