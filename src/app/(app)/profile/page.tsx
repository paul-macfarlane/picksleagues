import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile/profile-form";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";

export default async function ProfilePage(props: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const { setup } = await props.searchParams;
  const session = await getSession();
  const profile = await getProfileByUserId(session.user.id);

  if (!profile) {
    redirect("/login");
  }

  const isSetup = setup === "true";

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          {isSetup ? "Complete Your Profile" : "Edit Profile"}
        </h1>
        {isSetup && (
          <p className="text-muted-foreground">
            Set up your username and display name to get started
          </p>
        )}
      </div>
      <ProfileForm
        defaultValues={{
          username: profile.username,
          name: profile.name,
          avatarUrl: profile.avatarUrl ?? "",
        }}
        isSetup={isSetup}
      />
    </div>
  );
}
