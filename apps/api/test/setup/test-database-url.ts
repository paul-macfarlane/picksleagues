/**
 * Single source for the integration test DB URL — read by both the global
 * setup (create + migrate) and individual test files (connect). CI points
 * `TEST_DATABASE_URL` at a service container; nothing else may hardcode the
 * local Docker port.
 */
export function getTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/picksleagues_test"
  );
}
