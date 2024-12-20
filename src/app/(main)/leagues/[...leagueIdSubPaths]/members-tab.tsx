import { DBLeague, getLeagueMemberDetails } from "@/db/leagues";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { InviteDialog } from "./invite-dialog";
import { Users } from "lucide-react";

export async function MembersTab({ dbLeague }: { dbLeague: DBLeague }) {
  const leagueMembers = await getLeagueMemberDetails(dbLeague.id);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>League Members</CardTitle>
        </CardHeader>

        <CardContent>
          <ul className="space-y-4">
            {leagueMembers.map((member) => (
              <li key={member.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Avatar>
                    <AvatarImage
                      src={member.image ?? ""}
                      alt={member.username!}
                    />
                    <AvatarFallback>
                      {member
                        .username!.split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {member.username} ({member.firstName} {member.lastName})
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {member.role}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {leagueMembers.length < dbLeague.size && (
            <InviteDialog leagueId={dbLeague.id} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Members</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {leagueMembers.length} / {dbLeague.size}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
