import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireAdminSession } from "@/lib/permissions";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  try {
    await requireAdminSession();
  } catch (err) {
    // Silent redirect — admin panel existence stays hidden from non-admins.
    if (err instanceof ForbiddenError || err instanceof NotFoundError) {
      redirect("/home");
    }
    throw err;
  }

  return <>{children}</>;
}
