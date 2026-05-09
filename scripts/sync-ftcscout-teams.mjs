import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";
const OUTPUT_PATH = resolve("public/ftcscout-teams.json");
const USER_AGENT =
  process.env.FTCSCOUT_USER_AGENT ??
  "ftcmap/1.0 cache generator (https://github.com/bigbossg13/ftcmap)";

const season = Number(process.env.FTC_EVENTS_SEASON ?? getCurrentFtcSeason());
const response = await fetch(FTC_SCOUT_REST_TEAMS_URL, {
  headers: {
    "User-Agent": USER_AGENT,
  },
});

if (!response.ok) {
  throw new Error(`FTCScout REST returned ${response.status}`);
}

const teams = normalizeTeams(await response.json());
const likelyActiveTeams = teams.filter((team) =>
  wasUpdatedDuringSeason(team, season),
);
const cacheTeams = likelyActiveTeams.length > 0 ? likelyActiveTeams : teams;
const cache = {
  generatedAt: new Date().toISOString(),
  season,
  teamCount: cacheTeams.length,
  teams: cacheTeams,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(
  `Wrote ${cacheTeams.length.toLocaleString()} FTCScout teams for ${season} to ${OUTPUT_PATH}`,
);

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
        website: typeof team.website === "string" ? team.website : team.website,
        updatedAt: normalizeString(team.updatedAt),
        location,
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
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

function wasUpdatedDuringSeason(team, season) {
  if (!team.updatedAt) {
    return false;
  }

  const updatedAt = new Date(team.updatedAt);

  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  return updatedAt.getUTCFullYear() >= season;
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
