import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuditLog } from "@/components/admin/audit-log";
import { GameAnomaliesCard } from "@/components/admin/game-anomalies-card";

const searchSchema = z.object({
  // Paging lives in the URL, not in component state: an admin who reloads or
  // deep-links mid-trail keeps their place, and the browser Back button steps
  // pages — which is what a pager is expected to do. Absent means page one, so
  // the first page carries no query string at all.
  offset: z.number().int().min(0).optional(),
});

export const Route = createFileRoute("/_authed/admin/audit")({
  validateSearch: searchSchema,
  component: AdminAudit,
});

function AdminAudit() {
  const { offset } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      {/* First because it is the actionable one: the log records what was
          already done, this names what still needs doing. */}
      <GameAnomaliesCard />
      <AuditLog
        offset={offset ?? 0}
        // Deliberately not `replace` (unlike the games browser, where changing
        // week refines one view): each page is a destination Back should return
        // from.
        onOffsetChange={(next) => navigate({ search: next === 0 ? {} : { offset: next } })}
      />
    </>
  );
}
