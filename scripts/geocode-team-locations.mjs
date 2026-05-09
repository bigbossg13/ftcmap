import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const cities = require("all-the-cities");

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
const USE_NOMINATIM = process.env.GEOCODE_USE_NOMINATIM === "true";
const FLUSH_EVERY_SUCCESSFUL_GEOCODES = Number(
  process.env.GEOCODE_FLUSH_EVERY ?? 25,
);
const CACHE_STATE_MATCH_MAX_DISTANCE_KM = 50;

if (USE_NOMINATIM && !CONTACT_EMAIL) {
  throw new Error("Set GEOCODE_EMAIL before enabling GEOCODE_USE_NOMINATIM.");
}

const COUNTRY_ALIASES = {
  AUS: "AU",
  AUSTRALIA: "AU",
  BRA: "BR",
  BRAZIL: "BR",
  CAN: "CA",
  CANADA: "CA",
  CHN: "CN",
  CHINA: "CN",
  DEU: "DE",
  GERMANY: "DE",
  IND: "IN",
  INDIA: "IN",
  ISR: "IL",
  ISRAEL: "IL",
  JPN: "JP",
  JAPAN: "JP",
  MEXICO: "MX",
  MEX: "MX",
  NETHERLANDS: "NL",
  NEW_ZEALAND: "NZ",
  SOUTH_KOREA: "KR",
  SPAIN: "ES",
  TURKEY: "TR",
  TURKIYE: "TR",
  UK: "GB",
  UNITED_KINGDOM: "GB",
  UNITED_STATES: "US",
  UNITED_STATES_OF_AMERICA: "US",
  US: "US",
  USA: "US",
};
const REGION_ALIASES = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  DISTRICT_OF_COLUMBIA: "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  NEW_HAMPSHIRE: "NH",
  NEW_JERSEY: "NJ",
  NEW_MEXICO: "NM",
  NEW_YORK: "NY",
  NORTH_CAROLINA: "NC",
  NORTH_DAKOTA: "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  PUERTO_RICO: "PR",
  RHODE_ISLAND: "RI",
  SOUTH_CAROLINA: "SC",
  SOUTH_DAKOTA: "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  WEST_VIRGINIA: "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  ALBERTA: "AB",
  BRITISH_COLUMBIA: "BC",
  MANITOBA: "MB",
  NEW_BRUNSWICK: "NB",
  NEWFOUNDLAND_AND_LABRADOR: "NL",
  NOVA_SCOTIA: "NS",
  NORTHWEST_TERRITORIES: "NT",
  NUNAVUT: "NU",
  ONTARIO: "ON",
  PRINCE_EDWARD_ISLAND: "PE",
  QUEBEC: "QC",
  SASKATCHEWAN: "SK",
  YUKON: "YT",
};
const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryCodeByName = buildCountryCodeByName(cities);
const cityIndex = buildCityIndex(cities);

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
  const location = normalizeLocation(team);
  const query = formatLocationQuery(location);

  if (!query) {
    continue;
  }

  const cached = existingByLocation.get(normalizeLocationKey(query));

  if (cached && isCachedGeocodeUsable(location, cached)) {
    geocodes.push({
      number: team.number,
      lat: cached.lat,
      lng: cached.lng,
      query,
      source: cached.source ?? "cache",
    });
    continue;
  }

  const result =
    geocodeOffline(location) ?? (USE_NOMINATIM ? await geocodeOnline(query) : null);

  if (!result) {
    continue;
  }

  const geocodeRecord = {
    number: team.number,
    lat: result.lat,
    lng: result.lng,
    query,
    source: result.source,
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

  if (!Array.isArray(teams)) {
    throw new Error("FTCScout REST returned an unexpected team payload.");
  }

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

function geocodeOffline(location) {
  const candidates = getCandidateCities(location);

  if (candidates.length === 0) {
    return null;
  }

  const stateMatches = getStateMatches(candidates, location.state);
  const match = (stateMatches.length > 0 ? stateMatches : candidates)[0];

  if (!match) {
    return null;
  }

  const [lng, lat] = match.loc.coordinates;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    source: "all-the-cities",
  };
}

function isCachedGeocodeUsable(location, geocode) {
  if (
    typeof geocode.lat !== "number" ||
    !Number.isFinite(geocode.lat) ||
    typeof geocode.lng !== "number" ||
    !Number.isFinite(geocode.lng)
  ) {
    return false;
  }

  const stateKey = toNormalizedRegionCode(location.state);

  if (!stateKey) {
    return true;
  }

  const candidates = getCandidateCities(location);
  const stateMatches = candidates.filter((city) => isRegionMatch(city, stateKey));

  if (stateMatches.length === 0) {
    return true;
  }

  return stateMatches.some(
    (city) =>
      getDistanceKm(geocode.lat, geocode.lng, city) <=
      CACHE_STATE_MATCH_MAX_DISTANCE_KM,
  );
}

