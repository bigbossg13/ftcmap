import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const API_BASE_URL = "https://ftc-api.firstinspires.org/v2.0";
const OFFICIAL_TEAMS_PATH = resolve("public/ftc-official-teams.json");
const AVATARS_DIR = resolve("public/avatars");
const CONCURRENCY = 20;

const season = Number(process.env.FTC_EVENTS_SEASON ?? getCurrentFtcSeason());
const username = process.env.FTC_EVENTS_USERNAME;
const token = process.env.FTC_EVENTS_TOKEN;

if (!username || !token) {
  console.error(
    "Missing FTC_EVENTS_USERNAME or FTC_EVENTS_TOKEN. Register for FTC Events API credentials and export both variables.",
  );
  process.exit(1);
}

if (!existsSync(OFFICIAL_TEAMS_PATH)) {
  console.error(
    `No official teams cache found at ${OFFICIAL_TEAMS_PATH}. Run npm run sync:ftc first.`,
  );
  process.exit(1);
}

const authorization = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
const officialCache = JSON.parse(await readFile(OFFICIAL_TEAMS_PATH, "utf8"));
const teams = Array.isArray(officialCache?.teams) ? officialCache.teams : [];

await mkdir(AVATARS_DIR, { recursive: true });

let fetched = 0;
let skipped = 0;
let missing = 0;
let errors = 0;
let authFailed = false;

await mapWithConcurrency(teams, CONCURRENCY, async (team) => {
  if (authFailed) {
    return;
  }

  const outPath = resolve(AVATARS_DIR, `${team.number}.png`);

  if (existsSync(outPath)) {
    skipped++;
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/${season}/teams/${team.number}/avatar`,
      {
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      },
    );

    if (response.status === 401) {
      authFailed = true;
      throw new Error(
        "FTC Events API credentials rejected (401). Check FTC_EVENTS_USERNAME and FTC_EVENTS_TOKEN.",
      );
    }

    if (response.status === 404) {
      missing++;
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const base64 =
      data.teamAvatarBase64 ?? data.teamAvatar ?? data.avatar ?? data.avatarBase64;

    if (!base64 || typeof base64 !== "string") {
      missing++;
      return;
    }

    await writeFile(outPath, Buffer.from(base64, "base64"));
    fetched++;
  } catch (error) {
    if (authFailed) {
      throw error;
    }

    errors++;

    if (errors <= 10) {
      console.warn(`Team ${team.number}: ${error.message}`);
    } else if (errors === 11) {
      console.warn("(Further per-team errors suppressed)");
    }
  }
});

console.log(
  `Avatars: ${fetched} new, ${skipped} already cached, ${missing} without avatar, ${errors} errors`,
);

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

function getCurrentFtcSeason(now = new Date()) {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}
