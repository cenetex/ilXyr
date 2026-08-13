import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { connectWallet, readRegistryProcess, sendRegistryAction } from "./ao";
import { arweaveUrl, config } from "./config";
import { hydrateRecord, loadRegistry, verifyEvidenceFile } from "./arweave";
import type { AoProposal, AoSnapshot, EvidenceFile, RegistryRecord } from "./types";

type View = "registry" | "submit" | "index";
type FileState = "idle" | "checking" | "verified" | "failed";

const proposalInitial = {
  title: "",
  summary: "",
  hypothesis: "",
  family: "zero",
  baseline: "model://",
  dataset: "dataset://",
  metric: "",
  threshold: "",
  seeds: "1, 2, 3",
  compute_credits: "",
  evidence_level: "deterministic_replay",
  export_policy: "artifacts",
  novelty: "",
};

function short(value: string, left = 7, right = 5) {
  if (value.length <= left + right + 1) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function outcomeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outcomeTone(value: string) {
  if (value === "go" || value === "accepted") return "go";
  if (value.includes("failure") || value.includes("no_go") || value === "rejected") return "no-go";
  return "open";
}

function reviewTypeLabel(value: string) {
  if (value === "blocking") return "must fix";
  if (value === "endorsement") return "approve";
  return "suggestion";
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function FileRow({ record, file }: { record: RegistryRecord; file: EvidenceFile }) {
  const [state, setState] = useState<FileState>("idle");

  const verify = async () => {
    setState("checking");
    try {
      const result = await verifyEvidenceFile(record, file);
      setState(result.verified ? "verified" : "failed");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="file-row">
      <div>
        <a href={arweaveUrl(record.txId, file.path)} target="_blank" rel="noreferrer">{file.path}</a>
        <span>{file.media_type} · {new Intl.NumberFormat().format(file.bytes)} bytes</span>
      </div>
      <code>{short(file.sha256, 10, 8)}</code>
      <button className={`verify-button ${state}`} onClick={verify} disabled={state === "checking"}>
        {state === "idle" && "Verify file"}
        {state === "checking" && "Checking file…"}
        {state === "verified" && "✓ Verified"}
        {state === "failed" && "! Hash mismatch"}
      </button>
    </div>
  );
}

function RecordDetail({ record, onClose }: { record: RegistryRecord; onClose: () => void }) {
  return (
    <div className="detail-backdrop" role="dialog" aria-modal="true" aria-label={`Evidence for ${record.title}`}>
      <div className="detail-sheet">
        <div className="detail-toolbar">
          <div><span className={`outcome-chip ${outcomeTone(record.outcome)}`}>{outcomeLabel(record.outcome)}</span><span>{record.trusted ? "Approved publisher" : "Publisher not approved"}</span></div>
          <button onClick={onClose} aria-label="Close evidence detail">×</button>
        </div>
        <div className="detail-hero">
          <p className="eyebrow">Experiment evidence</p>
          <h2>{record.title}</h2>
          <p>{record.experimentId}</p>
        </div>
        <div className="detail-facts">
          <div><span>Arweave transaction</span><a href={arweaveUrl(record.txId)} target="_blank" rel="noreferrer">{record.txId} ↗</a></div>
          <div><span>Evidence reference</span><strong>{record.evidenceRef || "Not declared"}</strong></div>
          <div><span>Publisher</span><strong>{record.owner}</strong></div>
          <div><span>Listed by</span><strong>{record.source.replaceAll("-", " ")}</strong></div>
        </div>
        <div className="file-heading"><div><p className="eyebrow">Evidence files</p><h3>{record.files.length} files</h3></div><p>Select Verify file. The app downloads that file and checks its SHA-256 hash.</p></div>
        <div className="file-list">
          {record.files.length ? record.files.map((file) => <FileRow key={file.path} record={record} file={file} />) : <p className="empty-copy">This transaction does not include a file list.</p>}
        </div>
      </div>
    </div>
  );
}

function ProposalDetail({ proposal, wallet, refresh, notify }: {
  proposal: AoProposal;
  wallet: string;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [working, setWorking] = useState(false);
  const [review, setReview] = useState({ category: "methodology", severity: "advisory", comment: "" });
  const [forecast, setForecast] = useState({ probability: "50", stake: "10", rationale: "" });
  const [funding, setFunding] = useState({ compute_credits: "50", rationale: "" });

  const act = async (action: string, payload: Record<string, unknown>) => {
    setWorking(true);
    try {
      const result = await sendRegistryAction(action, { proposal_id: proposal.id, ...payload });
      notify(`${action.replaceAll("-", " ")} recorded · ${short(result.messageId)}`);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "AO action failed", true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="proposal-detail">
      <div className="proposal-detail-head">
        <div><span className={`status-pill ${proposal.status}`}>{proposal.status}</span><span>{proposal.id}</span><span>{proposal.family}</span></div>
        <h2>{proposal.title}</h2>
        <p>{proposal.hypothesis}</p>
      </div>
      <div className="proposal-contract-grid">
        <div><span>Owner</span><strong>{short(proposal.owner, 11, 8)}</strong></div>
        <div><span>Baseline</span><strong>{proposal.baseline}</strong></div>
        <div><span>Dataset</span><strong>{proposal.dataset}</strong></div>
        <div><span>Decision rule</span><strong>{proposal.metric} · {proposal.threshold}</strong></div>
        <div><span>Seeds</span><strong>{proposal.seeds.join(" · ")}</strong></div>
        <div><span>Compute limit</span><strong>{proposal.compute_credits} credits</strong></div>
      </div>
      <div className="readiness-list">
        {proposal.readiness?.checks.map((check) => <span className={check.pass ? "pass" : "fail"} key={check.label}>{check.pass ? "✓" : "!"} {check.label}</span>)}
      </div>
      {proposal.status === "review" && (
        <div className="action-grid">
          <form onSubmit={(event) => { event.preventDefault(); void act("Review", review); setReview({ ...review, comment: "" }); }}>
            <p className="eyebrow">Add a review</p>
            <div className="split-fields"><label>Category<select value={review.category} onChange={(event) => setReview({ ...review, category: event.target.value })}><option value="methodology">Methodology</option><option value="security">Security</option><option value="engineering">Engineering</option><option value="prior_art">Prior art</option></select></label><label>Review type<select value={review.severity} onChange={(event) => setReview({ ...review, severity: event.target.value })}><option value="advisory">Suggestion</option><option value="blocking">Must fix</option><option value="endorsement">Approve</option></select></label></div>
            <label>Feedback<textarea required rows={3} value={review.comment} onChange={(event) => setReview({ ...review, comment: event.target.value })} /></label>
            <button className="secondary-button" disabled={working || !wallet}>Sign review</button>
          </form>
          <div className="promotion-box"><p className="eyebrow">Promotion</p><strong>{proposal.readiness?.score || 0}% ready</strong><p>Promotion locks this proposal. People can then add forecasts and compute credits.</p><button className="primary-button" disabled={working || !wallet || wallet !== proposal.owner || !proposal.readiness?.promotable} onClick={() => void act("Promote", {})}>Promote to candidate <span>↗</span></button></div>
        </div>
      )}
      {proposal.status === "candidate" && (
        <div className="action-grid">
          <form onSubmit={(event) => { event.preventDefault(); void act("Forecast", { probability: Number(forecast.probability) / 100, stake: Number(forecast.stake), rationale: forecast.rationale }); }}>
            <p className="eyebrow">Forecast</p>
            <div className="split-fields"><label>Success probability (%)<input type="number" min="0" max="100" required value={forecast.probability} onChange={(event) => setForecast({ ...forecast, probability: event.target.value })} /></label><label>Forecast stake<input type="number" min="1" required value={forecast.stake} onChange={(event) => setForecast({ ...forecast, stake: event.target.value })} /></label></div>
            <label>Rationale<textarea required rows={3} value={forecast.rationale} onChange={(event) => setForecast({ ...forecast, rationale: event.target.value })} /></label>
            <button className="secondary-button" disabled={working || !wallet || wallet === proposal.owner}>Sign forecast</button>
          </form>
          <form className="fund-form" onSubmit={(event) => { event.preventDefault(); void act("Fund", { compute_credits: Number(funding.compute_credits), rationale: funding.rationale }); }}>
            <p className="eyebrow">Add compute credits</p>
            <label>Credits<input type="number" min="1" required value={funding.compute_credits} onChange={(event) => setFunding({ ...funding, compute_credits: event.target.value })} /></label>
            <label>Reason for funding<textarea required rows={3} value={funding.rationale} onChange={(event) => setFunding({ ...funding, rationale: event.target.value })} /></label>
            <button className="primary-button" disabled={working || !wallet}>Commit credits <span>↗</span></button>
          </form>
        </div>
      )}
      <div className="thread-list">
        {(proposal.reviews || []).map((item) => <article key={item.id} className={item.severity}><span>{item.category.replaceAll("_", " ")} · {reviewTypeLabel(item.severity)}</span><p>{item.comment}</p><code>{short(item.reviewer)}</code></article>)}
      </div>
    </section>
  );
}

export default function App() {
  const [view, setView] = useState<View>("registry");
  const [records, setRecords] = useState<RegistryRecord[]>([]);
  const [snapshot, setSnapshot] = useState<AoSnapshot | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RegistryRecord | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<AoProposal | null>(null);
  const [wallet, setWallet] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [proposal, setProposal] = useState(proposalInitial);

  const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);

  const refreshProcess = useCallback(async () => {
    try {
      const next = await readRegistryProcess();
      setSnapshot(next);
      if (selectedProposal && next) {
        setSelectedProposal(next.proposals.find((item) => item.id === selectedProposal.id) || null);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not read the AO process", true);
    }
  }, [notify, selectedProposal]);

  useEffect(() => {
    Promise.all([loadRegistry(), readRegistryProcess()])
      .then(([nextRecords, nextSnapshot]) => {
        setRecords(nextRecords);
        setSnapshot(nextSnapshot);
      })
      .catch((error) => notify(error instanceof Error ? error.message : "Registry discovery failed", true))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => {
    window.arweaveWallet?.getActiveAddress().then(setWallet).catch(() => undefined);
  }, []);

  const openRecord = async (record: RegistryRecord) => {
    const hydrated = await hydrateRecord(record);
    setSelectedRecord(hydrated);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => [record.title, record.experimentId, record.outcome, record.evidenceRef].some((value) => value.toLowerCase().includes(needle)));
  }, [query, records]);

  const connect = async () => {
    try {
      const address = await connectWallet();
      setWallet(address);
      notify(`Wallet connected · ${short(address)}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Wallet connection failed", true);
    }
  };

  const submitProposal = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      ...proposal,
      threshold: Number(proposal.threshold),
      seeds: proposal.seeds.split(",").map((seed) => Number(seed.trim())).filter((seed) => Number.isInteger(seed) && seed >= 0),
      compute_credits: Number(proposal.compute_credits),
    };
    if (!config.aoProcess) {
      downloadJson("ilxyr-proposal.json", { schema: "ilxyr.proposal-draft.v1", ...payload });
      notify("AO process is not configured; exported a portable proposal draft instead.");
      return;
    }
    try {
      const result = await sendRegistryAction("Propose", payload);
      notify(`Proposal permanently submitted · ${short(result.messageId)}`);
      setProposal(proposalInitial);
      setView("registry");
      await refreshProcess();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Proposal submission failed", true);
    }
  };

  const totalBytes = records.reduce((sum, record) => sum + record.files.reduce((fileSum, file) => fileSum + file.bytes, 0), 0);

  return (
    <div className="app-shell">
      <header>
        <button className="brand" onClick={() => setView("registry")}><span>iX</span><div>ilXyr<small>permanent registry</small></div></button>
        <nav aria-label="Primary navigation"><button className={view === "registry" ? "active" : ""} onClick={() => setView("registry")}>Evidence</button><button className={view === "submit" ? "active" : ""} onClick={() => setView("submit")}>Submit</button><button className={view === "index" ? "active" : ""} onClick={() => setView("index")}>Index</button></nav>
        <button className={`wallet-button ${wallet ? "connected" : ""}`} onClick={connect}><i />{wallet ? short(wallet) : "Connect wallet"}</button>
      </header>

      {notice && <div className={`notice ${notice.error ? "error" : ""}`} role="status"><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}

      {view === "registry" && (
        <main>
          <section className="hero">
            <div className="hero-copy"><p className="eyebrow">Permanent experiment registry</p><h1>Find and verify <em>experiment evidence.</em></h1><p>View experiment plans, forecasts, run records, and failed results. Check each publisher and file hash.</p><div><button className="primary-button" onClick={() => setView("submit")}>Submit an experiment <span>↗</span></button><a className="text-button" href="#registry">Browse evidence <span>↓</span></a></div></div>
            <div className="perma-card"><div className="perma-head"><span>Storage network</span><span className="live">Arweave</span></div><div className="perma-mark"><strong>{loading ? "…" : records.length}</strong><span>permanent experiment {records.length === 1 ? "record" : "records"}</span></div><div className="perma-rule"><span /></div><dl><div><dt>Approved publishers</dt><dd>{config.publishers.length}</dd></div><div><dt>Files in the index</dt><dd>{records.reduce((sum, record) => sum + record.files.length, 0)}</dd></div><div><dt>Stored data</dt><dd>{Math.max(1, Math.round(totalBytes / 1024))} KiB</dd></div></dl><p>The index helps you find records. Check the publisher and file hashes before you trust them.</p></div>
          </section>

          <section className="trust-band"><span>Data stored on Arweave</span><i>→</i><span>Publisher address</span><i>→</i><span>SHA-256 file hashes</span><i>→</i><span>ilXyr ledger check</span></section>

          <section className="registry-section" id="registry">
            <div className="section-heading"><div><p className="eyebrow">Experiment evidence</p><h2>Results stay available, including failed runs.</h2></div><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by experiment, result, or hash" /></label></div>
            <div className="record-list">
              {loading && [0, 1, 2].map((item) => <div className="record-row loading" key={item} />)}
              {!loading && filtered.map((record, index) => <button className="record-row" onClick={() => void openRecord(record)} key={record.txId}><span className="record-number">{String(index + 1).padStart(2, "0")}</span><div className="record-title"><span className={`outcome-chip ${outcomeTone(record.outcome)}`}>{outcomeLabel(record.outcome)}</span><h3>{record.title}</h3><p>{record.experimentId}</p></div><div className="record-evidence"><span>Evidence ref</span><code>{record.evidenceRef ? short(record.evidenceRef, 22, 12) : "—"}</code></div><div className="record-trust"><span className={record.trusted ? "trusted" : "untrusted"}>{record.trusted ? "✓ publisher" : "! unknown"}</span><strong>{record.files.length} files</strong></div><span className="row-arrow">↗</span></button>)}
              {!loading && filtered.length === 0 && <p className="empty-copy">No permanent records match this search.</p>}
            </div>
          </section>

          <section className="queue-section">
            <div className="section-heading"><div><p className="eyebrow">Experiment proposals</p><h2>Review proposals before promotion.</h2></div><span className={`process-state ${config.aoProcess ? "online" : "offline"}`}>{config.aoProcess ? "AO process is ready" : "AO process is not deployed"}</span></div>
            {snapshot?.proposals.length ? <div className="proposal-queue">{snapshot.proposals.map((item) => <button key={item.id} onClick={() => setSelectedProposal(item)}><span className={`status-pill ${item.status}`}>{item.status}</span><h3>{item.title}</h3><p>{item.hypothesis}</p><div><span>{item.family}</span><span>{item.compute_credits} credits</span><span>{item.readiness?.score || 0}% ready</span></div></button>)}</div> : <div className="process-empty"><div><strong>This website is permanent. Proposals use an AO process.</strong><p>After the AO process is deployed, this page shows wallet-signed proposals, reviews, forecasts, and compute credits.</p></div><button className="secondary-button" onClick={() => setView("submit")}>Create a proposal</button></div>}
            {selectedProposal && <ProposalDetail proposal={selectedProposal} wallet={wallet} refresh={refreshProcess} notify={notify} />}
          </section>
        </main>
      )}

      {view === "submit" && (
        <main className="inner-page">
          <section className="page-intro"><div><p className="eyebrow">New experiment proposal</p><h1>Describe the experiment.</h1></div><p>Complete each required field. People can review the proposal before it is locked as a funding candidate.</p></section>
          <div className="submit-layout">
            <aside><p className="eyebrow">Check before you submit</p><ol><li><span>01</span>Write a hypothesis that can be proven wrong.</li><li><span>02</span>Select the exact baseline and dataset.</li><li><span>03</span>Set the metric, threshold, seeds, and compute limit.</li><li><span>04</span>Ask another person to review the proposal.</li></ol><div><strong>{config.aoProcess ? "AO submission is ready" : "Download draft only"}</strong><p>{config.aoProcess ? `Messages are sent to ${short(config.aoProcess, 12, 8)}.` : "No AO process is configured. Submit downloads a JSON file."}</p></div></aside>
            <form className="proposal-form" onSubmit={submitProposal}>
              <fieldset><legend>Experiment</legend><label>Title<input required value={proposal.title} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} placeholder="Q2.7 replay-constrained routing" /></label><label>Summary<textarea required rows={3} value={proposal.summary} onChange={(event) => setProposal({ ...proposal, summary: event.target.value })} /></label><label>Testable hypothesis<textarea required minLength={24} rows={4} value={proposal.hypothesis} onChange={(event) => setProposal({ ...proposal, hypothesis: event.target.value })} /></label><div className="split-fields"><label>Model family<select value={proposal.family} onChange={(event) => setProposal({ ...proposal, family: event.target.value })}><option value="zero">Zero</option><option value="solomon">Solomon</option></select></label><label>What is new?<textarea required rows={2} value={proposal.novelty} onChange={(event) => setProposal({ ...proposal, novelty: event.target.value })} /></label></div></fieldset>
              <fieldset><legend>Test settings</legend><div className="split-fields"><label>Baseline URI<input required value={proposal.baseline} onChange={(event) => setProposal({ ...proposal, baseline: event.target.value })} /></label><label>Dataset URI<input required value={proposal.dataset} onChange={(event) => setProposal({ ...proposal, dataset: event.target.value })} /></label></div><div className="triple-fields"><label>Primary metric<input required value={proposal.metric} onChange={(event) => setProposal({ ...proposal, metric: event.target.value })} /></label><label>Pass threshold<input required type="number" step="any" value={proposal.threshold} onChange={(event) => setProposal({ ...proposal, threshold: event.target.value })} /></label><label>Random seeds<input required value={proposal.seeds} onChange={(event) => setProposal({ ...proposal, seeds: event.target.value })} /></label></div><div className="triple-fields"><label>Compute credit limit<input required type="number" min="1" value={proposal.compute_credits} onChange={(event) => setProposal({ ...proposal, compute_credits: event.target.value })} /></label><label>Evidence type<select value={proposal.evidence_level} onChange={(event) => setProposal({ ...proposal, evidence_level: event.target.value })}><option value="exact_check">Exact check</option><option value="deterministic_replay">Deterministic replay</option><option value="corpus_proxy">Corpus proxy</option><option value="review">Review</option></select></label><label>Output sharing<select value={proposal.export_policy} onChange={(event) => setProposal({ ...proposal, export_policy: event.target.value })}><option value="artifacts">Share files</option><option value="metrics_only">Share metrics only</option><option value="none">Share nothing</option></select></label></div></fieldset>
              <div className="signature-callout"><div><span>Wallet signature</span><strong>{wallet ? `Signing as ${short(wallet, 12, 9)}` : "Connect a wallet to publish"}</strong></div><p>Your wallet signs the AO message. The website does not receive your private key.</p></div>
              <div className="form-actions"><button type="button" className="text-button" onClick={() => setView("registry")}>← Cancel</button><button className="primary-button" type="submit" disabled={Boolean(config.aoProcess) && !wallet}>{config.aoProcess ? "Sign and submit" : "Export proposal draft"} <span>↗</span></button></div>
            </form>
          </div>
        </main>
      )}

      {view === "index" && (
        <main className="inner-page index-page">
          <section className="page-intro"><div><p className="eyebrow">Experiment index</p><h1>How the index works.</h1></div><p>The index helps you find records. It is not proof. Check the publisher, file hashes, and ilXyr ledger before you trust a record.</p></section>
          <section className="index-stack">
            <div className="index-layer"><span>01</span><div><p className="eyebrow">Gateway search</p><h2>Find records</h2><p>GraphQL searches by approved publisher address and ilXyr tags. You can use a different gateway.</p></div><code>{config.gateway}/graphql</code></div>
            <div className="index-layer"><span>02</span><div><p className="eyebrow">Index versions</p><h2>Save the current list</h2><p>Each `ilxyr.index.v1` file points to the previous index file and lists exact evidence transactions.</p></div><code>{config.indexTx || "INDEX_TX_NOT_YET_PUBLISHED"}</code></div>
            <div className="index-layer"><span>03</span><div><p className="eyebrow">ArNS name</p><h2>Point a name to the latest version</h2><p>An ArNS name can point to the latest app or index. Older versions still have permanent transaction links.</p></div><code>{config.arnsName ? `${config.arnsName}.ar.io` : "ARNS_NAME_NOT_YET_CONFIGURED"}</code></div>
          </section>
          <section className="index-contract"><div><p className="eyebrow">Index file</p><h2>You can read and check the index.</h2><p>Each entry connects an experiment ID to its evidence reference, result, publisher, and permanent Arweave transaction.</p></div><pre>{`{
  "schema": "ilxyr.index.v1",
  "sequence": 7,
  "previous_index_tx": "…",
  "ledger_head": "artifact://sha256/…",
  "published_by": "arweave://${config.publishers[0] || "…"}",
  "experiments": [
    { "experiment_id": "…", "bundle_tx": "…" }
  ]
}`}</pre></section>
          <section className="publisher-table"><p className="eyebrow">Approved publishers</p>{config.publishers.map((publisher) => <div key={publisher}><span className="trusted">✓ approved</span><code>{publisher}</code><a href={`${config.gateway}/wallet/${publisher}/balance`} target="_blank" rel="noreferrer">View wallet ↗</a></div>)}</section>
        </main>
      )}

      {selectedRecord && <RecordDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
      <footer><div><span className="footer-mark">iX</span><p><strong>ilXyr</strong><br />Review, fund, and verify experiments.</p></div><p>Permanent records · Changeable gateways · Verifiable file hashes</p><a href="https://github.com/cenetex/ilXyr" target="_blank" rel="noreferrer">View source code ↗</a></footer>
    </div>
  );
}
