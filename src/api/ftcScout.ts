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
  location: TeamLocation;
};

export type TeamFetchResult = {
  teams: FtcTeam[];
  season: number;
  source: "graphql" | "rest-fallback";
};

const FTC_SCOUT_GRAPHQL_URL = "https://api.ftcscout.org/graphql";
const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";

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

  try {
    const graphQlTeams = await fetchTeamsFromGraphQl();
    const activeTeams = graphQlTeams.filter((team) =>
      team.activeSeasons?.includes(season),
    );

    if (activeTeams.length > 0) {
      return { teams: activeTeams, season, source: "graphql" };
    }
  } catch (error) {
    console.warn("FTCScout GraphQL team fetch failed; using REST fallback.", error);
  }

  return {
    teams: await fetchTeamsFromRest(),
    season,
    source: "rest-fallback",
  };
}

async function fetchTeamsFromGraphQl() {
  const response = await fetchWithTimeout(FTC_SCOUT_GRAPHQL_URL, 12000, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: TEAMS_QUERY,
      variables: { limit: 30000 },
    }),
  });

  if (!response.ok) {
    throw new Error(`FTCScout GraphQL returned ${response.status}`);
  }

  const payload = (await response.json()) as GraphQlResponse;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return normalizeTeams(payload.data?.teamsSearch ?? []);
}

async function fetchTeamsFromRest() {
  const response = await fetchWithTimeout(FTC_SCOUT_REST_TEAMS_URL, 16000);

  if (!response.ok) {
    throw new Error(`FTCScout REST returned ${response.status}`);
  }

  return normalizeTeams((await response.json()) as RestTeam[]);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  timeoutMs: number,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeTeams(teams: Array<GraphQlTeam | RestTeam>) {
  return teams
    .map((team) => {
      const location = normalizeLocation(team);

      if (!team.number || !team.name || !location) {
        return null;
      }

      return {
        number: team.number,
        name: team.name,
        schoolName: team.schoolName,
        rookieYear: team.rookieYear,
        website: team.website,
        activeSeasons: team.activeSeasons,
        location,
      } satisfies FtcTeam;
    })
    .filter((team): team is FtcTeam => team !== null);
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
