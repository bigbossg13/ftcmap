import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MAP_TEAMS_PATH = resolve("public/map-teams.json");
const SEASONS_DIR = resolve("public/seasons");
const SEASONS_MANIFEST_PATH = resolve("public/seasons.json");

const archiveSeason = Number(process.env.ARCHIVE_SEASON);

if (!archiveSeason || !Number.isFinite(archiveSeason)) {
  console.error(
    "Missing or invalid ARCHIVE_SEASON env variable. Expected a 4-digit year.",
  );
  process.exit(1);
}

if (!existsSync(MAP_TEAMS_PATH)) {
  console.error(
    `No map-teams.json found at ${MAP_TEAMS_PATH}. Run the full sync pipeline first.`,
  );
  process.exit(1);
}

const seasonDir = resolve(SEASONS_DIR, String(archiveSeason));
const seasonDestPath = resolve(seasonDir, "map-teams.json");

if (existsSync(seasonDestPath)) {
  console.log(
    `Season ${archiveSeason} is already archived at ${seasonDestPath}. Nothing to do.`,
  );
  process.exit(0);
}

const mapCache = JSON.parse(await readFile(MAP_TEAMS_PATH, "utf8"));

if (mapCache.season !== archiveSeason) {
  console.error(
    `map-teams.json is for season ${mapCache.season}, not ${archiveSeason}. ` +
      "Make sure the sync was run for the season you want to archive.",
  );
  process.exit(1);
}

await mkdir(seasonDir, { recursive: true });
await writeFile(seasonDestPath, JSON.stringify(mapCache) + "\n");

// Update seasons manifest — ensure no duplicate entries.
let manifest = { seasons: [] };

if (existsSync(SEASONS_MANIFEST_PATH)) {
  try {
    manifest = JSON.parse(await readFile(SEASONS_MANIFEST_PATH, "utf8"));
  } catch {
    manifest = { seasons: [] };
  }
}

if (!Array.isArray(manifest.seasons)) {
  manifest.seasons = [];
}

const alreadyListed = manifest.seasons.some((s) => s.year === archiveSeason);

if (!alreadyListed) {
  manifest.seasons.push({
    year: archiveSeason,
    teamCount: mapCache.teamCount ?? mapCache.teams?.length ?? 0,
    generatedAt: mapCache.generatedAt ?? new Date().toISOString(),
  });

  // Keep seasons sorted newest-first.
  manifest.seasons.sort((a, b) => b.year - a.year);
}

await writeFile(
  `${SEASONS_MANIFEST_PATH}.tmp`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await rename(`${SEASONS_MANIFEST_PATH}.tmp`, SEASONS_MANIFEST_PATH);

console.log(
  `Archived season ${archiveSeason} (${mapCache.teamCount ?? "?"} teams) to ${seasonDestPath}`,
);
