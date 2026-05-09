import type { FtcTeam } from "../api/ftcScout";

export type PositionedTeam = FtcTeam & {
  position: [number, number];
  locationPrecision: "geocoded";
};

export function positionTeams(teams: FtcTeam[]) {
  return teams
    .map(positionTeam)
    .filter((team): team is PositionedTeam => team !== null);
}

export function positionTeam(team: FtcTeam): PositionedTeam | null {
  if (!team.coordinates) {
    return null;
  }

  return {
    ...team,
    locationPrecision: "geocoded",
    position: [
      clampLatitude(team.coordinates.lat),
      normalizeLongitude(team.coordinates.lng),
    ],
  };
}

function clampLatitude(latitude: number) {
  return Math.max(-84, Math.min(84, latitude));
}

function normalizeLongitude(longitude: number) {
  if (longitude > 180) {
    return longitude - 360;
  }

  if (longitude < -180) {
    return longitude + 360;
  }

  return longitude;
}
