import type { MatchOutcome, ReplaySummary } from "./types.js";

const normName = (s: string) => (s ?? "").trim().replace(/\s+/g, " ");

export function computeReplayOutcome(summary: ReplaySummary): {
  teamA: string[];
  teamB: string[];
  result: MatchOutcome;
} {
  const humans = (summary.players ?? []).filter((player) => !player.isObserver && !player.isComputer);
  if (humans.length !== 8) {
    throw new Error(`Expected 8 human players, got ${humans.length}`);
  }

  const byTeam = new Map<number, typeof humans>();
  for (const player of humans) {
    if (player.team == null) throw new Error("Missing team id");
    (byTeam.get(player.team) ?? byTeam.set(player.team, []).get(player.team)!).push(player);
  }

  const teams = [...byTeam.values()];
  if (teams.length !== 2 || teams.some((team) => team.length !== 4)) {
    throw new Error("Replay must be 4v4");
  }

  const wins = (team: typeof humans) => team.filter((player) => player.isWinner).length;

  let result: MatchOutcome = "D";
  if (wins(teams[0]) && !wins(teams[1])) result = "A";
  if (wins(teams[1]) && !wins(teams[0])) result = "B";

  return {
    teamA: teams[0].map((player) => normName(player.name)),
    teamB: teams[1].map((player) => normName(player.name)),
    result,
  };
}
