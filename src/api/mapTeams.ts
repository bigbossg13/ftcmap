import type { FtcTeam } from "./ftcScout";
import { getPublicAssetUrl } from "./publicAsset";

export type MapTeamCache = {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: FtcTeam[];
};

export type SeasonEntry = {
  year: number;
  teamCount: number;
  generatedAt: string;
};

export type SeasonManifest = {
  seasons: SeasonEntry[];
};

export async function fetchMapTeamCache(
  season: number,
): Promise<MapTeamCache | null> {
  const response = await fetch(getPublicAssetUrl("map-teams.json"));

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

export async function fetchArchivedSeasonCache(
  year: number,
): Promise<MapTeamCache | null> {
  const response = await fetch(
    getPublicAssetUrl(`seasons/${year}/map-teams.json`),
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Season ${year} archive returned ${response.status}`);
  }

  const cache = (await response.json()) as MapTeamCache;

  if (!Array.isArray(cache.teams)) {
    return null;
  }

  return cache;
}

export async function fetchSeasonManifest(): Promise<SeasonManifest | null> {
  const response = await fetch(getPublicAssetUrl("seasons.json"));

  if (!response.ok) {
    return null;
  }

  const manifest = (await response.json()) as SeasonManifest;

  if (!Array.isArray(manifest?.seasons)) {
    return null;
  }

  return manifest;
}
