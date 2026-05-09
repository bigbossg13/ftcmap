import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchActiveTeams, type TeamFetchResult } from "./api/ftcScout";
import TeamMap from "./components/TeamMap";
import { positionTeams } from "./lib/teamLocations";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; result: TeamFetchResult }
  | { status: "error"; message: string };

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let ignore = false;

    async function loadTeams() {
      setLoadState({ status: "loading" });

      try {
        const result = await fetchActiveTeams();

        if (!ignore) {
          setLoadState({ status: "ready", result });
        }
      } catch (error) {
        if (!ignore) {
          setLoadState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load FTCScout team data.",
          });
        }
      }
    }

    void loadTeams();

    return () => {
      ignore = true;
    };
  }, []);

  const positionedTeams = useMemo(
    () =>
      loadState.status === "ready"
        ? positionTeams(loadState.result.teams)
        : [],
    [loadState],
  );

  const stats = useMemo(() => {
    const countries = new Set(
      positionedTeams.map((team) => team.location.country).filter(Boolean),
    );
    const regions = new Set(
      positionedTeams
        .map((team) => `${team.location.country}:${team.location.state}`)
        .filter((region) => !region.endsWith(":")),
    );

    return {
      countries: countries.size,
      regions: regions.size,
      logos: positionedTeams.filter((team) => team.logoUrl).length,
      geocoded: positionedTeams.filter(
        (team) => team.locationPrecision === "geocoded",
      ).length,
      approximate:
        positionedTeams.filter((team) => team.locationPrecision === "country")
          .length,
    };
  }, [positionedTeams]);

  const season = loadState.status === "ready" ? loadState.result.season : null;
  const isRestFallback =
    loadState.status === "ready" && loadState.result.source === "rest-fallback";
  const isOfficialCache =
    loadState.status === "ready" &&
    loadState.result.source === "official-ftc-cache";
  const officialData =
    loadState.status === "ready" ? loadState.result.officialData : undefined;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <BackgroundGlow />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1800px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 rounded-[2rem] border border-cyan-300/10 bg-slate-950/75 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">
              {isOfficialCache ? "FTCScout + official FTC data" : "FTCScout live data"}
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              FTC Team Map
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              Explore active FTC teams on a dark Leaflet map. Click any marker
              for the team name, number, and FTCScout profile.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 lg:min-w-[50rem]">
            <StatCard
              label={season ? `${season} teams` : "Teams"}
              value={
                loadState.status === "ready"
                  ? positionedTeams.length.toLocaleString()
                  : "..."
              }
            />
            <StatCard label="Countries" value={formatStat(stats.countries)} />
            <StatCard label="Regions" value={formatStat(stats.regions)} />
            <StatCard label="Geocoded" value={formatStat(stats.geocoded)} />
            <StatCard label="Logos" value={formatStat(stats.logos)} />
            <StatCard label="Approx." value={formatStat(stats.approximate)} />
          </div>
        </header>

        <section className="grid flex-1 gap-5 xl:grid-cols-[23rem_minmax(0,1fr)]">
          <aside className="order-2 rounded-[2rem] border border-white/10 bg-slate-950/75 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl xl:order-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-white">Map layer</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Clustered markers represent FTC teams.
                </p>
              </div>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-50" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-300" />
              </span>
            </div>

            <div className="mt-6 space-y-3">
              <InfoPanel title="Data source">
                Teams are fetched from FTCScout. If a build-time official FTC
                Events API cache is present, it becomes the current-season
                roster and enriches team city, state, country, robot name, and
                any logo URL fields available in the cache.
              </InfoPanel>
              <InfoPanel title="Location precision">
                FTCScout and official FTC Events data expose city, state, and
                country text but no latitude or longitude. If generated
                geocodes are present, markers use those city-level coordinates;
                otherwise they fall back to regional or country centroids.
              </InfoPanel>
              {isRestFallback ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                  Active-season filtering is estimated from current-season
                  FTCScout record updates because GraphQL active seasons were
                  unavailable.
                </div>
              ) : null}
              {officialData ? (
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-100">
                  Official FTC cache loaded{" "}
                  {officialData.teamCount.toLocaleString()} season teams with{" "}
                  {officialData.locationCount.toLocaleString()} official
                  locations.
                </div>
              ) : null}
              {loadState.status === "error" ? (
                <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm leading-6 text-rose-100">
                  <strong className="block text-rose-50">Could not load teams</strong>
                  {loadState.message}
                </div>
              ) : null}
            </div>
          </aside>

          <div className="order-1 min-h-[calc(100vh-15rem)] overflow-hidden rounded-[2rem] border border-cyan-300/10 bg-slate-900/70 p-2 shadow-2xl shadow-cyan-950/20 xl:order-2">
            <div className="relative h-full min-h-[34rem] overflow-hidden rounded-[1.5rem]">
              <TeamMap teams={positionedTeams} />
              {loadState.status === "loading" ? <LoadingOverlay /> : null}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <dt className="text-[0.67rem] font-bold uppercase tracking-[0.2em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-black text-white">{value}</dd>
    </div>
  );
}

function InfoPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">{children}</p>
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-[500] flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
      <div className="rounded-3xl border border-cyan-300/20 bg-slate-950/85 px-6 py-5 text-center shadow-2xl shadow-black/50">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200" />
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.22em] text-cyan-100">
          Loading FTCScout teams
        </p>
      </div>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute left-[-8rem] top-[-10rem] h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="absolute bottom-[-8rem] right-[-6rem] h-[28rem] w-[28rem] rounded-full bg-blue-600/20 blur-3xl" />
      <div className="absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-3xl" />
    </div>
  );
}

function formatStat(value: number) {
  return value > 0 ? value.toLocaleString() : "...";
}
