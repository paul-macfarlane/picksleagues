import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { ProfileForm } from "@/components/profile/profile-form";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const session = await getSession();
  const profile = await getProfileByUserId(session.user.id);

  if (!profile) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Edit profile</h1>
        <p className="text-sm text-muted-foreground">
          Update how you show up in your leagues.
        </p>
      </header>
      <ProfileForm
        mode="edit"
        defaultValues={{
          username: profile.username,
          name: profile.name,
          avatarUrl: profile.avatarUrl ?? undefined,
        }}
      />
    </div>
  );
}
