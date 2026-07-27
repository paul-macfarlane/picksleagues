import { describe, expect, it } from "vitest";
import {
  canPerformLeagueAction,
  LEAGUE_ACTION,
  leagueActionIsPreStartOnly,
  leagueActionRequiresCommissioner,
  type LeagueAction,
} from "./league-actions";

// Pins the spec §Commissioner Powers table (plus leaving, §Membership) with
// raw literals so a matrix edit fails loudly against the spec, not silently
// against itself.
const SPEC_POWERS: Array<{
  action: LeagueAction;
  commissionerOnly: boolean;
  preStartOnly: boolean;
}> = [
  { action: "edit_name", commissionerOnly: true, preStartOnly: false },
  { action: "edit_visibility", commissionerOnly: true, preStartOnly: true },
  { action: "edit_settings", commissionerOnly: true, preStartOnly: true },
  { action: "delete_league", commissionerOnly: true, preStartOnly: true },
  { action: "kick_member", commissionerOnly: true, preStartOnly: true },
  { action: "promote_member", commissionerOnly: true, preStartOnly: false },
  { action: "demote_commissioner", commissionerOnly: true, preStartOnly: false },
  { action: "manage_invites", commissionerOnly: true, preStartOnly: false },
  { action: "leave_league", commissionerOnly: false, preStartOnly: true },
  { action: "renew_season", commissionerOnly: true, preStartOnly: false },
];

describe("league action matrix", () => {
  it("covers every declared action exactly once", () => {
    expect(SPEC_POWERS.map((p) => p.action).sort()).toEqual(Object.values(LEAGUE_ACTION).sort());
  });

  it.each(SPEC_POWERS)(
    "$action: commissionerOnly=$commissionerOnly preStartOnly=$preStartOnly",
    ({ action, commissionerOnly, preStartOnly }) => {
      expect(leagueActionRequiresCommissioner(action)).toBe(commissionerOnly);
      expect(leagueActionIsPreStartOnly(action)).toBe(preStartOnly);
    },
  );
});

describe("canPerformLeagueAction", () => {
  it.each(SPEC_POWERS)(
    "$action combines both axes",
    ({ action, commissionerOnly, preStartOnly }) => {
      // Commissioner, pre-start: everything is allowed.
      expect(canPerformLeagueAction(action, { role: "commissioner", preStart: true })).toBe(true);
      // Plain member, pre-start: only non-commissioner actions.
      expect(canPerformLeagueAction(action, { role: "member", preStart: true })).toBe(
        !commissionerOnly,
      );
      // Commissioner, post-start: only window-free actions.
      expect(canPerformLeagueAction(action, { role: "commissioner", preStart: false })).toBe(
        !preStartOnly,
      );
      // Plain member, post-start: needs both axes clear.
      expect(canPerformLeagueAction(action, { role: "member", preStart: false })).toBe(
        !commissionerOnly && !preStartOnly,
      );
    },
  );
});
