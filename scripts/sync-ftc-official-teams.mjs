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

// FTC Events API integer codes: 0=None, 1=Kickoff, 2=Scrimmage, 3=Qualifier,
// 4=LeagueMeet, 5=LeagueTournament, 6=RegionalChampionship, 7=Championship,
// 8=FIRSTChampionship, 9=Offseason, 99=Other.
const EXCLUDED_EVENT_TYPES = new Set([1, "Kickoff"]);

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

  // Always log the first event's keys so we can confirm the correct field name.
  const firstEvent = competitiveEvents[0];
  if (firstEvent) {
    console.log(`First event keys: ${Object.keys(firstEvent).join(", ")}`);
    console.log(`First event sample: ${JSON.stringify(firstEvent)}`);
  }

  await mapWithConcurrency(competitiveEvents, 15, async (event) => {
    const code = event.code ?? event.eventCode;

    if (!code) {
      return;
    }

    try {
      const teams = await fetchEventTeams(code);

      teams.forEach((team) => {
        if (typeof team.teamNumber === "number") {
          teamNumbers.add(team.teamNumber);
        }
      });
    } catch (error) {
      eventErrors += 1;

      if (eventErrors <= 5) {
        console.warn(`Event ${code}: ${error.message}`);
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

function isCompetitiveEvent(event) {
  return (
    !EXCLUDED_EVENT_TYPES.has(event.type) &&
    !EXCLUDED_EVENT_TYPES.has(event.typeName)
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
  const url = `${API_BASE_URL}/${season}/events/${encodeURIComponent(eventCode)}/teams?excludeNonCompeting=true`;
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
    throw new Error(describeFtcApiError(response.status, url));
  }

  const data = await response.json();

  return Array.isArray(data.teams) ? data.teams : [];
}

async function fetchTeamPage(page) {
  const url = `${API_BASE_URL}/${season}/teams?page=${page}`;
  const response = await fetch(url, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(describeFtcApiError(response.status, url));
  }

  return response.json();
}

async function fetchEventPage(page) {
  const url = `${API_BASE_URL}/${season}/events?page=${page}`;
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
      return (
        `${base} Invalid Event — the season is valid but no event matches that event code: ${url}. ` +
        "Event codes can change year to year."
      );
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
