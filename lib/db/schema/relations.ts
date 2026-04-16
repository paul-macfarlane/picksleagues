import { relations } from "drizzle-orm";

import {
  externalEvents,
  externalPhases,
  externalSeasons,
  externalSportsbooks,
  externalTeams,
} from "./external";
import {
  dataSources,
  events,
  odds,
  phases,
  seasons,
  sportsbooks,
  sportsLeagues,
  teams,
} from "./sports";

// --- Core table relations ---

export const sportsLeaguesRelations = relations(sportsLeagues, ({ many }) => ({
  seasons: many(seasons),
  teams: many(teams),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  sportsLeague: one(sportsLeagues, {
    fields: [seasons.sportsLeagueId],
    references: [sportsLeagues.id],
  }),
  phases: many(phases),
}));

export const phasesRelations = relations(phases, ({ one, many }) => ({
  season: one(seasons, {
    fields: [phases.seasonId],
    references: [seasons.id],
  }),
  events: many(events),
}));

export const teamsRelations = relations(teams, ({ one }) => ({
  sportsLeague: one(sportsLeagues, {
    fields: [teams.sportsLeagueId],
    references: [sportsLeagues.id],
  }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  phase: one(phases, {
    fields: [events.phaseId],
    references: [phases.id],
  }),
  homeTeam: one(teams, {
    fields: [events.homeTeamId],
    references: [teams.id],
    relationName: "homeTeam",
  }),
  awayTeam: one(teams, {
    fields: [events.awayTeamId],
    references: [teams.id],
    relationName: "awayTeam",
  }),
  odds: many(odds),
}));

export const oddsRelations = relations(odds, ({ one }) => ({
  event: one(events, {
    fields: [odds.eventId],
    references: [events.id],
  }),
  sportsbook: one(sportsbooks, {
    fields: [odds.sportsbookId],
    references: [sportsbooks.id],
  }),
}));

// --- External bridge table relations ---

export const externalSeasonsRelations = relations(
  externalSeasons,
  ({ one }) => ({
    dataSource: one(dataSources, {
      fields: [externalSeasons.dataSourceId],
      references: [dataSources.id],
    }),
    season: one(seasons, {
      fields: [externalSeasons.seasonId],
      references: [seasons.id],
    }),
  }),
);

export const externalPhasesRelations = relations(externalPhases, ({ one }) => ({
  dataSource: one(dataSources, {
    fields: [externalPhases.dataSourceId],
    references: [dataSources.id],
  }),
  phase: one(phases, {
    fields: [externalPhases.phaseId],
    references: [phases.id],
  }),
}));

export const externalTeamsRelations = relations(externalTeams, ({ one }) => ({
  dataSource: one(dataSources, {
    fields: [externalTeams.dataSourceId],
    references: [dataSources.id],
  }),
  team: one(teams, {
    fields: [externalTeams.teamId],
    references: [teams.id],
  }),
}));

export const externalEventsRelations = relations(externalEvents, ({ one }) => ({
  dataSource: one(dataSources, {
    fields: [externalEvents.dataSourceId],
    references: [dataSources.id],
  }),
  event: one(events, {
    fields: [externalEvents.eventId],
    references: [events.id],
  }),
}));

export const externalSportsbooksRelations = relations(
  externalSportsbooks,
  ({ one }) => ({
    dataSource: one(dataSources, {
      fields: [externalSportsbooks.dataSourceId],
      references: [dataSources.id],
    }),
    sportsbook: one(sportsbooks, {
      fields: [externalSportsbooks.sportsbookId],
      references: [sportsbooks.id],
    }),
  }),
);
