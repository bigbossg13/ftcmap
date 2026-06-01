import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";
const OUTPUT_PATH = resolve("public/ftcscout-teams.json");
const KNOWN_NUMBERS_PATH = resolve("public/ftcscout-known-numbers.json");
const USER_AGENT =
  process.env.FTCSCOUT_USER_AGENT ??
  "ftcmap/1.0 cache generator (https://github.com/bigbossg13/ftcmap)";

const season = Number(process.env.FTC_EVENTS_SEASON ?? getCurrentFtcSeason());

const allTeams = await fetchRestTeams();

const cacheTeams = allTeams
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

const knownNumbers = allTeams.map((t) => t.number).sort((a, b) => a - b);
const knownCache = {
  generatedAt: new Date().toISOString(),
  count: knownNumbers.length,
  numbers: knownNumbers,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);
await writeFile(`${KNOWN_NUMBERS_PATH}.tmp`, `${JSON.stringify(knownCache)}\n`);
await rename(`${KNOWN_NUMBERS_PATH}.tmp`, KNOWN_NUMBERS_PATH);

console.log(
  `Wrote ${cacheTeams.length.toLocaleString()} FTCScout active-${season} teams to ${OUTPUT_PATH}`,
);
console.log(
  `Wrote ${knownNumbers.length.toLocaleString()} known FTCScout team numbers to ${KNOWN_NUMBERS_PATH}`,
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
