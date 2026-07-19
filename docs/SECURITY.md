# Security model

## Program scope

Every model in the current program (`docs/PROGRAM.md`) is a public-weight micromodel trained
locally; there are no protected weights to defend today. The load-bearing v1 controls are the
untrusted-reasoner rule, the shell-free executor, and ledger integrity. The protected-weight
lane below is fail-closed protocol design; its attested runtime is deferred until needed.

## Central rule

Agents are untrusted reasoners. They may propose hypotheses, code, forecasts, and funding actions,
but they do not hold ambient cloud credentials and cannot authorize execution. A deterministic
capability broker evaluates immutable policy before an executor receives narrowly scoped access.

## Trust boundaries

- **Untrusted:** human-authored experiment code, model-authored content, prompts, datasets,
  arbitrary container payloads, and forecast rationales.
- **Policy-enforced:** schema validation, experiment compilation, admission, identity binding,
  cost limits, output policy, and ledger append.
- **Protected:** credentials, model-weight decryption keys, raw weight bytes, signing keys, billing
  authority, and ledger administration.

Model output is data. No model-produced text is interpreted as a capability grant.

## Autonomous operation

V1 removes the human from policy-conforming execution without weakening the central rule
(ADR 0003): model actors may propose, review, and forecast, while the deterministic allocator and
execution broker retain authority under immutable policy. The human authors policy and audits the
ledger.

Per-run acknowledgement (`--execute`) becomes a threshold: allowlisted executables inside the
signed epoch budget proceed unattended. A new executable, an open-network request beyond
policy, or a crossed cumulative spend line requires explicit human acknowledgement. Policy
objects, directional baseline rules, allowlists, thresholds, and the credit mint remain
human-signed.

The local trust root is explicit: `trust-key` records an immutable Ed25519 public key and its human
owner in the hash-linked ledger. Budget registration verifies the signature over canonical JSON
with the signature field omitted and rejects signer/key-owner mismatch. The private key remains
outside ilxyr. Actor identity and the initial human key-install action are still local,
self-declared controls—not authenticated principals.

`run-auto` requires a budget allocation and proceeds only when the signed executable, exact
argument vector, network, per-run, per-epoch, total-credit, and cumulative-spend policies pass.
`authorize` exposes the same decision without running. An execution-start record without a
terminal run is treated as ambiguous and cannot be repeated unattended. The manual
`run --execute` path remains an explicit acknowledgement for boundary cases and local recovery; it
is never invoked by the autonomous path.

## Weight protection (deferred lane)

Experiment objects carry opaque handles such as `weight://registry/model/version`; paths, bucket
coordinates, and decryption material are rejected at the protocol boundary. Three lanes exist:

| Lane | Code | Network | Export | V1 executor |
| --- | --- | --- | --- | --- |
| Public | arbitrary or approved | policy-selected | artifacts allowed | local supports only arbitrary/open/artifacts |
| Internal | approved image only | denied | policy-selected | unsupported |
| Restricted | approved image only | denied | metrics only or none | unsupported |

A production protected-weight adapter should:

1. resolve the handle only inside an attested execution boundary;
2. issue a single-run, non-exportable decryption capability;
3. mount weights read-only without exposing their backing location;
4. deny egress and interactive access;
5. inspect and sign allowed outputs;
6. destroy plaintext material and ephemeral keys at teardown; and
7. emit attestation, image digest, policy digest, and output manifest into the evidence bundle.

Strong threat models require confidential VMs or enclaves with remote attestation; a container
boundary is insufficient against a hostile node administrator or kernel.

## V1 local executor guarantees

The local adapter:

- accepts only `weight_class=public`, `code_policy=arbitrary`, and
  `export_policy=artifacts`;
- never invokes a shell;
- requires an absolute executable path;
- clears the inherited environment;
- provides only experiment and run IDs to the child;
- closes stdin;
- kills the direct child when its timeout expires; and
- drains output while retaining at most 1 MiB per stream.

It does **not** enforce network isolation, filesystem isolation, CPU or memory quotas, syscall
filtering, multi-tenant separation, image provenance, or secretless host access. Admission therefore
rejects protected weights, approved-image-only code, restricted export policies, and any local run
without `network=open`; accepting those declarations would otherwise make a false security
promise. The executor repeats these checks immediately before process creation, independent of the
persisted admission decision.

The timeout is not process-tree containment: a hostile executable can spawn descendants, and a
descendant retaining an output pipe can prevent clean collection after the direct child is killed.
Likewise, the absolute executable path is frozen in the contract but its file contents are not
digest-pinned by V1. `--execute` or a matching signed-policy authorization is therefore permission
to run that public-weight command on the local host, not an attestation that arbitrary code is
sandboxed or reproducible. Only cooperative, locally trusted-to-terminate harnesses are suitable
for this adapter.

## Production controls required before any multi-tenant service

- OIDC workload identity with no long-lived provider keys.
- Tenant-aware authorization on every object, event, forecast, and funding action.
- Signed artifacts and executor attestations.
- Quotas, cost ceilings, rate limits, and denial-of-wallet protection.
- Isolated build and execution planes; no build credentials inside run workloads.
- Software supply-chain policy: pinned images, SBOMs, provenance, and vulnerability gates.
- Append-only replicated ledger with concurrency control and disaster recovery.
- Redaction and data-loss prevention before logs or metrics leave protected runs.
- Audit export to an independently administered security account or project.

## Reporting

Do not include credentials, sensitive datasets, private weight locations, or exploitable deployment
details in public issues. Use the repository owner's private security channel when one is published.
