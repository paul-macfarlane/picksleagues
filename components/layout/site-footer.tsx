import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-4 py-6 text-sm text-muted-foreground sm:px-6">
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p>&copy; {new Date().getFullYear()} PicksLeagues</p>
        <nav className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
