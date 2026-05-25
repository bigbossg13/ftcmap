import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const OFFICIAL_TEAMS_PATH = resolve("public/ftc-official-teams.json");
const FTCSCOUT_TEAMS_PATH = resolve("public/ftcscout-teams.json");
const GEOCODES_PATH = resolve("public/team-geocodes.json");
const OUTPUT_PATH = resolve("public/map-teams.json");

const season = Number(process.env.FTC_EVENTS_SEASON ?? getCurrentFtcSeason());
const sourceTeams = await readTeamSource();
if (!existsSync(GEOCODES_PATH)) {
  throw new Error("No geocode cache found. Run npm run sync:geocodes first.");
}
const geocodeCache = await readJson(GEOCODES_PATH);
const geocodeByTeam = new Map(
  (Array.isArray(geocodeCache?.teams) ? geocodeCache.teams : [])
    .filter(hasValidCoordinates)
    .map((geocode) => [geocode.number, geocode]),
);
const mapTeams = sourceTeams
  .map((team) => {
    const geocode = geocodeByTeam.get(team.number);

    if (!geocode) {
      return null;
    }

    return compactObject({
      ...team,
      coordinates: {
        lat: geocode.lat,
        lng: geocode.lng,
        source: geocode.source,
        query: geocode.query,
      },
    });
  })
  .filter(Boolean)
  .sort((a, b) => a.number - b.number);
const cache = {
  generatedAt: new Date().toISOString(),
  season,
  teamCount: mapTeams.length,
  teams: mapTeams,
};

await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(
  `Wrote ${mapTeams.length.toLocaleString()} map-ready teams to ${OUTPUT_PATH}`,
);

async function readTeamSource() {
  const hasOfficial = existsSync(OFFICIAL_TEAMS_PATH);
  const hasScout = existsSync(FTCSCOUT_TEAMS_PATH);

  if (hasOfficial && hasScout) {
    const [officialCache, scoutCache] = await Promise.all([
      readJson(OFFICIAL_TEAMS_PATH),
      readJson(FTCSCOUT_TEAMS_PATH),
    ]);

    return mergeTeamSources(
      Array.isArray(officialCache?.teams) ? officialCache.teams : [],
      Array.isArray(scoutCache?.teams) ? scoutCache.teams : [],
    );
  }

  if (hasOfficial) {
    const cache = await readJson(OFFICIAL_TEAMS_PATH);
    const teams = Array.isArray(cache?.teams) ? cache.teams : [];

    return teams.map(normalizeOfficialTeam).filter(Boolean);
  }

  if (hasScout) {
    const cache = await readJson(FTCSCOUT_TEAMS_PATH);
    const teams = Array.isArray(cache?.teams) ? cache.teams : [];

    return teams.map(normalizeScoutTeam).filter(Boolean);
  }

  throw new Error(
    "No team cache found. Run npm run sync:ftcscout or npm run sync:ftc first.",
  );
}

// Use the official FTC Events API as the authoritative team list — it contains
// every team registered for the season, including those in countries whose
// national events aren't tracked by FTCScout. FTCScout data is supplemental:
// it adds updatedAt and activeSeasons where available.
function mergeTeamSources(officialTeams, scoutTeams) {
  const scoutByNumber = new Map(
    scoutTeams
      .map(normalizeScoutTeam)
      .filter(Boolean)
      .map((team) => [team.number, team]),
  );

  return officialTeams
    .map((team) => {
      const official = normalizeOfficialTeam(team);

      if (!official) {
        return null;
      }

      const scout = scoutByNumber.get(official.number);

      return compactObject({
        ...official,
        updatedAt: scout?.updatedAt,
        activeSeasons: scout?.activeSeasons,
      });
    })
    .filter(Boolean);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeOfficialTeam(team) {
  if (!team || typeof team.number !== "number") {
    return null;
  }

  if (isUngeocodeableLocation(team.city)) {
    return null;
  }

  return compactObject({
    number: team.number,
    name: team.name || `Team ${team.number}`,
    schoolName: normalizeString(team.schoolName),
    rookieYear: team.rookieYear,
    website: team.website,
    robotName: normalizeString(team.robotName),
    homeRegion: normalizeString(team.homeRegion),
    displayLocation: normalizeString(team.displayLocation),
    logoUrl: normalizeString(team.logoUrl),
    location: {
      city: normalizeString(team.city) ?? "",
      state: normalizeString(team.state) ?? "",
      country: normalizeString(team.country) ?? "",
    },
  });
}

function isUngeocodeableLocation(city) {
  const c = (city ?? "").trim().toUpperCase();
  return c === "APO" || c === "FPO" || c === "DPO";
}

function normalizeScoutTeam(team) {
  if (!team || typeof team.number !== "number" || !team.location) {
    return null;
  }

  if (isUngeocodeableLocation(team.location.city)) {
    return null;
  }

  return compactObject({
    number: team.number,
    name: team.name || `Team ${team.number}`,
    schoolName: normalizeString(team.schoolName),
    rookieYear: team.rookieYear,
    website: team.website,
    updatedAt: normalizeString(team.updatedAt),
    activeSeasons: Array.isArray(team.activeSeasons) ? team.activeSeasons : undefined,
    location: {
      city: normalizeString(team.location.city) ?? "",
      state: normalizeString(team.location.state) ?? "",
      country: normalizeString(team.location.country) ?? "",
    },
  });
}

function hasValidCoordinates(geocode) {
  return (
    typeof geocode?.number === "number" &&
    typeof geocode.lat === "number" &&
    Number.isFinite(geocode.lat) &&
    typeof geocode.lng === "number" &&
    Number.isFinite(geocode.lng)
  );
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
