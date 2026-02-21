import { db } from "@/lib/db";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
