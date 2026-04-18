import type { Metadata } from "next";
import Link from "next/link";

import { JoinLinkButton } from "@/components/invites/join-link-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLinkInviteByToken } from "@/data/invites";
import { getLeagueById } from "@/data/leagues";
import { getLeagueMember } from "@/data/members";
import { getOptionalSession } from "@/lib/auth";
import { LEAGUE_ROLE_LABELS } from "@/lib/validators/invites";

export const metadata: Metadata = {
  title: "Join league",
};

export default async function JoinInvitePage(
  props: PageProps<"/join/[token]">,
) {
  const { token } = await props.params;
  const session = await getOptionalSession();

  const invite = await getLinkInviteByToken(token);
  if (!invite) {
    return (
      <Centered>
        <StatusCard
          title="Invite not found"
          description="This link isn't valid. Ask the commissioner for a new one."
        />
      </Centered>
    );
  }

  const expired = invite.expiresAt <= new Date();
  if (expired) {
    return (
      <Centered>
        <StatusCard
          title="Invite expired"
          description="This invite link has expired. Ask the commissioner for a new one."
        />
      </Centered>
    );
  }

  const league = await getLeagueById(invite.leagueId);
  if (!league) {
    return (
      <Centered>
        <StatusCard
          title="League not found"
          description="The league for this invite no longer exists."
        />
      </Centered>
    );
  }

  const existingMember = session
    ? await getLeagueMember(league.id, session.user.id)
    : null;

  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-2xl">Join {league.name}</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join as a{" "}
            {LEAGUE_ROLE_LABELS[invite.role]}.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {existingMember ? (
            <p>You&apos;re already a member of this league.</p>
          ) : session ? (
            <p>
              Click <strong>Join league</strong> to accept the invite. You can
              always leave later.
            </p>
          ) : (
            <p>Sign in to accept this invite.</p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {existingMember ? (
            <Button asChild className="w-full">
              <Link href={`/leagues/${league.id}`}>Go to league</Link>
            </Button>
          ) : session ? (
            <JoinLinkButton token={token} />
          ) : (
            <Button asChild className="w-full">
              <Link
                href={`/login?redirect=${encodeURIComponent(`/join/${token}`)}`}
              >
                Sign in to join
              </Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center">{children}</div>
  );
}

function StatusCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Back to home</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
