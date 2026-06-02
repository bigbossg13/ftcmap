import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_BASE_URL = "https://ftc-api.firstinspires.org/v2.0";
const OUTPUT_PATH = resolve("public/ftc-official-teams.json");
const COMPETED_PATH = resolve("public/ftc-events-competed-numbers.json");

const season = Number(process.env.FTC_EVENTS_SEASON ?? getCurrentFtcSeason());
const username = process.env.FTC_EVENTS_USERNAME;
const token = process.env.FTC_EVENTS_TOKEN;

if (!username || !token) {
  console.error(
    "Missing FTC_EVENTS_USERNAME or FTC_EVENTS_TOKEN. Register for FTC Events API credentials and export both variables.",
  );
  process.exit(1);
}

const authorization = `Basic ${Buffer.from(`${username}:${token}`).toString(
  "base64",
)}`;

// Fetch registered teams and event participation in parallel.
const [teams, competedNumbers] = await Promise.all([
  fetchAllTeams(),
  fetchEventParticipationNumbers(),
]);

const cache = {
  generatedAt: new Date().toISOString(),
  season,
  filter: `registered-${season}-teams`,
  teamCount: teams.length,
  teams,
};

const competedCache = {
  generatedAt: new Date().toISOString(),
  season,
  count: competedNumbers.size,
  numbers: [...competedNumbers].sort((a, b) => a - b),
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache, null, 2)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);
await writeFile(`${COMPETED_PATH}.tmp`, `${JSON.stringify(competedCache)}\n`);
await rename(`${COMPETED_PATH}.tmp`, COMPETED_PATH);

console.log(
  `Wrote ${teams.length.toLocaleString()} registered FTC teams for ${season} to ${OUTPUT_PATH}`,
);
console.log(
  `Wrote ${competedNumbers.size.toLocaleString()} FTC Events event-roster team numbers to ${COMPETED_PATH}`,
);

async function fetchAllTeams() {
  const teamsByNumber = new Map();
  let page = 1;
  let pageTotal = 1;

  do {
    const payload = await fetchAuthorized(`${API_BASE_URL}/${season}/teams?page=${page}`);
    const pageTeams = Array.isArray(payload.teams) ? payload.teams : [];

    pageTeams.forEach((team) => {
      const normalizedTeam = normalizeTeam(team);

      if (normalizedTeam) {
        teamsByNumber.set(normalizedTeam.number, normalizedTeam);
      }
    });

    pageTotal = Number(payload.pageTotal || pageTotal);
    page += 1;
  } while (page <= pageTotal);

  return [...teamsByNumber.values()].sort((a, b) => a.number - b.number);
}

// Fetches all FTC Events event rosters for the season and returns the set of
// team numbers that appear in at least one official event. This is a more
// authoritative "competed" signal than activeSeasons alone, and covers regions
// (like Vietnam) that FTCScout's eventsSearch may miss.
async function fetchEventParticipationNumbers() {
  let events;
  try {
    events = await fetchAllEvents();
  } catch (err) {
    console.warn(`Warning: could not fetch events list — ${err.message}`);
    return new Set();
  }

  console.log(`Found ${events.length} events — fetching team rosters...`);

  const teamNumbers = new Set();
  const BATCH = 20;

  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((event) => fetchTeamsForEvent(event.code)),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        for (const n of result.value) teamNumbers.add(n);
      } else {
        console.warn(
          `Warning: teams for event ${batch[j].code} failed — ${result.reason.message}`,
        );
      }
    }
  }

  return teamNumbers;
}

async function fetchAllEvents() {
  const events = [];
  let page = 1;
  let pageTotal = 1;

  do {
    const payload = await fetchAuthorized(`${API_BASE_URL}/${season}/events?page=${page}`);
    events.push(...(Array.isArray(payload.events) ? payload.events : []));
    pageTotal = Number(payload.pageTotal || 1);
    page++;
  } while (page <= pageTotal);

  // Only events with a code (required to fetch rosters).
  return events.filter((e) => e.code);
}

async function fetchTeamsForEvent(eventCode) {
  const numbers = [];
  let page = 1;
  let pageTotal = 1;

  do {
    const payload = await fetchAuthorized(
      `${API_BASE_URL}/${season}/teams?eventCode=${encodeURIComponent(eventCode)}&page=${page}`,
    );
    const teams = Array.isArray(payload.teams) ? payload.teams : [];
    numbers.push(...teams.map((t) => t.teamNumber).filter((n) => typeof n === "number"));
    pageTotal = Number(payload.pageTotal || 1);
    page++;
  } while (page <= pageTotal);

  return numbers;
}

async function fetchAuthorized(url) {
  const response = await fetch(url, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(describeFtcApiError(response.status, url));
  }

  return response.json();
}

function describeFtcApiError(status, url) {
  const base = `FTC Events API ${status}`;
  switch (status) {
    case 400:
      return (
        `${base} — Invalid season, malformed parameter, missing parameter, or invalid API version. ` +
        `Check the season year and all parameters in: ${url}`
      );
    case 401:
      return (
        `${base} Unauthorized — credentials missing or invalid. ` +
        "Verify FTC_EVENTS_USERNAME and FTC_EVENTS_TOKEN at ftc-api.firstinspires.org."
      );
    case 404:
      return `${base} Not Found — season or resource does not exist: ${url}`;
    case 500:
      return `${base} Internal Server Error — unexpected server condition; try again later.`;
    case 501:
      return (
        `${base} — Request did not match any API pattern. ` +
        `The URL or parameter combination is not supported: ${url}`
      );
    case 503:
      return (
        `${base} Service Unavailable — server is overloaded or under maintenance; ` +
        "try again later (check Retry-After header if present)."
      );
    default:
      return `${base} error for ${url}`;
  }
}

function normalizeTeam(team) {
  if (!team || typeof team.teamNumber !== "number") {
    return null;
  }

  return compactObject({
    number: team.teamNumber,
    name: normalizeString(team.nameShort) || normalizeString(team.nameFull),
    schoolName: normalizeString(team.schoolName),
    city: normalizeString(team.city),
    state: normalizeString(team.stateProv),
    country: normalizeString(team.country),
    website: normalizeString(team.website),
    rookieYear: typeof team.rookieYear === "number" ? team.rookieYear : undefined,
    robotName: normalizeString(team.robotName),
    homeRegion: normalizeString(team.homeRegion),
    displayLocation: normalizeString(team.displayLocation),
    logoUrl:
      normalizeString(team.logoUrl) ||
      normalizeString(team.logo) ||
      normalizeString(team.avatarUrl) ||
      normalizeString(team.avatar),
  });
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
