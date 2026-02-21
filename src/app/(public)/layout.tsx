import { redirectIfAuthenticated } from "@/lib/auth";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await redirectIfAuthenticated();

  return <>{children}</>;
}
