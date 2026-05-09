import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { getFtcScoutProfileUrl } from "../api/ftcScout";
import type { PositionedTeam } from "../lib/teamLocations";

type TeamMapProps = {
  teams: PositionedTeam[];
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
    const renderer = L.canvas({ padding: 0.5 });
    const layer = L.layerGroup().addTo(map);

    teams.forEach((team) => {
      const marker = L.circleMarker(team.position, {
        renderer,
        radius: team.locationPrecision === "region" ? 4 : 3.4,
        stroke: true,
        color: "#67e8f9",
        weight: 1,
        opacity: 0.86,
        fill: true,
        fillColor: "#22d3ee",
        fillOpacity: 0.58,
        bubblingMouseEvents: false,
      }).addTo(layer);

      marker.bindPopup(renderTeamPopup(team), {
        className: "team-popup",
        closeButton: true,
        maxWidth: 270,
        minWidth: 250,
      });

      marker.on("mouseover", () => {
        marker.setRadius(7);
        marker.setStyle({
          color: "#ffffff",
          fillColor: "#38bdf8",
          fillOpacity: 0.95,
        });
      });

      marker.on("mouseout", () => {
        marker.setRadius(team.locationPrecision === "region" ? 4 : 3.4);
        marker.setStyle({
          color: "#67e8f9",
          fillColor: "#22d3ee",
          fillOpacity: 0.58,
        });
      });
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

function renderTeamPopup(team: PositionedTeam) {
  const location = [team.location.city, team.location.state, team.location.country]
    .filter(Boolean)
    .join(", ");
  const precision =
    team.locationPrecision === "region"
      ? "Approximate regional position"
      : "Approximate country position";

  return `
    <article class="team-popup-card">
      ${renderTeamLogo(team)}
      <span class="team-popup-number">FTC ${escapeHtml(String(team.number))}</span>
      <h3 class="team-popup-title">${escapeHtml(team.name)}</h3>
      <p class="team-popup-location">${escapeHtml(location || "Location unavailable")}</p>
      ${team.robotName ? `<p class="team-popup-location">Robot: ${escapeHtml(team.robotName)}</p>` : ""}
      ${team.homeRegion ? `<p class="team-popup-location">Region: ${escapeHtml(team.homeRegion)}</p>` : ""}
      <p class="team-popup-location">${precision}</p>
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
