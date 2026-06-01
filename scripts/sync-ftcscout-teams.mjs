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

// Fetch REST teams and all-region GraphQL team details in parallel.
// REST has updatedAt; GraphQL teamsSearch has activeSeasons and catches
// teams missing from the REST index. Both return location data.
const [restTeams, graphqlTeams] = await Promise.all([
  fetchRestTeams(),
  fetchAllRegionTeams(),
]);

// Merge: REST takes priority (richer data), GraphQL fills any gaps.
const teamsByNumber = new Map(restTeams.map((t) => [t.number, t]));
for (const team of graphqlTeams) {
  if (!teamsByNumber.has(team.number)) {
    teamsByNumber.set(team.number, team);
  }
}

// Keep teams that FTCScout marks as active in this season.
const cacheTeams = [...teamsByNumber.values()]
  .filter(
    (team) =>
      Array.isArray(team.activeSeasons) && team.activeSeasons.includes(season),
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
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`FTCScout REST returned ${response.status}`);
  }

  return normalizeRestTeams(await response.json());
}

async function fetchAllRegionTeams() {
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

  const results = await mapWithConcurrency(GRAPHQL_REGIONS, 25, (region) =>
    fetchGraphQl(teamQuery, { region, limit: 30000 }).then(
      (payload) => payload.teamsSearch ?? [],
    ),
  );

  return results.flat().map(normalizeGraphQlTeam).filter(Boolean);
}

async function fetchGraphQl(query, variables, attempt = 0) {
  const response = await fetch(FTC_SCOUT_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ query, variables }),
  });

  if ([429, 502, 503].includes(response.status) && attempt < 4) {
    const delay = 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delay));
    return fetchGraphQl(query, variables, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`FTCScout GraphQL returned ${response.status}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  return payload.data;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

function normalizeRestTeams(teams) {
  return teams
    .map((team) => {
      const city = normalizeString(team.city);
      const state = normalizeString(team.state);
      const country = normalizeString(team.country);

      if (typeof team.number !== "number" || !team.name) {
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
        location:
          city || state || country
            ? { city: city ?? "", state: state ?? "", country: country ?? "" }
            : undefined,
      });
    })
    .filter(Boolean);
}

function normalizeGraphQlTeam(team) {
  if (typeof team.number !== "number" || !team.name) {
    return null;
  }

  const loc = team.location ?? {};

  return compactObject({
    number: team.number,
    name: team.name,
    schoolName: normalizeString(team.schoolName),
    rookieYear: typeof team.rookieYear === "number" ? team.rookieYear : undefined,
    website: typeof team.website === "string" ? team.website : undefined,
    activeSeasons: Array.isArray(team.activeSeasons) ? team.activeSeasons : undefined,
    location: {
      city: normalizeString(loc.city) ?? "",
      state: normalizeString(loc.state) ?? "",
      country: normalizeString(loc.country) ?? "",
    },
  });
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ""),
  );
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : undefined;
}

function getCurrentFtcSeason(now = new Date()) {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}
