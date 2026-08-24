# Interoperability

ilxyr is a research control plane. It decides what may run, freezes what an outcome means before
execution, allocates compute, settles forecasts, and records the resulting evidence. It should
integrate with systems that are already authoritative for experiment tracking, registration,
preservation, and software-supply-chain attestations rather than reproduce them.

The north star is:

> Every public claim is a prospectively risked, independently replicated, cold-replayable node on
> a machine-queryable evidence graph.

The protocol now represents this as a derived eligibility invariant. A claim becomes
`spine_eligible` only when it is bound to one immutable shared-task contract and its ledger state
contains a prospectively risked path, a cold-replayable path, and a successful independent
replication. Private claims may omit the binding and remain queryable, but cannot enter the
promoted spine. Eligibility is not publication automation and is not a truth score.

## Boundary map

| Adjacent system | Its authority | ilxyr's authority | Integration rule |
| --- | --- | --- | --- |
| MLflow | Run metadata, metrics, parameters, and artifacts | Which experiment is admitted and what its outcomes mean | Mirror a completed ilxyr evidence bundle into an MLflow run. An MLflow run never proves admission or promotion. |
| OSF Registrations | Frozen public or embargoed registration and preservation record | Executable preregistration, policy gates, allocation, and settlement | Package a frozen ilxyr plan for registration, then record the external registration identifier additively. Never mutate a compiled plan to match a later registration. |
| RO-Crate and W3C PROV | Portable discovery metadata and provenance vocabulary | Native protocol semantics and ledger verification | Export a verified native bundle as JSON-LD. Preserve native identifiers and authority fields instead of flattening them into generic metadata. |
| in-toto and SLSA ecosystems | Attestation envelope, signing, verification, and supply-chain policy | Evidence predicate and the relation between plan, run, and result | Emit an in-toto Statement predicate. Signing and SLSA provenance generation belong to an executor or attestation service. |
| Hugging Face Hub | Model repository, commit resolution, file identities, model card metadata, and access policy | Which exact model/weight handle is frozen into an ilXyr actor or experiment | Resolve a public repository to a full commit and record its file identities. Never bind evidence to mutable `main`. |
| Research agents | Proposal, critique, implementation, and forecast generation | Constraints, funding, execution authority, settlement, and audit | Agents submit the same typed objects as humans and services. No agent receives a side door around admission or signed policy. |

The external specifications remain authoritative:

