import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_BASE_URL = "https://ftc-api.firstinspires.org/v2.0";
const OUTPUT_PATH = resolve("public/ftc-official-teams.json");

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

const [allTeams, playedTeamNumbers] = await Promise.all([
  fetchAllTeams(),
  fetchPlayedTeamNumbers(),
]);

const teams = allTeams.filter((team) => playedTeamNumbers.has(team.number));

const cache = {
  generatedAt: new Date().toISOString(),
  season,
  filter: `played-${season}-teams`,
  teamCount: teams.length,
  teams,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache, null, 2)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(
  `Wrote ${teams.length.toLocaleString()} played FTC teams for ${season} (filtered from ${allTeams.length.toLocaleString()} registered) to ${OUTPUT_PATH}`,
);

async function fetchAllTeams() {
  const teamsByNumber = new Map();
  let page = 1;
  let pageTotal = 1;

  do {
    const payload = await fetchTeamPage(page);
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

async function fetchPlayedTeamNumbers() {
  const allEvents = await fetchAllEvents();
  // Only count teams from events where matches are actually played.
  // Kickoffs, scrimmages, and demo/workshop events don't have competitive
  // matches, so teams registered for those events shouldn't count.
  const competitiveEvents = allEvents.filter(isCompetitiveEvent);
  const teamNumbers = new Set();
  let eventErrors = 0;

  console.log(
    `Fetching team lists for ${competitiveEvents.length.toLocaleString()} competitive events (${allEvents.length.toLocaleString()} total)…`,
  );

  await mapWithConcurrency(competitiveEvents, 15, async (event) => {
    try {
      const teams = await fetchEventTeams(event.eventCode);

      teams.forEach((team) => {
        if (typeof team.teamNumber === "number") {
          teamNumbers.add(team.teamNumber);
        }
      });
    } catch (error) {
      eventErrors += 1;

      if (eventErrors <= 5) {
        console.warn(`Event ${event.eventCode}: ${error.message}`);
      } else if (eventErrors === 6) {
        console.warn("(Further per-event errors suppressed)");
      }
    }
  });

  console.log(
    `Found ${teamNumbers.size.toLocaleString()} unique teams across ${competitiveEvents.length.toLocaleString()} competitive events (${eventErrors} event errors)`,
  );

  return teamNumbers;
}

// Event types that represent actual competitive matches. The FTC Events API
// uses integer codes; 0=None, 1=Kickoff, 2=Scrimmage, 3=Qualifier,
// 4=LeagueMeet, 5=LeagueTournament, 6=RegionalChampionship, 7=Championship,
// 8=FIRSTChampionship, 9=Offseason, 99=Other.
// typeName mirrors the integer as a string label.
const COMPETITIVE_EVENT_TYPES = new Set([
  // Numeric codes
  3, 4, 5, 6, 7, 8, 9,
  // String labels used by some API responses
  "Qualifier",
  "LeagueMeet",
  "LeagueTournament",
  "RegionalChampionship",
  "Championship",
  "FIRSTChampionship",
  "Offseason",
]);

function isCompetitiveEvent(event) {
  // If the API doesn't provide a type, include the event to avoid accidentally
  // excluding legitimate competitions with unknown/future type codes.
  if (event.type == null && !event.typeName) {
    return true;
  }

  return (
    COMPETITIVE_EVENT_TYPES.has(event.type) ||
    COMPETITIVE_EVENT_TYPES.has(event.typeName)
  );
}

async function fetchAllEvents() {
  const events = [];
  let page = 1;
  let pageTotal = 1;

  do {
    const payload = await fetchEventPage(page);
    const pageEvents = Array.isArray(payload.events) ? payload.events : [];

    events.push(...pageEvents);
    pageTotal = Number(payload.pageTotal || pageTotal);
    page += 1;
  } while (page <= pageTotal);

  return events;
}

async function fetchEventTeams(eventCode) {
  const url = `${API_BASE_URL}/${season}/events/${encodeURIComponent(eventCode)}/teams`;
  const response = await fetch(url, {
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  return Array.isArray(data.teams) ? data.teams : [];
}

async function fetchTeamPage(page) {
  const url = `${API_BASE_URL}/${season}/teams?page=${page}`;
  const response = await fetch(url, {
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    throw new Error(
      `FTC Events API credentials rejected (401) for ${url}. ` +
        "Check that FTC_EVENTS_USERNAME and FTC_EVENTS_TOKEN are correct (see ftc-api.firstinspires.org).",
    );
  }

  if (!response.ok) {
    throw new Error(`FTC Events API returned ${response.status} for ${url}`);
  }

  return response.json();
}

async function fetchEventPage(page) {
  const url = `${API_BASE_URL}/${season}/events?page=${page}`;
  const response = await fetch(url, {
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    throw new Error(
      `FTC Events API credentials rejected (401) for ${url}. ` +
        "Check that FTC_EVENTS_USERNAME and FTC_EVENTS_TOKEN are correct (see ftc-api.firstinspires.org).",
    );
  }

  if (!response.ok) {
    throw new Error(`FTC Events API returned ${response.status} for ${url}`);
  }

  return response.json();
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
    teamId: typeof team.teamId === "number" ? team.teamId : undefined,
    teamProfileId:
      typeof team.teamProfileId === "number" ? team.teamProfileId : undefined,
    districtCode: normalizeString(team.districtCode),
    // The documented FTC Events team schema does not currently expose logos,
    // but keep these pass-throughs so a future field or patched cache is used.
    logoUrl:
      normalizeString(team.logoUrl) ||
      normalizeString(team.logo) ||
      normalizeString(team.avatarUrl) ||
      normalizeString(team.avatar),
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
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
