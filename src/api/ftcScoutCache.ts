import type { FtcTeam } from "./ftcScout";
import { getPublicAssetUrl } from "./publicAsset";

export type FtcScoutTeamCache = {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: FtcTeam[];
};

export async function fetchFtcScoutTeamCache(
  season: number,
): Promise<FtcScoutTeamCache | null> {
  const response = await fetch(getPublicAssetUrl("ftcscout-teams.json"));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`FTCScout team cache returned ${response.status}`);
  }

  const cache = (await response.json()) as FtcScoutTeamCache;

  if (cache.season !== season || !Array.isArray(cache.teams)) {
    return null;
  }

  return cache;
}
