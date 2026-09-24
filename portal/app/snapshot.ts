import snapshot from "./public-snapshot.json";

export { snapshot };

export function currentFreshness(now = Date.now()) {
  return now > Date.parse(snapshot.source.stale_after) ? "stale" : "current";
}

export function siteStatus(now = Date.now()) {
  return [
    { key: "registry_as_of", value: snapshot.source.as_of },
    { key: "registry_freshness", value: currentFreshness(now) },
    { key: "active_experiment", value: snapshot.governance.active_experiment || "none" },
    { key: "accepted_diagnostic_reports", value: String(snapshot.results.length) },
    { key: "permaweb_discovery", value: snapshot.source_health.find((source) => source.id === "permaweb-discovery")?.status || "not_checked" },
  ];
}

export const experiments = snapshot.experiments.map((experiment) => ({
  ...experiment,
  status: experiment.disclosure_state === "withheld" ? "withheld" :
    experiment.execution_state === "blocked" ? "blocked" :
      experiment.scientific_outcome === "unknown" ? experiment.execution_state :
        `${experiment.scientific_outcome.replaceAll("_", "-")} · ${experiment.evidence_maturity.replaceAll("_", " ")}`,
}));

export const executionEnvironments = snapshot.environments;
export const publicResults = snapshot.results.map((result) => ({ ...result, url: result.source }));
