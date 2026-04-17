import type { Metadata } from "next";

import { CreateLeagueForm } from "@/components/leagues/create-league-form";

export const metadata: Metadata = {
  title: "Create league",
};

export default function CreateLeaguePage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Create a league</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ll become the first commissioner. You can invite members
          after.
        </p>
      </header>
      <CreateLeagueForm />
    </div>
  );
}
