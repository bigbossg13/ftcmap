import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";
const FTC_SCOUT_GRAPHQL_URL = "https://api.ftcscout.org/graphql";
const OUTPUT_PATH = resolve("public/ftcscout-teams.json");
const KNOWN_NUMBERS_PATH = resolve("public/ftcscout-known-numbers.json");
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

// Fetch team data and event participation in parallel.
// REST gives us the full team roster with location/name/etc.
// eventsSearch gives us the set of teams that actually competed —
// activeSeasons alone is too loose (it includes registered-only teams).
const [allTeams, playedTeamNumbers] = await Promise.all([
  fetchRestTeams(),
  fetchPlayedTeamNumbers(season),
]);

// Keep only teams that played in at least one FTCScout-tracked event.
const cacheTeams = allTeams
  .filter((team) => playedTeamNumbers.has(team.number))
  .sort((a, b) => a.number - b.number);

// All teams FTCScout has any record of, with their activeSeasons.
// Used by build-map-teams to distinguish:
//   - "FTCScout knows AND marks active this season" → include (e.g. Vietnamese teams)
//   - "FTCScout knows but NOT active this season" → exclude (e.g. registered-only)
//   - "FTCScout never heard of them" → include (truly untracked region)
const knownTeams = allTeams
  .map((t) => ({ number: t.number, activeSeasons: Array.isArray(t.activeSeasons) ? t.activeSeasons : [] }))
  .sort((a, b) => a.number - b.number);

const cache = {
  generatedAt: new Date().toISOString(),
  season,
  teamCount: cacheTeams.length,
  filter: `played-${season}-event-teams`,
  teams: cacheTeams,
};

const knownCache = {
  generatedAt: new Date().toISOString(),
  count: knownTeams.length,
  teams: knownTeams,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);
await writeFile(`${KNOWN_NUMBERS_PATH}.tmp`, `${JSON.stringify(knownCache)}\n`);
await rename(`${KNOWN_NUMBERS_PATH}.tmp`, KNOWN_NUMBERS_PATH);

console.log(
  `Wrote ${cacheTeams.length.toLocaleString()} FTCScout event-playing teams for ${season} to ${OUTPUT_PATH}`,
);
console.log(
  `Wrote ${knownTeams.length.toLocaleString()} known FTCScout teams to ${KNOWN_NUMBERS_PATH}`,
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

  // Run all 63 region queries fully in parallel — each is independent and
  // lightweight (just team numbers, no heavy per-team data). Retry logic in
  // fetchGraphQl handles any transient 502s without serialising the batch.
  const results = await Promise.all(
    GRAPHQL_REGIONS.map((region) =>
      fetchGraphQl(eventQuery, { region, season, limit: 10000 })
        .then((payload) => payload.eventsSearch ?? [])
        .catch((err) => {
          console.warn(`Warning: eventsSearch for ${region} failed — ${err.message}`);
          return [];
        }),
    ),
  );

  const teamNumbers = new Set();
  for (const events of results.flat()) {
    for (const team of events.teams ?? []) {
      if (typeof team.teamNumber === "number") {
        teamNumbers.add(team.teamNumber);
      }
    }
  }
  return teamNumbers;
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
