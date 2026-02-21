import Link from "next/link";
import { Plus, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <OpenInvitesSection />
      <MyLeaguesSection />
    </div>
  );
}

function OpenInvitesSection() {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Open Invites</h2>
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-muted-foreground text-sm">
          No pending invites right now.
        </p>
      </div>
    </section>
  );
}

function MyLeaguesSection() {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">My Leagues</h2>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/leagues/create">
            <Plus className="h-4 w-4" />
            Create League
          </Link>
        </Button>
      </div>
      <div className="rounded-lg border border-dashed p-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border">
          <Trophy className="text-muted-foreground h-5 w-5" />
        </div>
        <p className="text-muted-foreground text-sm">
          You&apos;re not in any leagues yet. Create one or join via invite!
        </p>
      </div>
    </section>
  );
}
