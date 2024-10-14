import { auth } from "@/auth";
import { TypographyH3 } from "@/components/ui/typography";
import { redirect } from "next/navigation";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth");
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/20 to-background">
      <main className="container mx-auto px-4 py-16 text-center">
        <TypographyH3>Profile Coming Soon</TypographyH3>
      </main>
    </div>
  );
}
