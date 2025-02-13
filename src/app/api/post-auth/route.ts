import { auth } from "@/auth";
import { MAX_USERNAME_LENGTH } from "@/models/users";
import { dbUsernameAvailable, getDBUserById, updateDBUser } from "@/db/users";
import { redirect } from "next/navigation";
import { generateFromEmail, generateUsername } from "unique-username-generator";
import { z } from "zod";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return redirect("/");
  }

  const dbUser = await getDBUserById(session.user.id);
  if (!dbUser) {
    console.error(
      `User with id ${session.user.id} from session not found in db.`,
    );

    return redirect("/");
  }

  const { searchParams } = new URL(request.url!);
  const parseInviteId = z
    .string()
    .uuid()
    .safeParse(searchParams.get("inviteId"));

  if (!dbUser.username) {
    let attempts = 0;
    let username = "";
    while (!username && attempts < 5) {
      attempts++;
      const usernameCandidate =
        dbUser.email && attempts === 1
          ? generateFromEmail(dbUser.email).slice(0, MAX_USERNAME_LENGTH)
          : generateUsername("", 3, MAX_USERNAME_LENGTH);
      if (await dbUsernameAvailable(usernameCandidate)) {
        username = usernameCandidate;
      }
    }

    const nameSplit = session.user.name?.split(" ");
    let firstName = "First Name";
    let lastName = "Last Name";
    if (nameSplit && nameSplit.length > 1) {
      switch (nameSplit.length) {
        case 1:
          firstName = nameSplit[0];
          break;
        case 2:
          firstName = nameSplit[0];
          lastName = nameSplit[1];
          break;
        case 3:
          firstName = nameSplit[0];
          lastName = nameSplit[2];
          break;
      }
    }

    if (username) {
      await updateDBUser(session.user.id, {
        username,
        firstName,
        lastName,
      });
    } else {
      // this is extremely unlikely to happen, but if it does its fine the user will still be able to set their own username anyways
      console.error(
        `Unable to generate unique username for user with id ${dbUser.id}`,
      );
    }

    let profilePageUrl = "/profile?mode=signup";
    if (parseInviteId.success) {
      profilePageUrl += `&inviteId=${parseInviteId.data}`;
    }

    return redirect(profilePageUrl);
  }

  if (parseInviteId.success) {
    return redirect(`/invites/${parseInviteId.data}`);
  }

  return redirect("/");
}
