import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres `citext`: case-insensitive text, used for the unique username
 * column (mvp-spec §Users & Identity — uniqueness is case-insensitive).
 * Drizzle has no built-in citext column builder.
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});
