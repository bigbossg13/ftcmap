import type { FtcTeam } from "../api/ftcScout";

export type PositionedTeam = FtcTeam & {
  position: [number, number];
  locationPrecision: "region" | "country";
};

type RegionLookup = {
  center: [number, number];
  precision: PositionedTeam["locationPrecision"];
};

const US_REGION_CENTERS: Record<string, [number, number]> = {
  AL: [32.8067, -86.7911],
  AK: [61.3707, -152.4044],
  AZ: [33.7298, -111.4312],
  AR: [34.9697, -92.3731],
  CA: [36.1162, -119.6816],
  CO: [39.0598, -105.3111],
  CT: [41.5978, -72.7554],
  DE: [39.3185, -75.5071],
  DC: [38.905, -77.0163],
  FL: [27.7663, -81.6868],
  GA: [33.0406, -83.6431],
  HI: [21.0943, -157.4983],
  ID: [44.2405, -114.4788],
  IL: [40.3495, -88.9861],
  IN: [39.8494, -86.2583],
  IA: [42.0115, -93.2105],
  KS: [38.5266, -96.7265],
  KY: [37.6681, -84.6701],
  LA: [31.1695, -91.8678],
  ME: [44.6939, -69.3819],
  MD: [39.0639, -76.8021],
  MA: [42.2302, -71.5301],
  MI: [43.3266, -84.5361],
  MN: [45.6945, -93.9002],
  MS: [32.7416, -89.6787],
  MO: [38.4561, -92.2884],
  MT: [46.9219, -110.4544],
  NE: [41.1254, -98.2681],
  NV: [38.3135, -117.0554],
  NH: [43.4525, -71.5639],
  NJ: [40.2989, -74.521],
  NM: [34.8405, -106.2485],
  NY: [42.1657, -74.9481],
  NC: [35.6301, -79.8064],
  ND: [47.5289, -99.784],
  OH: [40.3888, -82.7649],
  OK: [35.5653, -96.9289],
  OR: [44.572, -122.0709],
  PA: [40.5908, -77.2098],
  PR: [18.2208, -66.5901],
  RI: [41.6809, -71.5118],
  SC: [33.8569, -80.945],
  SD: [44.2998, -99.4388],
  TN: [35.7478, -86.6923],
  TX: [31.0545, -97.5635],
  UT: [40.15, -111.8624],
  VT: [44.0459, -72.7107],
  VA: [37.7693, -78.17],
  WA: [47.4009, -121.4905],
  WV: [38.4912, -80.9545],
  WI: [44.2685, -89.6165],
  WY: [42.756, -107.3025],
};

const CANADA_REGION_CENTERS: Record<string, [number, number]> = {
  AB: [53.9333, -116.5765],
  BC: [53.7267, -127.6476],
  MB: [53.7609, -98.8139],
  NB: [46.5653, -66.4619],
  NL: [53.1355, -57.6604],
  NS: [44.682, -63.7443],
  NT: [64.8255, -124.8457],
  NU: [70.2998, -83.1076],
  ON: [50.0007, -86.0009],
  PE: [46.5107, -63.4168],
  QC: [52.9399, -73.5491],
  SK: [52.9399, -106.4509],
  YT: [64.2823, -135],
};

const REGION_ALIASES: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  DISTRICT_OF_COLUMBIA: "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  NEW_HAMPSHIRE: "NH",
  NEW_JERSEY: "NJ",
  NEW_MEXICO: "NM",
  NEW_YORK: "NY",
  NORTH_CAROLINA: "NC",
  NORTH_DAKOTA: "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  PUERTO_RICO: "PR",
  RHODE_ISLAND: "RI",
  SOUTH_CAROLINA: "SC",
  SOUTH_DAKOTA: "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  WEST_VIRGINIA: "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  ALBERTA: "AB",
  BRITISH_COLUMBIA: "BC",
  MANITOBA: "MB",
  NEW_BRUNSWICK: "NB",
  NEWFOUNDLAND_AND_LABRADOR: "NL",
  NOVA_SCOTIA: "NS",
  NORTHWEST_TERRITORIES: "NT",
  NUNAVUT: "NU",
  ONTARIO: "ON",
  PRINCE_EDWARD_ISLAND: "PE",
  QUEBEC: "QC",
  SASKATCHEWAN: "SK",
  YUKON: "YT",
};

