import { DatabaseError } from "pg";

/** drizzle wraps the pg DatabaseError as the DrizzleQueryError's `.cause`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    cause instanceof DatabaseError && cause.code === "23505" && cause.constraint === constraint
  );
}
