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

export function buildGeocodedTeams(
  teams: FtcTeam[],
  cache: TeamGeocodeCache | null,
) {
  const geocodeByTeam = new Map(
    (cache?.teams ?? [])
      .filter(hasValidGeocodeRecord)
      .map((geocode) => [geocode.number, geocode] as const),
  );

  return teams.flatMap((team) => {
    const coordinates = getValidCoordinates(
      geocodeByTeam.get(team.number) ?? team.coordinates,
    );

    if (!coordinates) {
      return [];
    }

    return [
      {
        ...team,
        coordinates,
      },
    ];
  });
}

function hasValidGeocodeRecord(
  geocode: TeamGeocodeRecord,
): geocode is TeamGeocodeRecord {
  return typeof geocode.number === "number" && hasValidCoordinates(geocode);
}

function getValidCoordinates(
  coordinates: TeamCoordinates | undefined,
): TeamCoordinates | null {
  if (!hasValidCoordinates(coordinates)) {
    return null;
  }

  return {
    lat: coordinates.lat,
    lng: coordinates.lng,
    source: coordinates.source,
    query: coordinates.query,
  };
}

function hasValidCoordinates(
  coordinates: TeamCoordinates | undefined,
): coordinates is TeamCoordinates {
  return (
    typeof coordinates?.lat === "number" &&
    Number.isFinite(coordinates.lat) &&
    typeof coordinates.lng === "number" &&
    Number.isFinite(coordinates.lng)
  );
}
