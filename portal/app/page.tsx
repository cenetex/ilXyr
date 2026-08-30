const repository = "https://github.com/cenetex/ilXyr";
const guide = "https://cenetex.github.io/ilXyr";

const cliGroups = [
  {
    name: "proposal",
    calls: [
      "proposal-submit <workspace> <proposal.json>",
      "proposal-review <workspace> <review.json>",
      "proposal-freeze <workspace> <proposal-id>",
      "proposal-package <workspace> <proposal-id> <contributions.json> <experiment.json>",
      "proposal-compile <workspace> <proposal-id>",
      "proposal-status <workspace> <proposal-id>",
    ],
  },
  {
    name: "experiment",
    calls: [
      "contribute <workspace> <contribution.json>",
      "compile <workspace> <experiment.json>",
      "forecast <workspace> <forecast.json>",
      "fund <workspace> <funding.json>",
      "admit <workspace> <experiment-id>",
      "run <workspace> <experiment-id> --execute",
      "status <workspace> <experiment-id>",
      "export-evidence <workspace> <evidence-ref> <native|ro-crate|in-toto|mlflow>",
      "verify <workspace>",
    ],
  },
  {
    name: "family",
    calls: [
      "family freeze <workspace> <family-manifest.json>",
      "family check <workspace> <family-manifest.json>",
      "family run <workspace> <family-manifest.json> --execute",
      "family settle <workspace> <family-manifest.json>",
    ],
  },
  {
    name: "attestation and policy",
    calls: [
      "trust-attestation-key <workspace> <service-id> <key-id> <public-key-base64>",
      "attest <workspace> <run-ref> <dsse-envelope.json>",
      "trust-key <workspace> <human-id> <key-id> <public-key-base64>",
      "budget-payload <budget.json>",
      "budget-register <workspace> <signed-budget.json>",
      "allocate <workspace> <budget-id> <experiment-id>...",
      "authorize <workspace> <budget-id> <experiment-id>",
      "run-auto <workspace> <budget-id> <experiment-id>",
    ],
  },
  {
    name: "external and model inputs",
    calls: [
      "preregister-package <workspace> <experiment-id>",
      "preregister-record <workspace> <receipt.json>",
      "shared-task-register <workspace> <shared-task.json>",
      "huggingface-import <workspace> <repo-id> [commit-sha]",
      "huggingface-register <workspace> <model.json>",
      "huggingface-show <workspace> <model-ref>",
      "nsrl-register <workspace> <registration.json> <source-root> --execute",
      "nsrl-show <workspace> <model-ref>",
      "nsrl-gate-record <workspace> <gate-evidence.json> <evidence-root>",
      "nsrl-status <workspace> <model-ref>",
      "retro <workspace> <retro-registration.json> --execute",
    ],
  },
  {
    name: "evidence graph and research loop",
    calls: [
      "tournament-register <workspace> <tournament.json>",
      "tournament-settle <workspace> <tournament-id>",
      "loop-cycle <workspace> <budget-id> <cycle.json>",
      "sandbox <workspace> <budget-id> <sandbox-spec.json>",
      "certify <workspace> <certificate.json>",
      "claim-register <workspace> <claim.json>",
      "edge-record <workspace> <edge.json>",
      "replication-register <workspace> <contract.json>",
      "replication-allocate <workspace> <budget-id> <contract-ref>",
      "replication-settle <workspace> <contract-ref> <evidence-ref>",
      "claim-status <workspace> <claim-id>",
      "claim-support <workspace> <claim-id>",
      "program-status <workspace> [paper-contract.json]",
      "calibration <workspace> <actor-handle>",
    ],
  },
];

const experiments = [
  ["EXP-001", "Q2.3 local replay guard", "no-go"],
  ["EXP-002", "Q2.4 cumulative replay guard", "no-go"],
  ["EXP-003", "Q2.5 deterministic backtracking", "no-go"],
  ["EXP-004", "Q2.6 replay-tangent projection", "go"],
  ["EXP-005", "Q2.6 family replication", "verified upstream; local import pending"],
  ["EXP-006", "Holo HRR attention at T=512", "settled proxy result"],
  ["EXP-007", "Zero to Solomon Q22 bridge", "go"],
];