const COUNTRY_CENTERS: Record<string, [number, number]> = {
  ARGENTINA: [-38.4161, -63.6167],
  AUSTRALIA: [-25.2744, 133.7751],
  BELGIUM: [50.5039, 4.4699],
  BRAZIL: [-14.235, -51.9253],
  CANADA: [56.1304, -106.3468],
  CHILE: [-35.6751, -71.543],
  CHINA: [35.8617, 104.1954],
  COLOMBIA: [4.5709, -74.2973],
  CYPRUS: [35.1264, 33.4299],
  DENMARK: [56.2639, 9.5018],
  DOMINICAN_REPUBLIC: [18.7357, -70.1627],
  ECUADOR: [-1.8312, -78.1834],
  EGYPT: [26.8206, 30.8025],
  FRANCE: [46.2276, 2.2137],
  GERMANY: [51.1657, 10.4515],
  GHANA: [7.9465, -1.0232],
  HONG_KONG: [22.3193, 114.1694],
  INDIA: [20.5937, 78.9629],
  INDONESIA: [-0.7893, 113.9213],
  ISRAEL: [31.0461, 34.8516],
  ITALY: [41.8719, 12.5674],
  JAMAICA: [18.1096, -77.2975],
  JAPAN: [36.2048, 138.2529],
  KAZAKHSTAN: [48.0196, 66.9237],
  KENYA: [-0.0236, 37.9062],
  LIBYA: [26.3351, 17.2283],
  MALAYSIA: [4.2105, 101.9758],
  MEXICO: [23.6345, -102.5528],
  MOROCCO: [31.7917, -7.0926],
  NETHERLANDS: [52.1326, 5.2913],
  NEW_ZEALAND: [-40.9006, 174.886],
  NIGERIA: [9.082, 8.6753],
  NORWAY: [60.472, 8.4689],
  PERU: [-9.19, -75.0152],
  PHILIPPINES: [12.8797, 121.774],
  QATAR: [25.3548, 51.1839],
  ROMANIA: [45.9432, 24.9668],
  SAUDI_ARABIA: [23.8859, 45.0792],
  SINGAPORE: [1.3521, 103.8198],
  SOUTH_AFRICA: [-30.5595, 22.9375],
  SOUTH_KOREA: [35.9078, 127.7669],
  SPAIN: [40.4637, -3.7492],
  SWEDEN: [60.1282, 18.6435],
  TAIWAN: [23.6978, 120.9605],
  THAILAND: [15.87, 100.9925],
  TURKEY: [38.9637, 35.2433],
  UNITED_ARAB_EMIRATES: [23.4241, 53.8478],
  UNITED_KINGDOM: [55.3781, -3.436],
  USA: [39.8283, -98.5795],
  VIETNAM: [14.0583, 108.2772],
};

const COUNTRY_ALIASES: Record<string, string> = {
  AUS: "AUSTRALIA",
  BRA: "BRAZIL",
  CAN: "CANADA",
  CHN: "CHINA",
  "DOMINICAN REPUBLIC": "DOMINICAN_REPUBLIC",
  GBR: "UNITED_KINGDOM",
  "HONG KONG": "HONG_KONG",
  IND: "INDIA",
  ISR: "ISRAEL",
  JPN: "JAPAN",
  KOR: "SOUTH_KOREA",
  "NEW ZEALAND": "NEW_ZEALAND",
  NLD: "NETHERLANDS",
  "SAUDI ARABIA": "SAUDI_ARABIA",
  "SOUTH AFRICA": "SOUTH_AFRICA",
  "SOUTH KOREA": "SOUTH_KOREA",
  TURKIYE: "TURKEY",
  UAE: "UNITED_ARAB_EMIRATES",
  UK: "UNITED_KINGDOM",
  "UNITED ARAB EMIRATES": "UNITED_ARAB_EMIRATES",
  "UNITED KINGDOM": "UNITED_KINGDOM",
  "UNITED STATES": "USA",
  "UNITED STATES OF AMERICA": "USA",
  US: "USA",
  USA: "USA",
};

export function positionTeams(teams: FtcTeam[]) {
  return teams.map(positionTeam);
}

export function positionTeam(team: FtcTeam): PositionedTeam {
  const lookup = getRegionLookup(team);
  const [latOffset, lngOffset] = getTeamOffset(team.number, lookup.precision);

  return {
    ...team,
    locationPrecision: lookup.precision,
    position: [
      clampLatitude(lookup.center[0] + latOffset),
      normalizeLongitude(lookup.center[1] + lngOffset),
    ],
  };
}

function getRegionLookup(team: FtcTeam): RegionLookup {
  const countryKey = normalizeKey(team.location.country);
  const stateKey = getCanonicalRegionKey(team.location.state);

  if (isUnitedStates(countryKey) && US_REGION_CENTERS[stateKey]) {
    return {
      center: US_REGION_CENTERS[stateKey],
      precision: "region",
    };
  }

  if (isCanada(countryKey) && CANADA_REGION_CENTERS[stateKey]) {
    return {
      center: CANADA_REGION_CENTERS[stateKey],
      precision: "region",
    };
  }

  const canonicalCountry = COUNTRY_ALIASES[countryKey] ?? countryKey;

  return {
    center: COUNTRY_CENTERS[canonicalCountry] ?? COUNTRY_CENTERS.USA,
    precision: "country",
  };
}

function getTeamOffset(teamNumber: number, precision: PositionedTeam["locationPrecision"]) {
  const radius = precision === "region" ? 1.15 : 3.5;
  const seed = Math.abs(Math.sin(teamNumber * 12.9898) * 43758.5453);
  const angle = (seed % 1) * Math.PI * 2;
  const distance = (0.25 + ((seed * 1.618) % 1) * 0.75) * radius;

  return [Math.sin(angle) * distance, Math.cos(angle) * distance] as [
    number,
    number,
  ];
}

function normalizeKey(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function getCanonicalRegionKey(value: string) {
  const regionKey = normalizeKey(value);

  return REGION_ALIASES[regionKey] ?? regionKey;
}

function isUnitedStates(countryKey: string) {
  return ["USA", "US", "UNITED_STATES", "UNITED_STATES_OF_AMERICA"].includes(
    countryKey,
  );
}

function isCanada(countryKey: string) {
  return ["CAN", "CANADA"].includes(countryKey);
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
