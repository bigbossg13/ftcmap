import {
  fetchOfficialFtcTeamCache,
  getOfficialFtcMetadata,
  mergeOfficialFtcTeams,
  type OfficialFtcMetadata,
} from "./officialFtc";
import {
  fetchTeamGeocodeCache,
  mergeTeamGeocodes,
  type TeamCoordinates,
} from "./teamGeocodes";

export type TeamLocation = {
  city: string;
  state: string;
  country: string;
};

export type FtcTeam = {
  number: number;
  name: string;
  schoolName?: string;
  rookieYear?: number;
  website?: string | null;
  activeSeasons?: number[];
  updatedAt?: string;
  robotName?: string;
  homeRegion?: string;
  displayLocation?: string;
  logoUrl?: string;
  coordinates?: TeamCoordinates;
  location: TeamLocation;
};

export type TeamFetchResult = {
  teams: FtcTeam[];
  season: number;
  source: "graphql" | "rest-fallback" | "official-ftc-cache";
  officialData?: OfficialFtcMetadata;
};

const FTC_SCOUT_GRAPHQL_URL = "https://api.ftcscout.org/graphql";
const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";
const GRAPHQL_TIMEOUT_MS = 20000;
const REST_TIMEOUT_MS = 60000;
const REST_RETRY_DELAY_MS = 1500;

const TEAMS_QUERY = `
  query MapTeams($limit: Int) {
    teamsSearch(limit: $limit) {
      number
      name
      schoolName
      rookieYear
      website
      activeSeasons
      location {
        city
        state
        country
      }
    }
  }
`;

type GraphQlTeam = Omit<FtcTeam, "location"> & {
  location?: Partial<TeamLocation> | null;
};

type RestTeam = Omit<FtcTeam, "location"> &
  Partial<TeamLocation> & {
    location?: Partial<TeamLocation> | null;
  };

type GraphQlResponse = {
  data?: {
    teamsSearch?: GraphQlTeam[];
  };
  errors?: { message: string }[];
};

export function getCurrentFtcSeason(now = new Date()) {
  const month = now.getMonth();

  return month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

export function getFtcScoutProfileUrl(teamNumber: number) {
  return `https://ftcscout.org/teams/${teamNumber}`;
}

export async function fetchActiveTeams(): Promise<TeamFetchResult> {
  const season = getCurrentFtcSeason();
  const officialCachePromise = fetchOfficialFtcTeamCache(season).catch((error) => {
    console.warn("Official FTC team cache could not be loaded.", error);
    return null;
  });
  const geocodeCachePromise = fetchTeamGeocodeCache().catch((error) => {
    console.warn("Team geocode cache could not be loaded.", error);
    return null;
  });
  let scoutTeams: FtcTeam[] = [];
  let scoutSource: TeamFetchResult["source"] = "rest-fallback";
  let scoutError: unknown = null;

  try {
    const graphQlTeams = await fetchTeamsFromGraphQl();
    const activeTeams = graphQlTeams.filter((team) =>
      team.activeSeasons?.includes(season),
    );

    if (activeTeams.length > 0) {
      scoutTeams = activeTeams;
      scoutSource = "graphql";
    }
  } catch (error) {
    console.warn("FTCScout GraphQL team fetch failed; using REST fallback.", error);
    scoutError = error;
  }

  if (scoutTeams.length === 0) {
    try {
      scoutTeams = await fetchTeamsFromRest(season);
      scoutSource = "rest-fallback";
    } catch (error) {
      scoutError = error;
    }
  }

  const officialCache = await officialCachePromise;
  const geocodeCache = await geocodeCachePromise;

  if (officialCache?.teams.length) {
    return {
      teams: mergeTeamGeocodes(
        mergeOfficialFtcTeams(officialCache.teams, scoutTeams),
        geocodeCache,
      ),
      season,
      source: "official-ftc-cache",
      officialData: getOfficialFtcMetadata(officialCache),
    };
  }

  if (scoutTeams.length > 0) {
    return {
      teams: mergeTeamGeocodes(scoutTeams, geocodeCache),
      season,
      source: scoutSource,
    };
  }

  throw scoutError instanceof Error
    ? scoutError
    : new Error("Unable to load FTC team data.");
}

async function fetchTeamsFromGraphQl() {
  const response = await fetchWithTimeout(
    FTC_SCOUT_GRAPHQL_URL,
    GRAPHQL_TIMEOUT_MS,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: TEAMS_QUERY,
        variables: { limit: 30000 },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`FTCScout GraphQL returned ${response.status}`);
  }

  const payload = (await response.json()) as GraphQlResponse;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return normalizeTeams(payload.data?.teamsSearch ?? []);
}

async function fetchTeamsFromRest(season: number) {
  const response = await fetchWithRetry(FTC_SCOUT_REST_TEAMS_URL, REST_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`FTCScout REST returned ${response.status}`);
  }

  const teams = normalizeTeams((await response.json()) as RestTeam[]);
  const likelyActiveTeams = teams.filter((team) =>
    wasUpdatedDuringSeason(team, season),
  );

  return likelyActiveTeams.length > 0 ? likelyActiveTeams : teams;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  timeoutMs: number,
  init?: RequestInit,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      throw new Error(
        `FTCScout took longer than ${Math.round(
          timeoutMs / 1000,
        )} seconds to respond. Please try again.`,
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  timeoutMs: number,
  attempts = 2,
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(input, timeoutMs);
    } catch (error) {
      lastError = error;

      if (attempt < attempts && isRetryableFetchError(error)) {
        await wait(REST_RETRY_DELAY_MS * attempt);
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("FTCScout could not be reached.");
}

function isRetryableFetchError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    error.message.includes("FTCScout took longer")
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function wait(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function normalizeTeams(teams: Array<GraphQlTeam | RestTeam>): FtcTeam[] {
  const normalizedTeams: FtcTeam[] = [];

  teams.forEach((team) => {
    const location = normalizeLocation(team);

    if (typeof team.number !== "number" || !team.name || !location) {
      return;
    }

    const normalizedTeam: FtcTeam = {
      number: team.number,
      name: team.name,
      location,
    };

    if (team.schoolName) {
      normalizedTeam.schoolName = team.schoolName;
    }

    if (typeof team.rookieYear === "number") {
      normalizedTeam.rookieYear = team.rookieYear;
    }

    if (typeof team.website === "string" || team.website === null) {
      normalizedTeam.website = team.website;
    }

    if (Array.isArray(team.activeSeasons)) {
      normalizedTeam.activeSeasons = team.activeSeasons;
    }

    if (typeof team.updatedAt === "string") {
      normalizedTeam.updatedAt = team.updatedAt;
    }

    normalizedTeams.push(normalizedTeam);
  });

  return normalizedTeams;
}

function normalizeLocation(team: GraphQlTeam | RestTeam): TeamLocation | null {
  const location = "location" in team ? team.location : null;
  const restTeam = team as RestTeam;
  const city = normalizeLocationPart(location?.city ?? restTeam.city);
  const state = normalizeLocationPart(location?.state ?? restTeam.state);
  const country = normalizeLocationPart(location?.country ?? restTeam.country);

  if (!city && !state && !country) {
    return null;
  }

  return {
    city,
    state,
    country,
  };
}

function normalizeLocationPart(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wasUpdatedDuringSeason(team: FtcTeam, season: number) {
  if (!team.updatedAt) {
    return false;
  }

  const updatedAt = new Date(team.updatedAt);

  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  return updatedAt.getUTCFullYear() >= season;
}
