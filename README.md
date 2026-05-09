# FTC Map

A single-page React application that shows FTC teams on a sleek dark Leaflet map
using FTCScout API data, with optional official FTC Events API enrichment.

## Features

- Fetches FTC team data from FTCScout.
- Uses FTCScout GraphQL active seasons when available, with a REST fallback.
- Ships with a generated FTCScout team cache so the map can render without
  waiting on live FTCScout API calls.
- Optionally enriches the current-season roster from the official FTC Events
  API via a build-time generated cache.
- Renders clustered Leaflet markers for the team map.
- Shows each team's name, number, location, robot name, optional logo, and
  FTCScout profile link in a popup.
- Uses Tailwind CSS for a dark, frcmap.com-inspired interface.

FTCScout and the official FTC Events API do not expose precise team
latitude/longitude. If `public/team-geocodes.json` exists, the app uses those
city-level coordinates; otherwise it falls back to regional or country centroids
with deterministic spreading.

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

This writes `public/ftcscout-teams.json`.

## Optional geocoded coordinates

To convert team city/state/country text into specific coordinates, generate the
geocode cache:

```bash
npm run sync:geocodes
```

The script writes `public/team-geocodes.json`. It prefers
`public/ftc-official-teams.json` if present; otherwise it uses the FTCScout REST
team list. It reuses existing cached locations and rate-limits Nominatim
requests, so the first full run can take a while.

You can optionally set `GEOCODE_EMAIL` in `.env` before running the script.

## Build

```bash
npm run build
```
