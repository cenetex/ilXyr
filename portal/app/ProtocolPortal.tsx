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
    title: "Write the plan first.",
    body: "Set the question, data, metrics, seeds, limits, and budget. ilXyr saves them as one fixed contract.",
    note: "One clear target",
  },
  {
    id: "forecast",
    label: "Forecast",
    title: "Record the forecast.",
    body: "Researchers predict the result before the run. ilXyr saves each forecast and tracks its accuracy over time.",
    note: "Prediction first",
  },
  {
    id: "admit",
    label: "Admit",
    title: "Check the plan.",
    body: "ilXyr checks the method, security, roles, budget, registration, and executor. A passing plan can move forward.",
    note: "Clear rules",
  },
  {
    id: "execute",
    label: "Execute",
    title: "Run the experiment.",
    body: "The run uses the approved code, data, budget, network rules, and output rules.",
    note: "A bounded run",
  },
  {
    id: "settle",
    label: "Settle",
    title: "Record the result.",
    body: "ilXyr checks the result against the contract. It scores the forecasts and adds the evidence to the ledger.",
    note: "One durable record",
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
          <p className="kicker"><span className="live-dot" /> Public project index</p>
          <h1>Evidence before<br /><em>execution.</em></h1>
          <p className="hero-lede">
            In ilXyr, each research claim has a test with rules set in advance. Every result
            stays on record. The evidence shapes the next question.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#protocol">Explore the system <span>↘</span></a>
            <a className="button secondary" href={guide}>Read the project deck</a>
          </div>
        </div>

        <aside className="signal-card" aria-label="Current public system signal">
          <div className="signal-topline"><span>PUBLIC DATA</span><span>LIVE INDEX</span></div>
          <div className="signal-score"><strong>{readyCount}</strong><span>parts ready today</span></div>
          <div className="signal-track"><span style={{ width: `${Math.round((readyCount / status.length) * 100)}%` }} /></div>
          <p>This site shows public project data. Compute approval happens inside ilXyr.</p>
        </aside>
      </section>

      <section className="status-strip" aria-label="System status">
        <div><span>01 / Local executor</span><strong>Available</strong></div>
        <div><span>02 / Remote verifier</span><strong>Implemented</strong></div>
        <div><span>03 / Cloud launcher</span><strong>Implemented</strong></div>
      </section>

      <section className="protocol-section section-block" id="protocol">
        <div className="section-heading">
          <p className="section-index">01 — The protocol</p>
          <h2>A clear path<br />from question to result.</h2>
          <p>Each step creates a record for the next step.</p>
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
          <h2>Every result<br />has a record.</h2>
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
            <div className="empty-state"><strong>Try another search.</strong><span>Use a broader term or another status.</span></div>
          )}
        </div>
      </section>

      <section className="api-section section-block" id="api">
        <div className="section-heading compact-heading inverse-heading">
          <p className="section-index">03 — Public API</p>
          <h2>Read the<br />public data.</h2>
          <p>Use these endpoints to read public JSON. Compute approval happens inside ilXyr.</p>
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
          <p className="section-index">04 — Project status</p>
          <h2>Clear stages<br />of verification.</h2>
          <p>Each environment and result shows its current review status.</p>
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
              <p>Verified remote results: 0. The first verified result will appear here.</p>
            ) : (
              results.map((result) => <p key={result.id}>{result.experiment_id} — {result.run_ref}</p>)
            )}
          </div>
          <div className="boundary-card warning-card">
            <span className="card-label">Reporting API</span>
            <h3>Built.<br />Deployment planned.</h3>
            <p>
              The reporting API is complete in the source code. Public rollout will add TLS,
              trust roots, monitoring, backups, and recovery.
            </p>
          </div>
        </div>
      </section>

      <section className="tools-section section-block" id="tools">
        <div className="section-heading compact-heading">
          <p className="section-index">05 — Build with it</p>
          <h2>Use the command line.</h2>
          <p>Start each command with <code>ilxyr</code>. Open a group to see its commands.</p>
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
          <h2>Read the project.</h2>
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
        <p className="footer-note">A research protocol, ledger, and command line tool.<br />Public data · compute approval in ilXyr.</p>
      </footer>
    </main>
  );
}
