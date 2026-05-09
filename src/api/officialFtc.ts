import type { FtcTeam, TeamLocation } from "./ftcScout";
import type { TeamCoordinates } from "./teamGeocodes";

export type OfficialFtcTeam = {
  number: number;
  name?: string;
  schoolName?: string;
  city?: string;
  state?: string;
  country?: string;
  website?: string | null;
  rookieYear?: number;
  robotName?: string;
  homeRegion?: string;
  displayLocation?: string;
  logoUrl?: string;
  coordinates?: TeamCoordinates;
};

export type OfficialFtcTeamCache = {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: OfficialFtcTeam[];
};

export type OfficialFtcMetadata = {
  teamCount: number;
  locationCount: number;
  logoCount: number;
  generatedAt: string;
};

export async function fetchOfficialFtcTeamCache(
  season: number,
): Promise<OfficialFtcTeamCache | null> {
  const response = await fetch("/ftc-official-teams.json");

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Official FTC team cache returned ${response.status}`);
  }

  const cache = (await response.json()) as OfficialFtcTeamCache;

  if (cache.season !== season || !Array.isArray(cache.teams)) {
    return null;
  }

  return cache;
}

export function mergeOfficialFtcTeams(
  officialTeams: OfficialFtcTeam[],
  scoutTeams: FtcTeam[],
) {
  const scoutTeamByNumber = new Map(
    scoutTeams.map((team) => [team.number, team] as const),
  );

  return officialTeams
    .map((officialTeam) => {
      if (!officialTeam.number) {
        return null;
      }

      return mergeTeamData(officialTeam, scoutTeamByNumber.get(officialTeam.number));
    })
    .filter((team): team is FtcTeam => team !== null);
}

export function getOfficialFtcMetadata(
  cache: OfficialFtcTeamCache,
): OfficialFtcMetadata {
  return {
    generatedAt: cache.generatedAt,
    teamCount: cache.teamCount,
    locationCount: cache.teams.filter(hasOfficialLocation).length,
    logoCount: cache.teams.filter((team) => Boolean(team.logoUrl)).length,
  };
}

function mergeTeamData(
  officialTeam: OfficialFtcTeam,
  scoutTeam?: FtcTeam,
): FtcTeam {
  const officialLocation = getOfficialLocation(officialTeam);

  return {
    ...scoutTeam,
    number: officialTeam.number,
    name: officialTeam.name || scoutTeam?.name || `Team ${officialTeam.number}`,
    schoolName: officialTeam.schoolName || scoutTeam?.schoolName,
    rookieYear: officialTeam.rookieYear ?? scoutTeam?.rookieYear,
    website: officialTeam.website ?? scoutTeam?.website,
    activeSeasons: scoutTeam?.activeSeasons,
    updatedAt: scoutTeam?.updatedAt,
    robotName: officialTeam.robotName || scoutTeam?.robotName,
    homeRegion: officialTeam.homeRegion || scoutTeam?.homeRegion,
    displayLocation: officialTeam.displayLocation || scoutTeam?.displayLocation,
    logoUrl: officialTeam.logoUrl || scoutTeam?.logoUrl,
    coordinates: officialTeam.coordinates || scoutTeam?.coordinates,
    location: officialLocation ?? scoutTeam?.location ?? emptyLocation(),
  };
}

function getOfficialLocation(team: OfficialFtcTeam): TeamLocation | null {
  if (!hasOfficialLocation(team)) {
    return null;
  }

  return {
    city: team.city?.trim() ?? "",
    state: team.state?.trim() ?? "",
    country: team.country?.trim() ?? "",
  };
}

function hasOfficialLocation(team: OfficialFtcTeam) {
  return Boolean(team.city || team.state || team.country);
}

function emptyLocation(): TeamLocation {
  return {
    city: "",
    state: "",
    country: "",
  };
}
