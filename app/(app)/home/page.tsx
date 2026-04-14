import { getSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await getSession();

  return (
    <div className="flex flex-1 flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">
        Welcome{session.user.name ? `, ${session.user.name}` : ""}
      </h1>
      <p className="text-sm text-muted-foreground">
        Your leagues and invites will show up here.
      </p>
    </div>
  );
}
