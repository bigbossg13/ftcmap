import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";
const FTC_SCOUT_GRAPHQL_URL = "https://api.ftcscout.org/graphql";
const OUTPUT_PATH = resolve("public/ftcscout-teams.json");
const USER_AGENT =
  process.env.FTCSCOUT_USER_AGENT ??
  "ftcmap/1.0 cache generator (https://github.com/bigbossg13/ftcmap)";
const GRAPHQL_REGIONS = [
  "International",
  "CAAB",
  "CABC",
  "CAON",
  "CAQC",
  "USAK",
  "USAL",
  "USAR",
  "USARL",
  "USAZ",
  "USCA",
  "USCALA",
  "USCALS",
  "USCANO",
  "USCASD",
  "USCHS",
  "USCO",
  "USCT",
  "USDE",
  "USFL",
  "USGA",
  "USHI",
  "USIA",
  "USID",
  "USIL",
  "USIN",
  "USKY",
  "USLA",
  "USMA",
  "USMD",
  "USMI",
  "USMN",
  "USMOKS",
  "USMS",
  "USMT",
  "USNC",
  "USND",
  "USNE",
  "USNH",
  "USNJ",
  "USNM",
  "USNV",
  "USNY",
  "USNYEX",
  "USNYLI",
  "USNYNY",
  "USOH",
  "USOK",
  "USOR",
  "USPA",
  "USRI",
  "USSC",
  "USTN",
  "USTX",
  "USTXCE",
  "USTXHO",
  "USTXNO",
  "USTXSO",
  "USTXWP",
  "USUT",
  "USVA",
  "USVT",
  "USWA",
  "USWI",
  "USWV",
  "USWY",
];

const season = Number(process.env.FTC_EVENTS_SEASON ?? getCurrentFtcSeason());
const playedTeamNumbers = await fetchPlayedTeamNumbers(season);
const teamsByNumber = new Map(
  (await fetchRestTeams()).map((team) => [team.number, team]),
);

await fillMissingTeamDetails(playedTeamNumbers, teamsByNumber);

// Include teams that played in a tracked event OR that FTCScout itself
// marks as active in this season via activeSeasons. The latter catches
// teams whose national/league events aren't in FTCScout's event index
// (e.g. Lithuania, Ukraine) but that FTCScout still records season info for.
const cacheTeams = [...teamsByNumber.values()]
  .filter(
    (team) =>
      playedTeamNumbers.has(team.number) ||
      (Array.isArray(team.activeSeasons) && team.activeSeasons.includes(season)),
  )
  .sort((a, b) => a.number - b.number);
const cache = {
  generatedAt: new Date().toISOString(),
  season,
  teamCount: cacheTeams.length,
  filter: `active-${season}-teams`,
  teams: cacheTeams,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(
  `Wrote ${cacheTeams.length.toLocaleString()} FTCScout active-${season} teams to ${OUTPUT_PATH}`,
);

async function fetchRestTeams() {
  const response = await fetch(FTC_SCOUT_REST_TEAMS_URL, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`FTCScout REST returned ${response.status}`);
  }

  return normalizeTeams(await response.json());
}

async function fetchPlayedTeamNumbers(season) {
  const eventQuery = `
    query PlayedTeams($region: RegionOption!, $season: Int!, $limit: Int) {
      eventsSearch(season: $season, region: $region, limit: $limit) {
        teams {
          teamNumber
        }
      }
    }
  `;
  const playedTeamNumbers = new Set();
  const results = await mapWithConcurrency(GRAPHQL_REGIONS, 10, async (region) => {
    const payload = await fetchGraphQl(eventQuery, {
      region,
      season,
      limit: 10000,
    });

    return payload.eventsSearch ?? [];
  });

  results.flat().forEach((event) => {
    (event.teams ?? []).forEach((team) => {
      if (typeof team.teamNumber === "number") {
        playedTeamNumbers.add(team.teamNumber);
      }
    });
  });

  return playedTeamNumbers;
}

async function fillMissingTeamDetails(playedTeamNumbers, teamsByNumber) {
  const missingBeforeFetch = () =>
    [...playedTeamNumbers].filter((teamNumber) => !teamsByNumber.has(teamNumber));

  if (missingBeforeFetch().length === 0) {
    return;
  }

  const teamQuery = `
    query RegionTeams($region: RegionOption!, $limit: Int) {
      teamsSearch(region: $region, limit: $limit) {
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

  await mapWithConcurrency(GRAPHQL_REGIONS, 8, async (region) => {
    if (missingBeforeFetch().length === 0) {
      return;
    }

    const payload = await fetchGraphQl(teamQuery, {
      region,
      limit: 30000,
    });

    (payload.teamsSearch ?? []).forEach((team) => {
      if (playedTeamNumbers.has(team.number) && !teamsByNumber.has(team.number)) {
        teamsByNumber.set(team.number, normalizeGraphQlTeam(team));
      }
    });
  });
}

async function fetchGraphQl(query, variables) {
  const response = await fetch(FTC_SCOUT_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`FTCScout GraphQL returned ${response.status}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

function normalizeTeams(teams) {
  return teams
    .map((team) => {
      const location = normalizeLocation(team);

      if (typeof team.number !== "number" || !team.name || !location) {
        return null;
      }

      return compactObject({
        number: team.number,
        name: team.name,
        schoolName: normalizeString(team.schoolName),
        rookieYear: typeof team.rookieYear === "number" ? team.rookieYear : undefined,
        website: typeof team.website === "string" ? team.website : undefined,
        activeSeasons: Array.isArray(team.activeSeasons) ? team.activeSeasons : undefined,
        updatedAt: normalizeString(team.updatedAt),
        location,
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}

function normalizeGraphQlTeam(team) {
  const location = team.location ?? {};

  return compactObject({
    number: team.number,
    name: team.name,
    schoolName: normalizeString(team.schoolName),
    rookieYear: typeof team.rookieYear === "number" ? team.rookieYear : undefined,
    website: typeof team.website === "string" ? team.website : undefined,
    activeSeasons: Array.isArray(team.activeSeasons) ? team.activeSeasons : undefined,
    location: {
      city: normalizeString(location.city) ?? "",
      state: normalizeString(location.state) ?? "",
      country: normalizeString(location.country) ?? "",
    },
  });
}

function normalizeLocation(team) {
  const city = normalizeString(team.city);
  const state = normalizeString(team.state);
  const country = normalizeString(team.country);

  if (!city && !state && !country) {
    return null;
  }

  return {
    city: city ?? "",
    state: state ?? "",
    country: country ?? "",
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  );
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : undefined;
}

function getCurrentFtcSeason(now = new Date()) {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}
