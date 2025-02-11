"use client";

import { getPointsEarnedAndRemainingFromUserPickData } from "@/shared/picksLeaguePicks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronsUpDown } from "lucide-react";
import { PicksLeagueGameBox } from "@/app/(main)/picks-leagues/[...leagueIdSubPaths]/GameBox";
import { DBWeeklyPickDataByUser } from "@/db/sportLeagueWeeks";
import { PicksLeaguePickTypes } from "@/models/picksLeagues";
import { useState } from "react";

export interface UserPicksProps {
  data: DBWeeklyPickDataByUser;
  pickType: PicksLeaguePickTypes;
  oddEven: "odd" | "even";
}

export function UserPicks({ data, pickType, oddEven }: UserPicksProps) {
  const [picksOpen, setPicksOpen] = useState(false);

  const { pointsEarned, pointsRemaining: pointsAvailable } =
    getPointsEarnedAndRemainingFromUserPickData(data);

  return (
    <div
      key={data.id}
      className={`flex flex-col space-y-2 rounded border ${oddEven === "odd" ? "bg-muted/30" : "bg-card"}`}
    >
      <div
        className={
          "flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between"
        }
      >
        <div className="flex gap-2 md:flex-row md:items-center">
          <Avatar className="h-8 w-8">
            <AvatarImage src={data.image ?? undefined} alt={data.username!} />
            <AvatarFallback>
              {data.username!.charAt(0).toLocaleUpperCase()}
            </AvatarFallback>
          </Avatar>
          {data.username} ({`${data.firstName} ${data.lastName}`})
        </div>

        <ul className="list-inside list-disc md:hidden">
          <li>{pointsEarned} points earned</li>
          <li>{pointsAvailable} points available</li>
        </ul>

        <div className="hidden md:block">
          <span>{pointsEarned} points earned</span>
          {" • "}
          <span>{pointsAvailable} points available</span>
        </div>
      </div>

      <Collapsible className="!m-0 flex flex-col !p-0 md:gap-4">
        <CollapsibleTrigger
          className={
            "flex w-full items-center justify-center gap-2 rounded border bg-accent p-1 md:p-2"
          }
          onClick={() => setPicksOpen(!picksOpen)}
        >
          <ChevronsUpDown className="h-4 w-4" />
          {picksOpen ? "Hide Picks" : "Open Picks"}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {data.games.map((game, index) => (
              <PicksLeagueGameBox
                key={game.id}
                game={game}
                pickType={pickType}
                oddEven={index % 2 === 0 ? "even" : "odd"}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
