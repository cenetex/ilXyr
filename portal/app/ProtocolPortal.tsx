"use client";

import { useMemo, useState } from "react";

type StatusItem = { readonly key: string; readonly value: string };
type RouteItem = { readonly method: string; readonly path: string; readonly description: string };
type EnvironmentItem = {
  readonly id: string;
  readonly state: string;
  readonly compatibility: string;
  readonly source: string;
  readonly note: string;
};
type ResultItem = { readonly id: string; readonly experiment_id: string; readonly run_ref: string };
type ExperimentItem = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly url: string;
};
type DocumentItem = { readonly id: string; readonly title: string; readonly url: string };
type CliGroup = { readonly name: string; readonly calls: readonly string[] };

type ProtocolPortalProps = {
  status: readonly StatusItem[];
  routes: readonly RouteItem[];
  environments: readonly EnvironmentItem[];
  results: readonly ResultItem[];
  experiments: readonly ExperimentItem[];
  documents: readonly DocumentItem[];
  cliGroups: readonly CliGroup[];
  repository: string;
  guide: string;
};

const protocolSteps = [
  {
    id: "freeze",
    label: "Freeze",
    title: "Lock the question before the answer exists.",
    body: "The proposal, data, metric, thresholds, seeds, stop rules, evidence level, and compute ceiling become one immutable experiment contract.",
    note: "No silent target drift",
  },
  {
    id: "forecast",
    label: "Forecast",
    title: "Make uncertainty explicit.",
    body: "Independent actors forecast the outcome and commit credits before results are visible. Their calibration becomes part of the record.",
    note: "Prediction before observation",
  },
  {
    id: "admit",
    label: "Admit",
    title: "Let deterministic gates decide.",
    body: "Method, security, role separation, funding, executor policy, and preregistration must all fit. A package alone never authorizes spend.",
    note: "Policy, not discretion",
  },
  {
    id: "execute",
    label: "Execute",
    title: "Run inside a bounded envelope.",
    body: "Exact source, artifacts, runtime, network policy, watchdog behavior, budget, and output rules are bound before compute starts.",
    note: "Replayable by construction",
  },
  {
    id: "settle",
    label: "Settle",
    title: "Keep the result—especially when it fails.",
    body: "Evidence resolves the frozen outcome contract, scores forecasts, and appends a hash-linked record. No-go results close branches honestly.",
    note: "Negative results count",
  },
] as const;

function words(value: string) {
  return value.replaceAll("_", " ");
}

function experimentTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("no-go")) return "no-go";
  if (normalized.includes("go")) return "go";
  if (normalized.includes("active") || normalized.includes("continue")) return "active";
  return "pending";
}

