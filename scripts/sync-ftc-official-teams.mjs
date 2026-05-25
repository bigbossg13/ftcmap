import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_BASE_URL = "https://ftc-events.firstinspires.org/v2.0";
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

const teams = await fetchAllTeams();
const cache = {
  generatedAt: new Date().toISOString(),
  season,
  teamCount: teams.length,
  teams,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(cache, null, 2)}\n`);
await rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(
  `Wrote ${teams.length.toLocaleString()} official FTC teams for ${season} to ${OUTPUT_PATH}`,
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
        "Check that FTC_EVENTS_USERNAME and FTC_EVENTS_TOKEN are correct.",
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
