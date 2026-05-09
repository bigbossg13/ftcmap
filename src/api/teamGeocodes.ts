import type { FtcTeam } from "./ftcScout";

export type TeamCoordinates = {
  lat: number;
  lng: number;
  source?: string;
  query?: string;
};

type TeamGeocodeRecord = TeamCoordinates & {
  number: number;
};

type TeamGeocodeCache = {
  generatedAt: string;
  teamCount: number;
  teams: TeamGeocodeRecord[];
};

export async function fetchTeamGeocodeCache() {
  const response = await fetch("/team-geocodes.json");

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Team geocode cache returned ${response.status}`);
  }

  const cache = (await response.json()) as TeamGeocodeCache;

  if (!Array.isArray(cache.teams)) {
    return null;
  }

  return cache;
}

export function mergeTeamGeocodes(
  teams: FtcTeam[],
  cache: TeamGeocodeCache | null,
) {
  if (!cache) {
    return teams;
  }

  const geocodeByTeam = new Map(
    cache.teams
      .filter(hasValidCoordinates)
      .map((geocode) => [geocode.number, geocode] as const),
  );

  return teams.map((team) => {
    const geocode = geocodeByTeam.get(team.number);

    if (!geocode) {
      return team;
    }

    return {
      ...team,
      coordinates: {
        lat: geocode.lat,
        lng: geocode.lng,
        source: geocode.source,
        query: geocode.query,
      },
    };
  });
}

export function buildGeocodedTeams(
  teams: FtcTeam[],
  cache: TeamGeocodeCache | null,
) {
  if (!cache) {
    return [];
  }

  const teamByNumber = new Map(teams.map((team) => [team.number, team] as const));
  const geocodedTeams: FtcTeam[] = [];

  cache.teams.filter(hasValidCoordinates).forEach((geocode) => {
    const team = teamByNumber.get(geocode.number);

    if (!team) {
      return;
    }

    geocodedTeams.push({
      ...team,
      coordinates: {
        lat: geocode.lat,
        lng: geocode.lng,
        source: geocode.source,
        query: geocode.query,
      },
    });
  });

  return geocodedTeams;
}

function hasValidCoordinates(
  geocode: TeamGeocodeRecord,
): geocode is TeamGeocodeRecord {
  return (
    typeof geocode.number === "number" &&
    typeof geocode.lat === "number" &&
    Number.isFinite(geocode.lat) &&
    typeof geocode.lng === "number" &&
    Number.isFinite(geocode.lng)
  );
}
