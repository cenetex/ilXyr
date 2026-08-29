"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Check = { label: string; pass: boolean };
type Proposal = {
  id: string;
  ownerName: string;
  status: "candidate" | "review" | "blocked";
  title: string;
  summary: string;
  hypothesis: string;
  family: string;
  baseline: string;
  datasets: string[];
  primaryMetric: string;
  successThreshold: number;
  seeds: number[];
  computeCredits: number;
  evidenceLevel: string;
  exportPolicy: string;
  novelty: string;
  blockingReviews: number;
  reviewCount: number;
  committedCredits: number;
  forecastCount: number;
  readiness: { checks: Check[]; score: number; promotable: boolean };
};

type Review = {
  id: number;
  reviewer_name: string;
  category: string;
  severity: "blocking" | "advisory" | "endorsement";
  comment: string;
  addressed: number;
  response: string | null;
  resolved: number;
  can_address: boolean;
  can_resolve: boolean;
  created_at: string;
};

type View = "home" | "funding" | "submit" | "workspace";

const experiments = [
  {
    id: "EXP-006",
    title: "Holo HRR attention at T=512",
    status: "Settled · proxy",
    outcome: "Softmax led both HRR variants in validation quality and speed.",
    tone: "proxy",
  },
  {
    id: "EXP-005",
    title: "Q2.6 family replication",
    status: "Preregistered",
    outcome: "Seeds 1 and 3 remain unobserved; ZERO.3 stays current.",
    tone: "open",
  },
  {
    id: "EXP-004",
    title: "Replay-tangent projection",
    status: "Go",
    outcome: "700 full-scale commits; public and promotion gates passed.",
    tone: "go",
  },
  {
    id: "EXP-003",
    title: "Deterministic backtracking",
    status: "No-go",
    outcome: "Eight attempts exhausted every frozen scale before a checkpoint.",
    tone: "nogo",
  },
];

const initialForm = {
  title: "",
  summary: "",
  hypothesis: "",
  family: "zero",
  novelty: "",
  baseline: "model://",
  dataset: "dataset://",
  primaryMetric: "",
  successThreshold: "",
  seeds: "1, 2, 3",
  computeCredits: "",
  evidenceLevel: "deterministic_replay",
  exportPolicy: "artifacts",
};

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function statusLabel(status: Proposal["status"]) {
  if (status === "candidate") return "Funding candidate";
  if (status === "blocked") return "Blocked";
  return "In review";
}