- [MLflow REST API](https://mlflow.org/docs/latest/api_reference/rest-api.html)
- [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/introduction.html)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)
- [OSF API](https://developer.osf.io/) and
  [OSF Registrations](https://help.osf.io/article/330-welcome-to-registrations)
- [Hugging Face Hub download and revision model](https://huggingface.co/docs/huggingface_hub/guides/download)

## Implemented Hugging Face model import

`huggingface-import` resolves a public, ungated Hub model to an immutable commit and records a
strict `ilxyr.huggingface_model.v1` object. The object carries a `model://` handle for model actors,
a `weight://` handle for experiment specs, file sizes and Git blob IDs, and LFS SHA-256 digests
when the Hub supplies them. Importing the same resolved object is idempotent.

The adapter may use `HF_TOKEN` for the metadata request but never persists it. V1 fails closed for
private, gated, or disabled repositories because the local executor cannot enforce protected-weight
controls. Import establishes artifact identity only: it does not download weights, invoke the
model, accept model-card claims as evidence, or attest which revision a hosted provider executed.
See `docs/HUGGINGFACE.md` for the concrete leCore Qwen3.5 binding.

## Implemented evidence exports

`export-evidence` first verifies the complete local object store and hash-linked ledger. It then
requires that the requested object is the artifact of an `EvidenceRecorded` event and derives
labels from ledger facts:

- `forecast_risked` is true only for promoted evidence with at least one forecast and a settlement
  for every included forecast;
- `source_attested` is true only when the run contains a source snapshot;
- `cold_replayable` is true only for retro evidence whose successful run attests exactly the
  frozen source and whose completed registration is grounded and explicitly not forecast-risked.

It emits four read-only views:

```bash
cargo run -p ilxyr-cli -- export-evidence . EVIDENCE_REF native
cargo run -p ilxyr-cli -- export-evidence . EVIDENCE_REF ro-crate
cargo run -p ilxyr-cli -- export-evidence . EVIDENCE_REF in-toto
cargo run -p ilxyr-cli -- export-evidence . EVIDENCE_REF mlflow
```

### Native bundle

The `ilxyr.evidence_bundle.v1` object is the lossless interchange form. It carries the evidence,
run, prospective compiled experiment or retro plan, forecasts, settlements, certificates, the
recording event hash, and the ledger head observed at export. Its strict Draft 2020-12 schema is
`schemas/evidence-bundle.schema.json`.

The ledger head is an export observation, not a promise that the workspace will never grow. A
consumer verifies object digests and the event chain in the source workspace before trusting it;
a later detached-bundle verifier and signature profile remain roadmap work.

### RO-Crate and PROV-O

The RO-Crate 1.3 JSON-LD view maps:

- the crate and evidence to `Dataset` / `prov:Entity`;
- the compiled experiment or retro plan to `CreativeWork` / `prov:Plan`;
- the run and forecast settlements to `CreateAction` / `prov:Activity`;
- provenance artifacts to `MediaObject` / `prov:Entity`;
- human actors to `Person`, and model/service actors to `SoftwareApplication`.

ilxyr-specific authority, lane, risk, replay, and event-hash fields remain in the
`https://ilxyr.dev/ns#` namespace. The export is a discovery and preservation view; the native
bundle remains the normative ilxyr record.

### in-toto

The in-toto view is a Statement v1 whose subject digest is the content-addressed evidence object
and whose custom predicate is the complete native bundle. It is deliberately an unsigned
statement. Exporting JSON is not equivalent to:

- signing a DSSE envelope;
- remotely attesting executor identity;
- generating SLSA build provenance; or
- satisfying a consumer's supply-chain policy.

The first two remain distinct paths. `export-evidence ... in-toto` produces the unsigned
preservation statement above. Separately, ilxyr can ingest a signed executor-produced statement as
described below. SLSA provenance generation and supply-chain policy assessment remain adapter or
consumer responsibilities.

### MLflow

The MLflow view is a bridge manifest, not an API side effect. It contains:

- the REST endpoints for creating a run and logging a batch;
- a required caller-supplied MLflow `experiment_id`;
- templates for the create and log-batch requests;
- evidence metrics and ilxyr state as namespaced metrics, parameters, and tags; and
- the complete native bundle as an `ilxyr/evidence-bundle.json` artifact with its SHA-256 digest.

An adapter may execute this manifest against an authenticated MLflow deployment. Failure to mirror
a run must not rewrite ilxyr evidence or turn a completed protocol transaction into a failed one.
The adapter should record delivery state separately and retry idempotently.

## Implemented executable registration boundary

An experiment can freeze this requirement:

```json
{
  "preregistration": {
    "provider": "osf",
    "visibility": "public"
  }
}
```

`preregister-package` records a deterministic package containing the full compiled experiment.
`preregister-record` then accepts an external receipt only when it names that exact package,
matches the provider/visibility requirement, uses a registration identifier not bound to another
experiment, and arrives before execution. Admission exposes the check as
`external_preregistration` and fails until it passes.

For OSF, a public receipt requires a DOI while an embargoed receipt must not claim one. The current
implementation deliberately performs no OSF network request: an authorized user or future adapter
is responsible for creating/approving the frozen registration and accurately reporting its ID.
The adapter must keep credentials outside protocol objects and should later compare downloadable
remote content to the local package digest.

## Implemented signed attestation ingestion

`trust-attestation-key` binds an immutable Ed25519 public key to a service executor.
`attest` verifies a DSSE envelope over the exact decoded payload bytes before parsing that same
payload as an in-toto Statement v1. The statement must include the ledgered run digest as a
subject. The SLSA provenance v1 profile also requires:

- `buildDefinition.externalParameters.ilxyrRunRef` equal to that run reference; and
- `runDetails.builder.id` equal to the executor identity bound to a verified key.

The native executor predicate applies equivalent `runRef` and executor checks. Accepted envelopes,
parsed statements, and verified key IDs are immutable additive records included in the evidence
bundle and RO-Crate view. This is signature/binding verification, not a computed authority level,
SLSA level, hardware-attestation result, or transparency-log proof.

## Implemented claim graph and replication settlement

Claim nodes attach accountable statements to ledgered evidence. Typed edges preserve support,
contradiction, replication, dependency, supersession, subsumption, and derivation without
overwriting either side. A spine candidate names the exact ledgered shared-task artifact, and each
attached evidence object must prove the same binding through its compiled experiment or frozen
retro plan and evidence authority. A replication contract is frozen before execution and binds its
target, reference, future experiment, the same task/eval-set contract, and
capability/equivalence criteria.

The signed epoch reserve is now a distinct `replication` allocation kind. Its allocator still
requires forecasts, role separation, executable policy, admission, and unattended authorization.
Settlement verifies event order and experiment identity, evaluates the frozen tolerance/agreement
checks, requires forward forecast risk, and records the mechanical independence dimensions. A
successful settlement appends a `replicates` edge. The shared-task artifact is the one permitted
common provenance anchor; any other shared provenance artifact still defeats the mechanical
independence check.

`claim-status` returns the adjacent graph and the derived `shared_task_bound`,
`prospectively_risked`, `cold_replayable`, `independent_replications`, and `spine_eligible` fields.
Model agents use the same claim, edge, contract, forecast, and cycle objects as human/service
actors; they cannot grant eligibility or bypass signed allocation policy.

## Next integration slices

- Graph traversal with weakest-link authority composition over `depends_on`.
- Demotion challenge windows and subsumption/archive policy.
- Authenticated multi-writer query/service APIs and an agent scheduler.
- A real Zero→Solomon shared-task replication using the implemented generic settlement path.

## Conformance tests to add with each adapter

Every adapter should ship a golden fixture, strict schema validation, an idempotency test, a
tamper/rejection test, and a round-trip or digest-binding test. Network integration tests should
run against disposable local services where possible; credentials and availability of third-party
services must not be required for core protocol tests.