export function ProtocolPortal({
  status,
  routes,
  environments,
  results,
  experiments,
  documents,
  cliGroups,
  repository,
  guide,
}: ProtocolPortalProps) {
  const [activeStep, setActiveStep] = useState<(typeof protocolSteps)[number]["id"]>("freeze");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeRoute, setActiveRoute] = useState(routes[1]?.path ?? routes[0]?.path ?? "/api");
  const [apiOutput, setApiOutput] = useState<unknown>({
    ready: true,
    note: "Choose an endpoint, then run the public query.",
  });
  const [apiState, setApiState] = useState<"idle" | "loading" | "success" | "error">("idle");

  const readyCount = status.filter((item) =>
    ["available_for_public_weight_experiments", "implemented", "implemented_with_fake_node"].includes(
      item.value,
    ),
  ).length;
  const activeProtocol = protocolSteps.find((step) => step.id === activeStep) ?? protocolSteps[0];
  const selectedRoute = routes.find((route) => route.path === activeRoute) ?? routes[0];

  const visibleExperiments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return experiments.filter((experiment) => {
      const tone = experimentTone(experiment.status);
      const matchesFilter = filter === "all" || tone === filter;
      const matchesQuery = !needle || `${experiment.id} ${experiment.title} ${experiment.status}`.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [experiments, filter, query]);

  async function runQuery() {
    setApiState("loading");
    try {
      const response = await fetch(activeRoute, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Request returned ${response.status}`);
      setApiOutput(await response.json());
      setApiState("success");
    } catch (error) {
      setApiOutput({ error: error instanceof Error ? error.message : "The query could not be completed." });
      setApiState("error");
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="ilXyr home">
          il<span>X</span>yr
        </a>
        <nav aria-label="Primary navigation">
          <a href="#protocol">Protocol</a>
          <a href="#experiments">Experiments</a>
          <a href="#api">API</a>
          <a href={repository}>GitHub</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker"><span className="live-dot" /> Public protocol index · live</p>
          <h1>Evidence before<br /><em>execution.</em></h1>
          <p className="hero-lede">
            ilXyr turns research ideas into frozen experiments, admits only what passes its gates,
            and leaves every result in a verifiable ledger.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#protocol">Explore the system <span>↘</span></a>
            <a className="button secondary" href={guide}>Read the project deck</a>
          </div>
        </div>

        <aside className="signal-card" aria-label="Current public system signal">
          <div className="signal-topline"><span>PUBLIC SIGNAL</span><span>READ ONLY</span></div>
          <div className="signal-score"><strong>{readyCount}</strong><span>implemented public surfaces</span></div>
          <div className="signal-track"><span style={{ width: `${Math.round((readyCount / status.length) * 100)}%` }} /></div>
          <p>This public website is a read-only index. Protocol data is public. Compute authorization is not.</p>
        </aside>
      </section>

      <section className="status-strip" aria-label="System status">
        <div><span>01 / Local executor</span><strong>Available</strong></div>
        <div><span>02 / Remote verifier</span><strong>Implemented</strong></div>
        <div><span>03 / Cloud launcher</span><strong className="muted-status">Roadmap</strong></div>
      </section>

      <section className="protocol-section section-block" id="protocol">
        <div className="section-heading">
          <p className="section-index">01 — The protocol</p>
          <h2>One system.<br />A visible chain of proof.</h2>
          <p>Each stage reduces ambiguity before the next one can begin.</p>
        </div>

        <div className="protocol-workbench">
          <div className="step-tabs" role="tablist" aria-label="Experiment protocol stages">
            {protocolSteps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={activeStep === step.id}
                className={activeStep === step.id ? "active" : ""}
                onClick={() => setActiveStep(step.id)}
              >
                <span>0{index + 1}</span>{step.label}
              </button>
            ))}
          </div>
          <div className="step-detail" role="tabpanel">
            <p className="detail-number">0{protocolSteps.indexOf(activeProtocol) + 1}</p>
            <div>
              <p className="micro-label">{activeProtocol.note}</p>
              <h3>{activeProtocol.title}</h3>
              <p>{activeProtocol.body}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="experiments-section section-block" id="experiments">
        <div className="section-heading compact-heading">
          <p className="section-index">02 — Evidence ledger</p>
          <h2>The outcome is data.<br />Not a press release.</h2>
        </div>

        <div className="experiment-tools">
          <label className="search-box">
            <span>Search evidence</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Experiment, title, or status"
            />
          </label>
          <div className="filter-group" aria-label="Filter experiments">
            {[
              ["all", "All"],
              ["go", "Go"],
              ["no-go", "No-go"],
              ["active", "Active"],
              ["pending", "Other"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "active" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="experiment-count" aria-live="polite">
          <strong>{String(visibleExperiments.length).padStart(2, "0")}</strong>
          <span>records shown</span>
        </div>

        <div className="experiment-list">
          {visibleExperiments.map((experiment, index) => (
            <a className="experiment-row" href={experiment.url} key={experiment.id}>
              <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{experiment.id}</strong><span>{experiment.title}</span></div>
              <span className={`result-pill ${experimentTone(experiment.status)}`}>{experiment.status}</span>
              <span className="row-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
          {visibleExperiments.length === 0 && (
            <div className="empty-state"><strong>No records match.</strong><span>Try a broader term or another status.</span></div>
          )}
        </div>
      </section>

      <section className="api-section section-block" id="api">
        <div className="section-heading compact-heading inverse-heading">
          <p className="section-index">03 — Public surface</p>
          <h2>Ask the ledger<br />directly.</h2>
          <p>These endpoints return public, read-only JSON. There are no write or cloud-launch routes.</p>
        </div>

        <div className="api-console">
          <div className="endpoint-list" role="listbox" aria-label="Public API endpoints">
            {routes.map((route) => (
              <button
                key={route.path}
                type="button"
                role="option"
                aria-selected={activeRoute === route.path}
                className={activeRoute === route.path ? "active" : ""}
                onClick={() => {
                  setActiveRoute(route.path);
                  setApiState("idle");
                  setApiOutput({ ready: true, note: "Run this public query to inspect its current response." });
                }}
              >
                <span>{route.method}</span><code>{route.path}</code>
              </button>
            ))}
          </div>
          <div className="response-panel">
            <div className="response-toolbar">
              <div>
                <span>Selected endpoint</span>
                <strong><code>{selectedRoute?.path}</code></strong>
              </div>
              <button type="button" onClick={runQuery} disabled={apiState === "loading"}>
                {apiState === "loading" ? "Running…" : "Run query"}<span>→</span>
              </button>
            </div>
            <p className="endpoint-description">{selectedRoute?.description}</p>
            <pre aria-live="polite" data-state={apiState}>{JSON.stringify(apiOutput, null, 2)}</pre>
          </div>
        </div>
      </section>

      <section className="boundary-section section-block" id="boundary">
        <div className="section-heading compact-heading">
          <p className="section-index">04 — Execution boundary</p>
          <h2>Known is not verified.</h2>
          <p>Known does not mean compatible. Compatible does not mean a result is verified.</p>
        </div>

        <div className="boundary-grid">
          <div className="boundary-card">
            <span className="card-label">Reference environment</span>
            {environments.map((environment) => (
              <div key={environment.id}>
                <a href={environment.source}><code>{environment.id}</code> ↗</a>
                <dl>
                  <div><dt>State</dt><dd>{words(environment.state)}</dd></div>
                  <div><dt>Compatibility</dt><dd>{words(environment.compatibility)}</dd></div>
                </dl>
                <p>{environment.note}</p>
              </div>
            ))}
          </div>
          <div className="boundary-card result-card">
            <span className="card-label">Verified remote results</span>
            <strong>{String(results.length).padStart(2, "0")}</strong>
            {results.length === 0 ? (
              <p>None. No remote result has passed independent ilXyr verification.</p>
            ) : (
              results.map((result) => <p key={result.id}>{result.experiment_id} — {result.run_ref}</p>)
            )}
          </div>
          <div className="boundary-card warning-card">
            <span className="card-label">Reporting boundary</span>
            <h3>Implemented.<br />Not deployed.</h3>
            <p>
              Separate report intake API — implemented, not deployed. There is no public intake
              address yet, and observation cannot launch, restart, or extend compute.
            </p>
          </div>
        </div>
      </section>

      <section className="tools-section section-block" id="tools">
        <div className="section-heading compact-heading">
          <p className="section-index">05 — Build with it</p>
          <h2>A typed command surface.</h2>
          <p>Prefix every call with <code>ilxyr</code>. Open a group to inspect its current commands.</p>
        </div>

        <div className="command-groups">
          {cliGroups.map((group, index) => (
            <details key={group.name} open={index === 0}>
              <summary><span>0{index + 1}</span><strong>{group.name}</strong><em>{group.calls.length} calls</em></summary>
              <div className="command-list">
                {group.calls.map((call) => <code key={call}>ilxyr {call}</code>)}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="documents-section section-block">
        <div className="section-heading compact-heading">
          <p className="section-index">06 — Read the source</p>
          <h2>Nothing important is hidden.</h2>
        </div>
        <div className="document-grid">
          {documents.map((document, index) => (
            <a href={document.url} key={document.id}>
              <span>0{index + 1}</span><strong>{document.title}</strong><em>↗</em>
            </a>
          ))}
        </div>
      </section>

      <footer>
        <div>
          <a className="wordmark" href="#top">il<span>X</span>yr</a>
          <p>Intelligent Lab eXperiment Yielding Research.</p>
        </div>
        <div className="footer-links">
          <a href={repository}>Repository ↗</a>
          <a href={guide}>Project deck ↗</a>
          <a href="/api">Public API ↗</a>
        </div>
        <p className="footer-note">A research protocol, ledger, and command line tool.<br />Public index · no launch authority.</p>
      </footer>
    </main>
  );
}