function getCandidateCities(location) {
  const cityKeys = getCityKeyCandidates(location.city);
  const countryCode = toCountryCode(location.country);

  if (cityKeys.length === 0 || !countryCode) {
    return [];
  }

  return cityKeys.flatMap(
    (cityKey) => cityIndex.get(`${countryCode}:${cityKey}`) ?? [],
  );
}

function getStateMatches(candidates, state) {
  const stateKey = toNormalizedRegionCode(state);

  if (!stateKey) {
    return candidates;
  }

  return candidates.filter((city) => isRegionMatch(city, stateKey));
}

function isRegionMatch(city, stateKey) {
  return normalizeLocationKey(city.adminCode).toUpperCase() === stateKey;
}

function getDistanceKm(lat, lng, city) {
  const [cityLng, cityLat] = city.loc.coordinates;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latDelta = toRadians(cityLat - lat);
  const lngDelta = toRadians(cityLng - lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(lat)) *
      Math.cos(toRadians(cityLat)) *
      Math.sin(lngDelta / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

async function geocodeOnline(query) {
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

  return { lat, lng, source: "nominatim" };
}

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  const waitMs = Math.max(0, REQUEST_DELAY_MS - elapsed);

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastRequestAt = Date.now();
}

function normalizeLocation(team) {
  return {
    city: normalizeLocationPart(team.city),
    state: normalizeLocationPart(team.state),
    country: normalizeLocationPart(team.country),
  };
}

function formatLocationQuery(location) {
  const { city, state, country } = location;

  return [city, state, country].filter(Boolean).join(", ");
}

function normalizeLocationPart(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLocationKey(value) {
  return normalizeLocationPart(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCityIndex(cityList) {
  const index = new Map();

  cityList.forEach((city) => {
    if (!city.name || !city.country || !city.loc?.coordinates) {
      return;
    }

    getCityKeyCandidates(city.name).forEach((cityKey) => {
      addCityToIndex(index, `${city.country}:${cityKey}`, city);
    });

    normalizeLocationPart(city.altName)
      .split(",")
      .map(getCityKeyCandidates)
      .flat()
      .forEach((cityKey) => {
        addCityToIndex(index, `${city.country}:${cityKey}`, city);
      });
  });

  index.forEach((matches) => {
    matches.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  });

  return index;
}

function addCityToIndex(index, key, city) {
  const matches = index.get(key) ?? [];

  if (!matches.includes(city)) {
    matches.push(city);
  }

  index.set(key, matches);
}

function toCountryCode(country) {
  const countryKey = normalizeLocationKey(country).toUpperCase().replace(/\s+/g, "_");

  return (
    COUNTRY_ALIASES[countryKey] ??
    countryCodeByName.get(normalizeLocationKey(country)) ??
    (countryKey.length === 2 ? countryKey : undefined)
  );
}

function toRegionCode(state) {
  const stateKey = normalizeLocationKey(state).toUpperCase().replace(/\s+/g, "_");

  return REGION_ALIASES[stateKey] ?? stateKey;
}

function toNormalizedRegionCode(state) {
  const regionCode = toRegionCode(state);

  return regionCode ? normalizeLocationKey(regionCode).toUpperCase() : "";
}

function getCityKeyCandidates(city) {
  const cityKey = normalizeLocationKey(city);

  if (!cityKey) {
    return [];
  }

  const candidates = new Set([cityKey]);

  if (cityKey.startsWith("the ")) {
    candidates.add(cityKey.slice(4));
  } else {
    candidates.add(`the ${cityKey}`);
  }

  [" city", " township", " town", " county", " municipality"].forEach((suffix) => {
    if (cityKey.endsWith(suffix)) {
      candidates.add(cityKey.slice(0, -suffix.length));
    }
  });

  return [...candidates].filter(Boolean);
}

function buildCountryCodeByName(cityList) {
  const countryCodes = new Set(cityList.map((city) => city.country).filter(Boolean));
  const countryMap = new Map();

  countryCodes.forEach((countryCode) => {
    const displayName = countryDisplayNames.of(countryCode);

    if (displayName) {
      countryMap.set(normalizeLocationKey(displayName), countryCode);
    }
  });

  countryMap.set("czech republic", "CZ");
  countryMap.set("russia", "RU");
  countryMap.set("venezuela", "VE");
  countryMap.set("moldova", "MD");
  countryMap.set("united arab emirates", "AE");

  return countryMap;
}

