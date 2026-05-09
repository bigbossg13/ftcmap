import { useEffect } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { getFtcScoutProfileUrl } from "../api/ftcScout";
import type { PositionedTeam } from "../lib/teamLocations";

type TeamMapProps = {
  teams: PositionedTeam[];
};

type TeamMarker = L.Marker & {
  team?: PositionedTeam;
};

export default function TeamMap({ teams }: TeamMapProps) {
  return (
    <MapContainer
      center={[32, -28]}
      zoom={3}
      minZoom={2}
      maxZoom={10}
      scrollWheelZoom
      worldCopyJump
      className="h-full min-h-[34rem] rounded-[2rem]"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <MapControls />
      <TeamMarkerLayer teams={teams} />
    </MapContainer>
  );
}

function MapControls() {
  const map = useMap();

  useEffect(() => {
    const control = L.control.zoom({ position: "bottomright" }).addTo(map);

    return () => {
      control.remove();
    };
  }, [map]);

  return null;
}

function TeamMarkerLayer({ teams }: TeamMapProps) {
  const map = useMap();

  useEffect(() => {
    const layer = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: getClusterRadius,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => createClusterIcon(cluster, map.getZoom()),
    }).addTo(map);

    teams.forEach((team) => {
      const marker = L.marker(team.position, {
        icon: createTeamIcon(team),
        title: `${team.number} ${team.name}`,
      }) as TeamMarker;

      marker.team = team;

      marker.bindPopup(() => renderTeamPopup(team), {
        className: "team-popup",
        closeButton: true,
        maxWidth: 270,
        minWidth: 250,
      });

      layer.addLayer(marker);
    });

    if (teams.length > 0) {
      const bounds = L.latLngBounds(teams.map((team) => team.position));
      map.fitBounds(bounds.pad(0.08), {
        animate: false,
        maxZoom: 5,
      });
    }

    return () => {
      layer.removeFrom(map);
    };
  }, [map, teams]);

  return null;
}

function createTeamIcon(team: PositionedTeam) {
  const precisionClass =
    team.locationPrecision === "geocoded" ? "team-marker--geocoded" : "";

  return L.divIcon({
    className: "team-marker-icon",
    html: `<span class="team-marker ${precisionClass}"></span>`,
    iconSize: [28, 34],
    iconAnchor: [14, 32],
    popupAnchor: [0, -30],
  });
}

function getClusterRadius(zoom: number) {
  if (zoom <= 3) {
    return 88;
  }

  if (zoom <= 5) {
    return 68;
  }

  if (zoom <= 7) {
    return 50;
  }

  return 34;
}

function createClusterIcon(cluster: L.MarkerCluster, zoom: number) {
  const count = cluster.getChildCount();
  const summary = getClusterSummary(cluster, zoom);
  const sizeClass =
    count >= 1000
      ? "team-cluster--xl"
      : count >= 100
        ? "team-cluster--lg"
        : count >= 10
          ? "team-cluster--md"
          : "team-cluster--sm";

  return L.divIcon({
    className: "team-cluster-icon",
    html: `<div class="team-cluster ${sizeClass} team-cluster--${summary.level}"><span class="team-cluster-count">${count.toLocaleString()}</span><span class="team-cluster-label">${escapeHtml(summary.label)}</span></div>`,
    iconSize: [72, 72],
    iconAnchor: [36, 36],
  });
}

function getClusterSummary(cluster: L.MarkerCluster, zoom: number) {
  const level = getClusterLevel(zoom);
  const teams = cluster
    .getAllChildMarkers()
    .map((marker) => (marker as TeamMarker).team)
    .filter((team): team is PositionedTeam => Boolean(team));
  const values = teams
    .map((team) => getClusterLocationValue(team, level))
    .filter(Boolean);
  const fallbackLabel = getClusterFallbackLabel(level);

  if (values.length === 0) {
    return { level, label: fallbackLabel };
  }

  const valueCounts = new Map<string, number>();

  values.forEach((value) => {
    valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
  });

  const [mostCommonValue, mostCommonCount] = [...valueCounts.entries()].sort(
    ([, leftCount], [, rightCount]) => rightCount - leftCount,
  )[0];

  if (valueCounts.size === 1) {
    return { level, label: mostCommonValue };
  }

  if (mostCommonCount / values.length >= 0.7) {
    return { level, label: `${mostCommonValue}+` };
  }

  return { level, label: fallbackLabel };
}

function getClusterLevel(zoom: number) {
  if (zoom <= 3) {
    return "country";
  }

  if (zoom <= 5) {
    return "state";
  }

  if (zoom <= 7) {
    return "area";
  }

  return "city";
}

function getClusterLocationValue(
  team: PositionedTeam,
  level: ReturnType<typeof getClusterLevel>,
) {
  switch (level) {
    case "country":
      return team.location.country;
    case "state":
      return team.location.state || team.location.country;
    case "area":
      return team.homeRegion || team.location.state || team.location.country;
    case "city":
      return team.location.city || team.location.state || team.location.country;
  }
}

function getClusterFallbackLabel(level: ReturnType<typeof getClusterLevel>) {
  switch (level) {
    case "country":
      return "Countries";
    case "state":
      return "States";
    case "area":
      return "Areas";
    case "city":
      return "Cities";
  }
}

function renderTeamPopup(team: PositionedTeam) {
  const location = [team.location.city, team.location.state, team.location.country]
    .filter(Boolean)
    .join(", ");
  return `
    <article class="team-popup-card">
      ${renderTeamLogo(team)}
      <span class="team-popup-number">FTC ${escapeHtml(String(team.number))}</span>
      <h3 class="team-popup-title">${escapeHtml(team.name)}</h3>
      <p class="team-popup-location">${escapeHtml(location || "Location unavailable")}</p>
      ${team.robotName ? `<p class="team-popup-location">Robot: ${escapeHtml(team.robotName)}</p>` : ""}
      ${team.homeRegion ? `<p class="team-popup-location">Region: ${escapeHtml(team.homeRegion)}</p>` : ""}
      <a class="team-popup-link" href="${getFtcScoutProfileUrl(
        team.number,
      )}" target="_blank" rel="noreferrer">View FTCScout profile</a>
    </article>
  `;
}

function renderTeamLogo(team: PositionedTeam) {
  if (team.logoUrl) {
    return `<img class="team-popup-logo" src="${escapeHtml(
      team.logoUrl,
    )}" alt="${escapeHtml(team.name)} logo" loading="lazy" />`;
  }

  return `<div class="team-popup-logo team-popup-logo-fallback">${getInitials(
    team.name,
  )}</div>`;
}

function getInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return escapeHtml(initials || "FTC");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
