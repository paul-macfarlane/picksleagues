import { Link } from "@tanstack/react-router";
import { useMe } from "@/api/me";

const linkClassName = "text-muted-foreground underline hover:text-foreground";

/**
 * The pick sheets' guide links: the mode's rules, plus — only where the
 * simulator exists (`simEnabled` on /me, never true in production) — the
 * simulator guide, so a staging tester finds "why is the calendar weird"
 * exactly where they find the rules (FB-10). One component rather than two
 * copies of the conditional, so the sheets can't drift on when the guide
 * shows. New tab on purpose: the sheets' drafts live only in local state, and
 * a same-tab navigation would unmount them and silently discard the picks.
 */
export function PickSheetGuideLinks({
  rulesTo,
  rulesLabel,
}: {
  rulesTo: "/rules/pickem" | "/rules/survivor";
  rulesLabel: string;
}) {
  const me = useMe();

  return (
    <p className="flex flex-wrap gap-x-3 text-xs">
      <Link to={rulesTo} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        {rulesLabel}
      </Link>
      {me.data?.simEnabled && (
        <Link
          to="/rules/simulator"
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
        >
          How the simulator works
        </Link>
      )}
    </p>
  );
}
