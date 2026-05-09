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

type AggregateClusterGroup = {
  bounds: L.LatLngBounds;
  count: number;
  label: string;
  position: [number, number];
};

type ClusterLevel = "continent" | "country" | "region" | "city";

type AggregateClusterLevel = Extract<ClusterLevel, "continent" | "country">;

type ClusterDescriptor = {
  key: string;
  label: string;
};

const COUNTRY_CONTINENTS: Record<string, string> = {
  australia: "Oceania",
  belarus: "Europe",
  belgium: "Europe",
  brazil: "South America",
  canada: "North America",
  china: "Asia",
  cyprus: "Europe",
  "czech republic": "Europe",
  eswatini: "Africa",
  france: "Europe",
  germany: "Europe",
  independent: "Independent",
  india: "Asia",
  israel: "Asia",
  jamaica: "North America",
  japan: "Asia",
  jordan: "Asia",
  kazakhstan: "Asia",
  kyrgyzstan: "Asia",
  libya: "Africa",
  lithuania: "Europe",
  mexico: "North America",
  moldova: "Europe",
  netherlands: "Europe",
  "new zealand": "Oceania",
  nigeria: "Africa",
  portugal: "Europe",
  qatar: "Asia",
  romania: "Europe",
  slovenia: "Europe",
  "south africa": "Africa",
  "south korea": "Asia",
  spain: "Europe",
  "sri lanka": "Asia",
  sweden: "Europe",
  taiwan: "Asia",
  thailand: "Asia",
  turkmenistan: "Asia",
  uk: "Europe",
  ukraine: "Europe",
  "united arab emirates": "Asia",
  "united kingdom": "Europe",
  "united states": "North America",
  "united states of america": "North America",
  us: "North America",
  usa: "North America",
  uzbekistan: "Asia",
  vietnam: "Asia",
};

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

function syncLayerVisibility(
  map: L.Map,
  layer: L.LayerGroup,
  shouldShow: boolean,
) {
  if (shouldShow && !map.hasLayer(layer)) {
    layer.addTo(map);
    return;
  }

  if (!shouldShow && map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
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
    const continentLayer = L.layerGroup();

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

    buildAggregateClusterGroups(teams, "country").forEach((group) => {
      const marker = L.marker(group.position, {
        icon: createAggregateClusterIcon(group, "country"),
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

    buildAggregateClusterGroups(teams, "continent").forEach((group) => {
      const marker = L.marker(group.position, {
        icon: createAggregateClusterIcon(group, "continent"),
        title: `${group.label}: ${group.count.toLocaleString()} teams`,
        zIndexOffset: 500,
      });

      marker.on("click", () => {
        map.fitBounds(group.bounds.pad(0.12), {
          animate: true,
          maxZoom: 4,
        });
      });

      continentLayer.addLayer(marker);
    });

    const syncVisibleLayer = () => {
      const clusterLevel = getClusterLevel(map.getZoom());
      const showContinentLayer = clusterLevel === "continent";
      const showCountryLayer = clusterLevel === "country";

      if (showContinentLayer || showCountryLayer) {
        if (map.hasLayer(teamLayer)) {
          map.removeLayer(teamLayer);
        }
      } else if (!map.hasLayer(teamLayer)) {
        teamLayer.addTo(map);
      }

      syncLayerVisibility(map, continentLayer, showContinentLayer);
      syncLayerVisibility(map, countryLayer, showCountryLayer);

      if (!showContinentLayer && !showCountryLayer) {
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
      continentLayer.removeFrom(map);
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
  if (zoom <= 6) {
    return 68;
  }

  if (zoom <= 8) {
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

function createAggregateClusterIcon(
  group: AggregateClusterGroup,
  level: AggregateClusterLevel,
) {
  return L.divIcon({
    className: "team-cluster-icon",
    html: renderClusterHtml(group.count, group.label, level, true),
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

function buildAggregateClusterGroups(
  teams: PositionedTeam[],
  level: AggregateClusterLevel,
) {
  const groups = new Map<
    string,
    {
      label: string;
      teams: PositionedTeam[];
    }
  >();

  teams.forEach((team) => {
    const descriptor =
      level === "continent"
        ? getContinentClusterDescriptor(team)
        : getCountryClusterDescriptor(team);
    const group = groups.get(descriptor.key) ?? {
      label: descriptor.label,
      teams: [],
    };

    group.teams.push(team);
    groups.set(descriptor.key, group);
  });

  return [...groups.values()].map((group): AggregateClusterGroup => {
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

function getContinentClusterDescriptor(team: PositionedTeam): ClusterDescriptor {
  const country = normalizeClusterPart(team.location.country);
  const continent =
    COUNTRY_CONTINENTS[normalizeClusterKey(country)] ?? inferContinent(team);

  return {
    key: normalizeClusterKey(continent),
    label: continent,
  };
}

function getCountryClusterDescriptor(team: PositionedTeam): ClusterDescriptor {
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

function inferContinent(team: PositionedTeam) {
  const [lat, lng] = team.position;

  if (lat < -10 && lng > 110) {
    return "Oceania";
  }

  if (lng < -30) {
    return lat < 15 ? "South America" : "North America";
  }

  if (lat < -35) {
    return "Oceania";
  }

  if (lng < 45 && lat > -35) {
    return lat >= 35 ? "Europe" : "Africa";
  }

  return "Asia";
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
  if (zoom <= 2) {
    return "continent";
  }

  if (zoom <= 4) {
    return "country";
  }

  if (zoom <= 8) {
    return "region";
  }

  return "city";
}

function getClusterLocationValue(
  team: PositionedTeam,
  level: ClusterLevel,
) {
  switch (level) {
    case "continent":
      return getContinentClusterDescriptor(team).label;
    case "country":
      return team.location.country;
    case "region":
      return team.homeRegion || team.location.state || team.location.country;
    case "city":
      return team.location.city || team.location.state || team.location.country;
  }
}

function getClusterFallbackLabel(level: ClusterLevel) {
  switch (level) {
    case "continent":
      return "Continents";
    case "country":
      return "Countries";
    case "region":
      return "Regions";
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