export default function PortalApp() {
  const [view, setView] = useState<View>("home");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [submitStep, setSubmitStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [reviewForm, setReviewForm] = useState({
    category: "Methodology",
    severity: "advisory",
    comment: "",
  });
  const [fundingForm, setFundingForm] = useState({ computeCredits: "50", rationale: "" });
  const [forecastForm, setForecastForm] = useState({ probability: "50", stake: "10", rationale: "" });

  useEffect(() => {
    let active = true;
    async function loadProposals() {
      try {
        const response = await fetch("/api/proposals");
        const data = (await response.json()) as { proposals?: Proposal[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load proposals");
        if (active) setProposals(data.proposals || []);
      } catch (error) {
        if (active) {
          setNotice(error instanceof Error ? error.message : "Could not load proposals");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadProposals();
    return () => {
      active = false;
    };
  }, []);

  const openProposal = useCallback(async (proposal: Proposal) => {
    setSelected(proposal);
    setReviews([]);
    setView("workspace");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const response = await fetch(`/api/proposals?id=${encodeURIComponent(proposal.id)}`);
      const data = (await response.json()) as {
        proposal?: Proposal;
        reviews?: Review[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not open proposal");
      if (data.proposal) setSelected(data.proposal);
      setReviews(data.reviews || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open proposal");
    }
  }, []);

  const navigate = (next: View) => {
    setView(next);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const postAction = async (payload: Record<string, unknown>) => {
    setWorking(true);
    setNotice("");
    try {
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { proposal?: Proposal; error?: string };
      if (!response.ok) throw new Error(data.error || "The action could not be completed");
      if (data.proposal) {
        setSelected(data.proposal);
        setProposals((current) => {
          const exists = current.some((proposal) => proposal.id === data.proposal!.id);
          return exists
            ? current.map((proposal) => (proposal.id === data.proposal!.id ? data.proposal! : proposal))
            : [data.proposal!, ...current];
        });
      }
      return data.proposal;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action could not be completed");
      return undefined;
    } finally {
      setWorking(false);
    }
  };

  const submitProposal = async (event: FormEvent) => {
    event.preventDefault();
    const proposal = await postAction({ action: "create", ...form });
    if (proposal) {
      setForm(initialForm);
      setSubmitStep(0);
      setReviews([]);
      setView("workspace");
      setNotice("Proposal created. It is now open for structured review.");
    }
  };

  const addReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const proposal = await postAction({ action: "review", proposalId: selected.id, ...reviewForm });
    if (proposal) {
      setReviewForm((current) => ({ ...current, comment: "" }));
      await openProposal(proposal);
      setNotice("Feedback added to the review record.");
    }
  };

  const resolveReview = async (reviewId: number) => {
    if (!selected) return;
    const proposal = await postAction({ action: "resolve", proposalId: selected.id, reviewId });
    if (proposal) {
      await openProposal(proposal);
      setNotice("Review marked as resolved.");
    }
  };

  const addressReview = async (reviewId: number) => {
    if (!selected) return;
    const proposal = await postAction({ action: "address", proposalId: selected.id, reviewId });
    if (proposal) {
      await openProposal(proposal);
      setNotice("Feedback marked as addressed. The reviewer can now resolve it.");
    }
  };

  const promote = async () => {
    if (!selected) return;
    const proposal = await postAction({ action: "promote", proposalId: selected.id });
    if (proposal) setNotice("Contract frozen. This proposal is now a funding candidate.");
  };

  const fund = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const proposal = await postAction({ action: "fund", proposalId: selected.id, ...fundingForm });
    if (proposal) {
      setFundingForm((current) => ({ ...current, rationale: "" }));
      setNotice("Compute commitment recorded.");
    }
  };

  const forecast = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const proposal = await postAction({
      action: "forecast",
      proposalId: selected.id,
      probability: Number(forecastForm.probability) / 100,
      stake: forecastForm.stake,
      rationale: forecastForm.rationale,
    });
    if (proposal) {
      setForecastForm((current) => ({ ...current, rationale: "" }));
      setNotice("Sealed forecast recorded.");
    }
  };

  const candidateProposals = useMemo(
    () => proposals.filter((proposal) => proposal.status === "candidate"),
    [proposals],
  );
  const openReviewCount = proposals.filter((proposal) => proposal.status === "review").length;
  const totalRequested = candidateProposals.reduce((sum, proposal) => sum + proposal.computeCredits, 0);
  const totalCommitted = candidateProposals.reduce((sum, proposal) => sum + proposal.committedCredits, 0);

  return (
    <div className="portal-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => navigate("home")} aria-label="Go to ilXyr home">
          <span className="wordmark-glyph">iX</span>
          <span>ilXyr <small>lab portal</small></span>
        </button>
        <nav aria-label="Primary navigation">
          <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}>Registry</button>
          <button className={view === "funding" ? "active" : ""} onClick={() => navigate("funding")}>Funding queue</button>
          <button className={view === "submit" ? "active" : ""} onClick={() => navigate("submit")}>Submit</button>
        </nav>
        <div className="access-pill"><span /> Private lab</div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss message">×</button>
        </div>
      )}

      {view === "home" && (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">Intelligent Lab eXperiment Yielding Research</p>
              <h1>Research worth funding starts as a <em>falsifiable</em> question.</h1>
              <p className="lede">
                Submit a proposal, sharpen it in public review, then freeze the contract before
                forecasts, funding, or evidence can move.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => navigate("submit")}>Submit an experiment <span>↗</span></button>
                <button className="text-button" onClick={() => navigate("funding")}>See what needs funding <span>→</span></button>
              </div>
            </div>
            <div className="signal-panel">
              <div className="signal-header"><span>Live funding signal</span><span className="live-dot">Live</span></div>
              <div className="signal-number">{formatCredits(totalCommitted)}<small> / {formatCredits(totalRequested)} credits</small></div>
              <div className="progress-track"><span style={{ width: `${totalRequested ? Math.min(100, (totalCommitted / totalRequested) * 100) : 0}%` }} /></div>
              <div className="signal-grid">
                <div><strong>{candidateProposals.length}</strong><span>funding candidates</span></div>
                <div><strong>{openReviewCount}</strong><span>in structured review</span></div>
                <div><strong>6</strong><span>settled experiments</span></div>
              </div>
              <p>Compute follows forecast disagreement per credit—not popularity.</p>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div><p className="eyebrow">Active work</p><h2>From question to candidate</h2></div>
              <button className="text-button" onClick={() => navigate("funding")}>Open the queue <span>→</span></button>
            </div>
            <div className="proposal-grid">
              {loading ? (
                [0, 1, 2].map((item) => <div className="proposal-card loading-card" key={item} />)
              ) : proposals.map((proposal, index) => (
                <button className="proposal-card" onClick={() => openProposal(proposal)} key={proposal.id}>
                  <div className="card-topline"><span className={`status-chip ${proposal.status}`}>{statusLabel(proposal.status)}</span><span>0{index + 1}</span></div>
                  <h3>{proposal.title}</h3>
                  <p>{proposal.summary}</p>
                  <div className="card-meta">
                    <span>{proposal.family.toUpperCase()}</span>
                    <span>{formatCredits(proposal.computeCredits)} credits</span>
                    <span>{proposal.readiness.score}% ready</span>
                  </div>
                  <div className="card-rule"><span style={{ width: `${proposal.readiness.score}%` }} /></div>
                  <div className="card-link">Open proposal <span>↗</span></div>
                </button>
              ))}
            </div>
          </section>

          <section className="process-band">
            <div><p className="eyebrow">The contract boundary</p><h2>Editable ideas.<br />Immutable experiments.</h2></div>
            <ol>
              <li><span>01</span><div><strong>Shape</strong><p>Turn an intuition into a decidable question with a baseline and cost ceiling.</p></div></li>
              <li><span>02</span><div><strong>Challenge</strong><p>Attach methodology, security, and novelty feedback to exact contract fields.</p></div></li>
              <li><span>03</span><div><strong>Freeze</strong><p>Pass every readiness gate, then seal the contract before beliefs or resources move.</p></div></li>
              <li><span>04</span><div><strong>Settle</strong><p>Admit, execute, and publish the result—even when the result is no-go.</p></div></li>
            </ol>
          </section>

          <section className="section-block evidence-section">
            <div className="section-heading">
              <div><p className="eyebrow">Evidence registry</p><h2>Every result stays visible</h2></div>
              <a className="text-button" href="https://cenetex.github.io/ilXyr/" target="_blank" rel="noreferrer">Full experiment guide <span>↗</span></a>
            </div>
            <div className="evidence-list">
              {experiments.map((experiment) => (
                <a href={`https://cenetex.github.io/ilXyr/experiments/${experiment.id.toLowerCase()}.html`} target="_blank" rel="noreferrer" key={experiment.id}>
                  <span className="evidence-id">{experiment.id}</span>
                  <span className={`evidence-status ${experiment.tone}`}>{experiment.status}</span>
                  <strong>{experiment.title}</strong>
                  <p>{experiment.outcome}</p>
                  <span className="arrow">↗</span>
                </a>
              ))}
            </div>
          </section>
        </main>
      )}

      {view === "funding" && (
        <main className="inner-page">
          <section className="page-intro">
            <p className="eyebrow">Funding queue</p>
            <h1>Fund the experiment that will change your mind.</h1>
            <p>Only frozen, mechanically decidable contracts appear here. Forecast details stay sealed; only participation counts are shown.</p>
          </section>
          <div className="queue-summary">
            <div><span>Requested</span><strong>{formatCredits(totalRequested)} credits</strong></div>
            <div><span>Committed</span><strong>{formatCredits(totalCommitted)} credits</strong></div>
            <div><span>Open candidates</span><strong>{candidateProposals.length}</strong></div>
          </div>
          <section className="funding-list">
            {candidateProposals.map((proposal, index) => {
              const percent = Math.min(100, Math.round((proposal.committedCredits / proposal.computeCredits) * 100));
              return (
                <button key={proposal.id} onClick={() => openProposal(proposal)} className="funding-row">
                  <span className="queue-rank">0{index + 1}</span>
                  <div className="funding-main"><span className="family-label">{proposal.family} family</span><h2>{proposal.title}</h2><p>{proposal.hypothesis}</p></div>
                  <div className="funding-facts">
                    <div><span>Forecasts</span><strong>{proposal.forecastCount || "Open"}</strong></div>
                    <div><span>Beliefs</span><strong>Sealed</strong></div>
                    <div><span>Compute</span><strong>{formatCredits(proposal.computeCredits)}</strong></div>
                  </div>
                  <div className="funding-progress"><span><i style={{ width: `${percent}%` }} /></span><strong>{percent}% committed</strong></div>
                  <span className="row-arrow">↗</span>
                </button>
              );
            })}
          </section>
          <section className="empty-lane"><span>Blocked work stays out of the queue</span><p>Proposals with unresolved gates remain reviewable, but cannot collect forecasts or compute commitments.</p></section>
        </main>
      )}

      {view === "submit" && (
        <main className="inner-page submit-page">
          <section className="page-intro compact">
            <p className="eyebrow">New experiment</p>
            <h1>Make the question expensive to misunderstand.</h1>
            <p>The portal translates your answers into an ilXyr experiment contract. Nothing freezes until review is complete.</p>
          </section>
          <div className="submit-layout">
            <aside className="step-list" aria-label="Submission progress">
              {["Question", "Contract", "Resources", "Review"].map((label, index) => (
                <button key={label} className={submitStep === index ? "active" : submitStep > index ? "complete" : ""} onClick={() => setSubmitStep(index)}>
                  <span>{submitStep > index ? "✓" : `0${index + 1}`}</span><strong>{label}</strong>
                </button>
              ))}
              <div className="draft-note"><span>Draft state</span><p>Editable until you explicitly request funding candidacy.</p></div>
            </aside>
            <form className="proposal-form" onSubmit={submitProposal}>
              {submitStep === 0 && (
                <fieldset>
                  <legend><span>01</span> State the question</legend>
                  <p>Start with what the experiment could falsify—not what you hope it proves.</p>
                  <label>Short title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Q2.7 replay-constrained routing" /></label>
                  <label>Research question<textarea required rows={3} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="Can the proposed method beat the frozen baseline without crossing the replay boundary?" /></label>
                  <label>Falsifiable hypothesis<textarea required minLength={24} rows={4} value={form.hypothesis} onChange={(event) => setForm({ ...form, hypothesis: event.target.value })} placeholder="The method passes metric X at threshold Y across all declared seeds while..." /></label>
                  <div className="field-row">
                    <label>Model family<select value={form.family} onChange={(event) => setForm({ ...form, family: event.target.value })}><option value="zero">Zero</option><option value="solomon">Solomon</option></select></label>
                    <label>Novelty boundary<textarea required rows={2} value={form.novelty} onChange={(event) => setForm({ ...form, novelty: event.target.value })} placeholder="What will this decide that prior work does not?" /></label>
                  </div>
                </fieldset>
              )}
              {submitStep === 1 && (
                <fieldset>
                  <legend><span>02</span> Freeze the decision rule</legend>
                  <p>Use portable handles so the contract never depends on one machine&apos;s file paths.</p>
                  <label>Baseline handle<input required value={form.baseline} onChange={(event) => setForm({ ...form, baseline: event.target.value })} placeholder="model://ZERO.3" /></label>
                  <label>Dataset binding<input required value={form.dataset} onChange={(event) => setForm({ ...form, dataset: event.target.value })} placeholder="dataset://zero/q22r/frozen" /></label>
                  <div className="field-row thirds">
                    <label>Primary metric<input required value={form.primaryMetric} onChange={(event) => setForm({ ...form, primaryMetric: event.target.value })} placeholder="replay delta" /></label>
                    <label>Success threshold<input required type="number" step="any" value={form.successThreshold} onChange={(event) => setForm({ ...form, successThreshold: event.target.value })} placeholder="1.5" /></label>
                    <label>Seeds<input required value={form.seeds} onChange={(event) => setForm({ ...form, seeds: event.target.value })} placeholder="1, 2, 3" /></label>
                  </div>
                  <div className="contract-callout"><strong>Outcome contract</strong><p>The metric, operator, and threshold become immutable at candidacy. Reviewers should challenge them now.</p></div>
                </fieldset>
              )}
              {submitStep === 2 && (
                <fieldset>
                  <legend><span>03</span> Bound the resources</legend>
                  <p>Funding means compute credits in ilXyr. Monetary grants remain a separate sponsorship layer.</p>
                  <label>Maximum compute credits<input required type="number" min="1" value={form.computeCredits} onChange={(event) => setForm({ ...form, computeCredits: event.target.value })} placeholder="240" /></label>
                  <div className="field-row">
                    <label>Evidence authority<select value={form.evidenceLevel} onChange={(event) => setForm({ ...form, evidenceLevel: event.target.value })}><option value="exact_check">Exact check</option><option value="deterministic_replay">Deterministic replay</option><option value="corpus_proxy">Corpus proxy</option><option value="review">Review</option></select></label>
                    <label>Export policy<select value={form.exportPolicy} onChange={(event) => setForm({ ...form, exportPolicy: event.target.value })}><option value="artifacts">Artifacts</option><option value="metrics_only">Metrics only</option><option value="none">No export</option></select></label>
                  </div>
                  <div className="resource-rule"><span>Security boundary</span><p>Submission never executes uploaded content. Admission and execution remain isolated behind ilXyr policy.</p></div>
                </fieldset>
              )}
              {submitStep === 3 && (
                <fieldset>
                  <legend><span>04</span> Review the draft</legend>
                  <p>Submitting opens structured feedback. It does not freeze or fund the experiment.</p>
                  <div className="review-sheet">
                    <div><span>Question</span><strong>{form.title || "Untitled experiment"}</strong><p>{form.hypothesis || "Add a falsifiable hypothesis."}</p></div>
                    <div className="review-grid"><span>Family<strong>{form.family}</strong></span><span>Baseline<strong>{form.baseline}</strong></span><span>Metric<strong>{form.primaryMetric || "Missing"}</strong></span><span>Compute<strong>{form.computeCredits || "0"} credits</strong></span><span>Evidence<strong>{form.evidenceLevel.replaceAll("_", " ")}</strong></span><span>Seeds<strong>{form.seeds}</strong></span></div>
                  </div>
                  <label className="agreement"><input required type="checkbox" /><span>I understand that promotion freezes this contract and later changes require a successor proposal.</span></label>
                </fieldset>
              )}
              <div className="form-actions">
                <button type="button" className="text-button" disabled={submitStep === 0} onClick={() => setSubmitStep((step) => Math.max(0, step - 1))}>← Back</button>
                {submitStep < 3 ? <button type="button" className="primary-button" onClick={() => setSubmitStep((step) => Math.min(3, step + 1))}>Continue <span>→</span></button> : <button type="submit" className="primary-button" disabled={working}>{working ? "Submitting…" : "Open for review"} <span>↗</span></button>}
              </div>
            </form>
          </div>
        </main>
      )}

      {view === "workspace" && selected && (
        <main className="inner-page workspace-page">
          <button className="back-link" onClick={() => navigate(selected.status === "candidate" ? "funding" : "home")}>← Back to {selected.status === "candidate" ? "funding queue" : "registry"}</button>
          <section className="workspace-head">
            <div><div className="workspace-labels"><span className={`status-chip ${selected.status}`}>{statusLabel(selected.status)}</span><span>{selected.id}</span><span>{selected.family.toUpperCase()}</span></div><h1>{selected.title}</h1><p>{selected.summary}</p></div>
            <div className="readiness-ring" style={{ "--readiness": `${selected.readiness.score * 3.6}deg` } as React.CSSProperties}><span><strong>{selected.readiness.score}%</strong>ready</span></div>
          </section>

          <div className="workspace-layout">
            <div className="workspace-main">
              <section className="contract-panel">
                <div className="panel-heading"><p className="eyebrow">Experiment contract</p><span>{selected.status === "candidate" ? "Frozen" : "Draft"}</span></div>
                <div className="contract-question"><span>Hypothesis</span><h2>{selected.hypothesis}</h2></div>
                <div className="contract-grid"><div><span>Baseline</span><strong>{selected.baseline}</strong></div><div><span>Dataset</span><strong>{selected.datasets.join(", ")}</strong></div><div><span>Primary metric</span><strong>{selected.primaryMetric}</strong></div><div><span>Success threshold</span><strong>{selected.successThreshold}</strong></div><div><span>Seeds</span><strong>{selected.seeds.join(" · ")}</strong></div><div><span>Evidence</span><strong>{selected.evidenceLevel.replaceAll("_", " ")}</strong></div></div>
                <div className="novelty"><span>Novelty boundary</span><p>{selected.novelty}</p></div>
              </section>

              <section className="feedback-panel">
                <div className="panel-heading"><div><p className="eyebrow">Structured review</p><h2>{reviews.length} feedback {reviews.length === 1 ? "thread" : "threads"}</h2></div><span>{selected.blockingReviews} blocking</span></div>
                <div className="review-feed">
                  {reviews.length === 0 && <div className="no-feedback"><strong>No feedback yet.</strong><p>Challenge the methodology, security boundary, or novelty claim before this contract freezes.</p></div>}
                  {reviews.map((review) => (
                    <article className={`review-item ${review.severity} ${review.resolved ? "resolved" : ""}`} key={review.id}>
                      <div className="review-meta"><span className="review-avatar">{review.reviewer_name.slice(0, 1).toUpperCase()}</span><div><strong>{review.reviewer_name}</strong><span>{review.category} · {review.severity}{review.resolved ? " · resolved" : ""}</span></div><time>{new Date(review.created_at + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>
                      <p>{review.comment}</p>
                      {review.addressed && review.response && <p><strong>Owner response:</strong> {review.response}</p>}
                      {review.can_address && <button onClick={() => addressReview(review.id)} disabled={working}>Mark addressed</button>}
                      {review.can_resolve && <button onClick={() => resolveReview(review.id)} disabled={working}>Resolve feedback</button>}
                    </article>
                  ))}
                </div>
                {selected.status !== "candidate" && (
                  <form className="feedback-form" onSubmit={addReview}>
                    <div className="field-row"><label>Review lens<select value={reviewForm.category} onChange={(event) => setReviewForm({ ...reviewForm, category: event.target.value })}><option>Methodology</option><option>Engineering</option><option>Security</option><option>Prior art</option><option>Experiment design</option></select></label><label>Effect<select value={reviewForm.severity} onChange={(event) => setReviewForm({ ...reviewForm, severity: event.target.value })}><option value="advisory">Advisory</option><option value="blocking">Blocking</option><option value="endorsement">Endorsement</option></select></label></div>
                    <label>Feedback<textarea required rows={3} value={reviewForm.comment} onChange={(event) => setReviewForm({ ...reviewForm, comment: event.target.value })} placeholder="Tie the feedback to a concrete contract field or missing decision boundary." /></label>
                    <button className="secondary-button" disabled={working}>{working ? "Adding…" : "Add to review record"} <span>↗</span></button>
                  </form>
                )}
              </section>
            </div>

            <aside className="workspace-aside">
              <section className="readiness-panel">
                <p className="eyebrow">Readiness gates</p>
                <div className="check-list">{selected.readiness.checks.map((check) => <div key={check.label} className={check.pass ? "pass" : "fail"}><span>{check.pass ? "✓" : "!"}</span><strong>{check.label}</strong></div>)}</div>
                {selected.status === "review" && <button className="primary-button full" disabled={!selected.readiness.promotable || working} onClick={promote}>{working ? "Checking…" : "Freeze as funding candidate"} <span>↗</span></button>}
                {selected.status === "blocked" && <p className="blocked-note">This proposal depends on an external gate and cannot be promoted yet.</p>}
                {selected.status === "candidate" && <div className="frozen-note"><span>✓</span><p><strong>Contract frozen</strong>Forecasts and commitments are now bound to this exact version.</p></div>}
              </section>

              <section className="compute-panel"><p className="eyebrow">Compute request</p><div className="compute-number"><strong>{formatCredits(selected.committedCredits)}</strong><span>of {formatCredits(selected.computeCredits)} credits</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, (selected.committedCredits / selected.computeCredits) * 100)}%` }} /></div><div className="compute-meta"><span>{selected.forecastCount} forecasts</span><span>belief sealed</span></div></section>

              {selected.status === "candidate" && (
                <>
                  <form className="action-form" onSubmit={forecast}><p className="eyebrow">Submit a sealed forecast</p><label>Probability of success<div className="suffix-input"><input type="number" min="0" max="100" required value={forecastForm.probability} onChange={(event) => setForecastForm({ ...forecastForm, probability: event.target.value })} /><span>%</span></div></label><label>Stake<input type="number" min="1" required value={forecastForm.stake} onChange={(event) => setForecastForm({ ...forecastForm, stake: event.target.value })} /></label><label>Rationale<textarea rows={2} required value={forecastForm.rationale} onChange={(event) => setForecastForm({ ...forecastForm, rationale: event.target.value })} placeholder="What evidence sets this probability?" /></label><button className="secondary-button" disabled={working}>Record forecast</button></form>
                  <form className="action-form accent" onSubmit={fund}><p className="eyebrow">Commit compute</p><label>Compute credits<input type="number" min="1" required value={fundingForm.computeCredits} onChange={(event) => setFundingForm({ ...fundingForm, computeCredits: event.target.value })} /></label><label>Rationale<textarea rows={2} required value={fundingForm.rationale} onChange={(event) => setFundingForm({ ...fundingForm, rationale: event.target.value })} placeholder="Why is this uncertainty worth resolving?" /></label><button className="primary-button full" disabled={working}>Commit credits <span>↗</span></button></form>
                </>
              )}
            </aside>
          </div>
        </main>
      )}

      <footer><div><span className="wordmark-glyph">iX</span><p><strong>ilXyr</strong><br />Fund uncertainty. Settle in evidence.</p></div><p>Negative results count. Promotion is never inferred.</p><a href="https://github.com/cenetex/ilXyr" target="_blank" rel="noreferrer">Protocol & source ↗</a></footer>
    </div>
  );
}
