import type { FtcTeam } from "./ftcScout";

export type MapTeamCache = {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: FtcTeam[];
};

export async function fetchMapTeamCache(
  season: number,
): Promise<MapTeamCache | null> {
  const response = await fetch("/map-teams.json");

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Map team cache returned ${response.status}`);
  }

  const cache = (await response.json()) as MapTeamCache;

  if (cache.season !== season || !Array.isArray(cache.teams)) {
    return null;
  }

  return cache;
}
