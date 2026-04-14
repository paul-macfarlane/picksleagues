import { deleteAccountsByUserId, deleteSessionsByUserId } from "@/data/auth";
import { updateProfileByUserId } from "@/data/profiles";
import { updateUserById } from "@/data/users";
import type { Transaction } from "@/data/utils";

const USERNAME_MAX_LENGTH = 50;
const ANONYMOUS_DISPLAY_NAME = "Anonymous User";

export async function anonymizeUser(
  userId: string,
  tx?: Transaction,
): Promise<void> {
  const anonymousEmail = `anonymous+${userId}@deleted.picksleagues.local`;
  const anonymousUsername = `anonymous-${userId}`.slice(0, USERNAME_MAX_LENGTH);

  await deleteSessionsByUserId(userId, tx);
  await deleteAccountsByUserId(userId, tx);
  await updateUserById(
    userId,
    {
      name: ANONYMOUS_DISPLAY_NAME,
      email: anonymousEmail,
      image: null,
    },
    tx,
  );
  await updateProfileByUserId(
    userId,
    {
      username: anonymousUsername,
      name: ANONYMOUS_DISPLAY_NAME,
      avatarUrl: null,
    },
    tx,
  );
}
