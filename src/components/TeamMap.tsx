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

type CountryClusterGroup = {
  bounds: L.LatLngBounds;
  count: number;
  label: string;
  position: [number, number];
};

type ClusterLevel = "country" | "state" | "area" | "city";

const OUTLYING_US_REGIONS: Record<string, string> = {
  AK: "Alaska",
  AS: "American Samoa",
  GU: "Guam",
  HI: "Hawaii",
  MP: "Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
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
    const teamLayer = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: getClusterRadius,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => createClusterIcon(cluster, map.getZoom()),
    });
    const countryLayer = L.layerGroup();

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

      teamLayer.addLayer(marker);
    });

    buildCountryClusterGroups(teams).forEach((group) => {
      const marker = L.marker(group.position, {
        icon: createCountryClusterIcon(group),
        title: `${group.label}: ${group.count.toLocaleString()} teams`,
        zIndexOffset: 400,
      });

      marker.on("click", () => {
        map.fitBounds(group.bounds.pad(0.12), {
          animate: true,
          maxZoom: 5,
        });
      });

      countryLayer.addLayer(marker);
    });

    const syncVisibleLayer = () => {
      const showCountryLayer = getClusterLevel(map.getZoom()) === "country";

      if (showCountryLayer) {
        if (map.hasLayer(teamLayer)) {
          map.removeLayer(teamLayer);
        }

        if (!map.hasLayer(countryLayer)) {
          countryLayer.addTo(map);
        }
      } else {
        if (map.hasLayer(countryLayer)) {
          map.removeLayer(countryLayer);
        }

        if (!map.hasLayer(teamLayer)) {
          teamLayer.addTo(map);
        }

        teamLayer.refreshClusters();
      }
    };

    syncVisibleLayer();
    map.on("zoomend", syncVisibleLayer);

    if (teams.length > 0) {
      const bounds = L.latLngBounds(teams.map((team) => team.position));
      map.fitBounds(bounds.pad(0.08), {
        animate: false,
        maxZoom: 5,
      });
    }

    return () => {
      map.off("zoomend", syncVisibleLayer);
      countryLayer.removeFrom(map);
      teamLayer.removeFrom(map);
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

  return L.divIcon({
    className: "team-cluster-icon",
    html: renderClusterHtml(count, summary.label, summary.level),
    iconSize: [72, 72],
    iconAnchor: [36, 36],
  });
}

function createCountryClusterIcon(group: CountryClusterGroup) {
  return L.divIcon({
    className: "team-cluster-icon",
    html: renderClusterHtml(group.count, group.label, "country", true),
    iconSize: [72, 72],
    iconAnchor: [36, 36],
  });
}

function renderClusterHtml(
  count: number,
  label: string,
  level: ClusterLevel,
  isAggregate = false,
) {
  const aggregateClass = isAggregate ? "team-cluster--aggregate" : "";

  return `<div class="team-cluster ${getClusterSizeClass(count)} team-cluster--${level} ${aggregateClass}"><span class="team-cluster-count">${count.toLocaleString()}</span><span class="team-cluster-label">${escapeHtml(label)}</span></div>`;
}

function getClusterSizeClass(count: number) {
  return count >= 1000
    ? "team-cluster--xl"
    : count >= 100
      ? "team-cluster--lg"
      : count >= 10
        ? "team-cluster--md"
        : "team-cluster--sm";
}

function buildCountryClusterGroups(teams: PositionedTeam[]) {
  const groups = new Map<
    string,
    {
      label: string;
      teams: PositionedTeam[];
    }
  >();

  teams.forEach((team) => {
    const descriptor = getCountryClusterDescriptor(team);
    const group = groups.get(descriptor.key) ?? {
      label: descriptor.label,
      teams: [],
    };

    group.teams.push(team);
    groups.set(descriptor.key, group);
  });

  return [...groups.values()].map((group): CountryClusterGroup => {
    const bounds = L.latLngBounds(group.teams.map((team) => team.position));
    const position = getAveragePosition(group.teams);

    return {
      bounds,
      count: group.teams.length,
      label: group.label,
      position,
    };
  });
}

function getCountryClusterDescriptor(team: PositionedTeam) {
  const country = normalizeClusterPart(team.location.country) || "Unknown";
  const state = normalizeClusterPart(team.location.state).toUpperCase();
  const countryKey = normalizeClusterKey(country);

  if (isUnitedStates(country) && OUTLYING_US_REGIONS[state]) {
    return {
      key: `${countryKey}:${state}`,
      label: OUTLYING_US_REGIONS[state],
    };
  }

  return {
    key: countryKey,
    label: country,
  };
}

function getAveragePosition(teams: PositionedTeam[]): [number, number] {
  const totals = teams.reduce(
    (sum, team) => ({
      lat: sum.lat + team.position[0],
      lng: sum.lng + team.position[1],
    }),
    { lat: 0, lng: 0 },
  );

  return [totals.lat / teams.length, totals.lng / teams.length];
}

function isUnitedStates(country: string) {
  const countryKey = normalizeClusterKey(country);

  return (
    countryKey === "usa" ||
    countryKey === "us" ||
    countryKey === "united states" ||
    countryKey === "united states of america"
  );
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

function getClusterLevel(zoom: number): ClusterLevel {
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
  level: ClusterLevel,
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

function getClusterFallbackLabel(level: ClusterLevel) {
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

function normalizeClusterPart(value: string) {
  return value.trim();
}

function normalizeClusterKey(value: string) {
  return normalizeClusterPart(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
