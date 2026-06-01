import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const OFFICIAL_TEAMS_PATH = resolve("public/ftc-official-teams.json");
const FTCSCOUT_TEAMS_PATH = resolve("public/ftcscout-teams.json");
const FTCSCOUT_KNOWN_PATH = resolve("public/ftcscout-known-numbers.json");
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

    const officialTeams = Array.isArray(officialCache?.teams) ? officialCache.teams : [];
    const scoutTeams = Array.isArray(scoutCache?.teams) ? scoutCache.teams : [];

    const scoutKnownNumbers = await loadScoutKnownNumbers();

    if (officialTeams.length > 0) {
      return mergeTeamSources(officialTeams, scoutTeams, scoutKnownNumbers);
    }

    // Official file exists but is empty (e.g. API credentials not configured);
    // fall back to FTCScout as the sole source.
    return scoutTeams.map(normalizeScoutTeam).filter(Boolean);
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

// Merge strategy:
// 1. FTCScout is the primary "played this season" list. For each scout team,
//    overlay official data (better location, robot name, logo) where available.
// 2. Official teams NOT in FTCScout active list are included if they have a
//    valid location AND FTCScout doesn't have any record of them — this catches
//    teams in regions FTCScout doesn't index (e.g. Vietnam). If FTCScout has a
//    record of the team but didn't mark them active, they registered but sat out
//    this season and are excluded.
function mergeTeamSources(officialTeams, scoutTeams, scoutKnownNumbers = null) {
  const officialByNumber = new Map(
    officialTeams
      .map(normalizeOfficialTeam)
      .filter(Boolean)
      .map((team) => [team.number, team]),
  );

  const merged = new Map();

  // Pass 1: FTCScout played/active teams, supplemented by official data.
  for (const raw of scoutTeams) {
    const scout = normalizeScoutTeam(raw);

    if (!scout) {
      continue;
    }

    const official = officialByNumber.get(scout.number);

    if (!official) {
      merged.set(scout.number, scout);
      continue;
    }

    const officialHasLocation = Boolean(
      official.location?.city || official.location?.state || official.location?.country,
    );

    merged.set(
      scout.number,
      compactObject({
        ...scout,
        name: official.name || scout.name,
        schoolName: official.schoolName || scout.schoolName,
        rookieYear: official.rookieYear ?? scout.rookieYear,
        website: official.website ?? scout.website,
        location: officialHasLocation ? official.location : scout.location,
        robotName: official.robotName,
        homeRegion: official.homeRegion,
        displayLocation: official.displayLocation,
        logoUrl: official.logoUrl,
      }),
    );
  }

  // Pass 2: official-only teams (not in FTCScout active list) that have a
  // location and are unknown to FTCScout entirely. If FTCScout has a record of
  // the team but didn't include them in this season's active list, they are
  // registered but didn't compete — skip them.
  for (const official of officialByNumber.values()) {
    if (merged.has(official.number)) {
      continue;
    }

    const hasLocation = Boolean(
      official.location?.city || official.location?.state || official.location?.country,
    );

    if (!hasLocation) {
      continue;
    }

    // If we have FTCScout's known-numbers index and the team appears in it,
    // FTCScout has data on them but didn't mark them active — registered only.
    if (scoutKnownNumbers !== null && scoutKnownNumbers.has(official.number)) {
      continue;
    }

    merged.set(official.number, official);
  }

  return [...merged.values()].sort((a, b) => a.number - b.number);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadScoutKnownNumbers() {
  if (!existsSync(FTCSCOUT_KNOWN_PATH)) {
    return null;
  }
  const cache = await readJson(FTCSCOUT_KNOWN_PATH);
  return Array.isArray(cache?.numbers) ? new Set(cache.numbers) : null;
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
