# FTC Map

A single-page React application that shows FTC teams on a sleek dark Leaflet map
using FTCScout API data.

## Features

- Fetches FTC team data from FTCScout.
- Uses FTCScout GraphQL active seasons when available, with a REST fallback.
- Renders performant Leaflet canvas markers for the team map.
- Shows each team's name, number, location, and FTCScout profile link in a popup.
- Uses Tailwind CSS for a dark, frcmap.com-inspired interface.

FTCScout does not expose precise team latitude/longitude, so markers use
regional or country centroids with deterministic spreading.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
