# FTC Map

A single-page React application that shows FTC teams on a sleek dark Leaflet map
using FTCScout API data, with optional official FTC Events API enrichment.

## Features

- Fetches FTC team data from FTCScout.
- Uses FTCScout event participation data so the bundled cache is filtered to
  teams that appear on 2025 DECODE event rosters.
- Ships with a generated FTCScout team cache so the map can render without
  waiting on live FTCScout API calls.
- Optionally enriches the current-season roster from the official FTC Events
  API via a build-time generated cache.
- Renders clustered Leaflet markers for the team map.
- Shows each team's name, number, location, robot name, optional logo, and
  FTCScout profile link in a popup.
- Uses Tailwind CSS for a dark, frcmap.com-inspired interface.

FTCScout and the official FTC Events API do not expose precise team
latitude/longitude. The fastest path is `public/map-teams.json`, a generated
cache of only teams with city-level coordinates. A prebuilt cache is committed
so the app shows mapped teams immediately after install. Teams without generated
coordinates are intentionally left off the map instead of being placed at
approximate regional or country centroids.

## Development

```bash
npm install
npm run dev
```

## Optional official FTC Events data

The official FTC Events API requires Basic auth credentials. Do not put those
credentials in browser-facing Vite environment variables. Instead, generate a
static cache before building or deploying:

```bash
cp .env.example .env
# Fill in FTC_EVENTS_USERNAME and FTC_EVENTS_TOKEN, then:
export $(grep -v '^#' .env | xargs)
npm run sync:ftc
```

This writes `public/ftc-official-teams.json`. When present and matching the
current season, the app uses it as the official current-season roster and
enriches FTCScout teams with official city, state/province, country, robot name,
home region, and any logo URL fields present in the cache.

The documented FTC Events team schema does not currently expose team logos, but
the cache and UI support a `logoUrl` field if FIRST adds one later or if a
generated cache is patched with logo URLs from another authorized source.

## Refreshing the FTCScout cache

The app first tries static JSON cache files in `public/` for fast startup. To
refresh the bundled FTCScout team cache:

```bash
npm run sync:ftcscout
```

This writes `public/ftcscout-teams.json`, filtered to teams that appear on FTCScout
event team lists for the selected season.

## Refreshing geocoded coordinates

You do not need to run this for normal local viewing because prebuilt cache files
are committed. To refresh coordinates after team data changes, generate the
geocode cache and then build the map-ready cache:

```bash
npm run sync:geocodes
npm run build:map-cache
```

The script writes `public/team-geocodes.json`. It prefers
`public/ftc-official-teams.json` if present; otherwise it uses the FTCScout REST
team list. It uses an offline city database by default, reuses existing cached
locations, and can optionally use Nominatim for missing locations by setting
`GEOCODE_USE_NOMINATIM=true`.

`build:map-cache` writes `public/map-teams.json`, a smaller startup cache that
the app loads before any other data source. The map only renders teams that have
generated coordinates. Run both commands after refreshing FTCScout or official
FTC team data.

You can optionally set `GEOCODE_EMAIL` in `.env` before running the script.

## Build

```bash
npm run build
```
