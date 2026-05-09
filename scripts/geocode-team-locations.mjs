import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const FTC_SCOUT_REST_TEAMS_URL =
  "https://api.ftcscout.org/rest/v1/teams/search?limit=30000";
const OFFICIAL_TEAMS_PATH = resolve("public/ftc-official-teams.json");
const FTCSCOUT_TEAMS_PATH = resolve("public/ftcscout-teams.json");
const OUTPUT_PATH = resolve("public/team-geocodes.json");
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const REQUEST_DELAY_MS = Number(process.env.GEOCODE_DELAY_MS ?? 1100);
const USER_AGENT =
  process.env.GEOCODE_USER_AGENT ??
  "ftcmap/1.0 geocoder (https://github.com/bigbossg13/ftcmap)";
const CONTACT_EMAIL = process.env.GEOCODE_EMAIL;
const FLUSH_EVERY_SUCCESSFUL_GEOCODES = Number(
  process.env.GEOCODE_FLUSH_EVERY ?? 25,
);

const existingCache = await readExistingCache();
const existingByLocation = new Map(
  existingCache.teams
    .filter((team) => team.query)
    .map((team) => [normalizeLocationKey(team.query), team]),
);
const teams = await readTeamSource();
const geocodes = [];
let lastRequestAt = 0;
let successfulGeocodesSinceFlush = 0;

for (const team of teams) {
  const query = formatLocationQuery(team);

  if (!query) {
    continue;
  }

  const cached = existingByLocation.get(normalizeLocationKey(query));

  if (cached) {
    geocodes.push({
      number: team.number,
      lat: cached.lat,
      lng: cached.lng,
      query,
      source: cached.source ?? "cache",
    });
    continue;
  }

  const result = await geocode(query);

  if (!result) {
    continue;
  }

  const geocodeRecord = {
    number: team.number,
    lat: result.lat,
    lng: result.lng,
    query,
    source: "nominatim",
  };

  geocodes.push(geocodeRecord);
  existingByLocation.set(normalizeLocationKey(query), geocodeRecord);
  successfulGeocodesSinceFlush += 1;

  if (successfulGeocodesSinceFlush >= FLUSH_EVERY_SUCCESSFUL_GEOCODES) {
    await writeCache();
    successfulGeocodesSinceFlush = 0;
  }
}

await writeCache();

console.log(
  `Wrote ${geocodes.length.toLocaleString()} geocoded team locations to ${OUTPUT_PATH}`,
);

async function writeCache() {
  const cache = {
    generatedAt: new Date().toISOString(),
    teamCount: geocodes.length,
    teams: [...geocodes].sort((a, b) => a.number - b.number),
  };

  await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache)}\n`);
  await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);
}

async function readTeamSource() {
  if (existsSync(OFFICIAL_TEAMS_PATH)) {
    const cache = JSON.parse(await readFile(OFFICIAL_TEAMS_PATH, "utf8"));
    const teams = Array.isArray(cache.teams) ? cache.teams : [];

    return teams.map((team) => ({
      number: team.number,
      city: team.city,
      state: team.state,
      country: team.country,
    }));
  }

  if (existsSync(FTCSCOUT_TEAMS_PATH)) {
    const cache = JSON.parse(await readFile(FTCSCOUT_TEAMS_PATH, "utf8"));
    const teams = Array.isArray(cache.teams) ? cache.teams : [];

    return teams.map((team) => ({
      number: team.number,
      city: team.location?.city,
      state: team.location?.state,
      country: team.location?.country,
    }));
  }

  const response = await fetch(FTC_SCOUT_REST_TEAMS_URL, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`FTCScout REST returned ${response.status}`);
  }

  const teams = await response.json();

  return teams.map((team) => ({
    number: team.number,
    city: team.city,
    state: team.state,
    country: team.country,
  }));
}

async function readExistingCache() {
  if (!existsSync(OUTPUT_PATH)) {
    return { teams: [] };
  }

  try {
    const cache = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));

    return {
      teams: Array.isArray(cache.teams) ? cache.teams : [],
    };
  } catch {
    return { teams: [] };
  }
}

async function geocode(query) {
  await throttle();

  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
  });

  if (CONTACT_EMAIL) {
    params.set("email", CONTACT_EMAIL);
  }

  const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    console.warn(`Geocode failed for "${query}": HTTP ${response.status}`);
    return null;
  }

  const results = await response.json();
  const firstResult = Array.isArray(results) ? results[0] : null;
  const lat = Number(firstResult?.lat);
  const lng = Number(firstResult?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.warn(`No geocode result for "${query}"`);
    return null;
  }

  console.log(`Geocoded ${query} -> ${lat}, ${lng}`);

  return { lat, lng };
}

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  const waitMs = Math.max(0, REQUEST_DELAY_MS - elapsed);

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastRequestAt = Date.now();
}

function formatLocationQuery(team) {
  const city = normalizeLocationPart(team.city);
  const state = normalizeLocationPart(team.state);
  const country = normalizeLocationPart(team.country);

  return [city, state, country].filter(Boolean).join(", ");
}

function normalizeLocationPart(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLocationKey(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