export default function Home() {
  return (
    <main>
      <h1>ilXyr</h1>
      <p>Intelligent Lab eXperiment Yielding Research.</p>
      <p>
        A research protocol, ledger, and command line tool. This website is an index. It is not an
        experiment executor and it does not authorize compute.
      </p>

      <h2>Status</h2>
      <ul>
        <li>local executor: available for public-weight experiments</li>
        <li>general cloud executor: roadmap</li>
        <li>paid cloud experiment work: not launched</li>
        <li>protected-weight execution: not available</li>
        <li>mutable cloud checkouts: not accepted as reproducible jobs</li>
      </ul>

      <h2>HTTP API</h2>
      <p>Read calls return JSON. Write calls require an authenticated site identity.</p>
      <ul>
        <li><code>GET /api/proposals</code> — list proposals</li>
        <li><code>GET /api/proposals?id=PROP-ID</code> — read one proposal and its reviews</li>
        <li><code>POST /api/proposals</code> with <code>action=create</code> — create a proposal draft</li>
        <li><code>POST /api/proposals</code> with <code>action=review</code> — add independent review</li>
        <li><code>POST /api/proposals</code> with <code>action=address</code> — address review feedback</li>
        <li><code>POST /api/proposals</code> with <code>action=resolve</code> — resolve review feedback</li>
        <li><code>POST /api/proposals</code> with <code>action=promote</code> — freeze an eligible funding candidate</li>
        <li><code>POST /api/proposals</code> with <code>action=forecast</code> — record a sealed forecast</li>
        <li><code>POST /api/proposals</code> with <code>action=fund</code> — record a compute-credit commitment</li>
      </ul>
      <p>
        The portal API is a collaboration surface. Its database is not the authoritative ilXyr
        ledger. There is no HTTP cloud-launch route.
      </p>

      <h2>Command line API</h2>
      <p>Prefix each call with <code>ilxyr</code>.</p>
      {cliGroups.map((group) => (
        <section key={group.name}>
          <h3>{group.name}</h3>
          <ul>
            {group.calls.map((call) => <li key={call}><code>{call}</code></li>)}
          </ul>
        </section>
      ))}

      <h2>Cloud executor protocol (not implemented)</h2>
      <p>A cloud job will be admitted only as an immutable package bound by digest.</p>
      <ul>
        <li>one experiment ID and one compiled experiment digest</li>
        <li>exact source commits and source archive digests</li>
        <li>exact executable, oracle, harness, data, and model digests</li>
        <li>provider, region, machine type, machine image, storage, and architecture</li>
        <li>time and cost ceilings, watchdog behavior, and shutdown policy</li>
        <li>target order, concurrency, allocation policy, and failure policy</li>
        <li>network and export policy</li>
        <li>write-once launch, identity, status, result, and attestation receipts</li>
      </ul>
      <p>
        A normal frontier and a presized-memory audit must use separate experiment IDs, packages,
        budgets, and result records. A package is not an authorization to spend.
      </p>

      <h2>Protocol documents</h2>
      <ul>
        <li><a href={`${repository}/blob/main/docs/PROTOCOL.md`}>research protocol v1</a></li>
        <li><a href={`${repository}/blob/main/docs/PROGRAM.md`}>research program</a></li>
        <li><a href={`${repository}/blob/main/docs/ROADMAP.md`}>roadmap</a></li>
        <li><a href={`${repository}/blob/main/docs/decisions/0006-digest-bound-cloud-executor.md`}>digest-bound cloud executor decision</a></li>
        <li><a href={`${repository}/tree/main/schemas`}>JSON schemas</a></li>
        <li><a href={`${repository}/blob/main/docs/SECURITY.md`}>security boundary</a></li>
        <li><a href={`${repository}/blob/main/docs/INTEROPERABILITY.md`}>interoperability and attestations</a></li>
      </ul>

      <h2>Experimental protocols and results</h2>
      <ul>
        {experiments.map(([id, title, status]) => (
          <li key={id}>
            <a href={`${guide}/experiments/${id.toLowerCase()}.html`}>{id}: {title}</a> — {status}
          </li>
        ))}
        <li><a href={`${repository}/blob/main/docs/experiments/NSRL-P10M-PILOT.md`}>NSRL p10m managed pilot</a> — continue-experimental</li>
        <li><a href={`${repository}/blob/main/docs/experiments/WEIGHT-MULTIPLICITY-PHASE0-DECISION.md`}>weight multiplicity Phase 0</a> — diagnostic record</li>
      </ul>

      <h2>Source</h2>
      <ul>
        <li><a href={repository}>github.com/cenetex/ilXyr</a></li>
        <li><a href={guide}>published experiment guide</a></li>
      </ul>
    </main>
  );
}
