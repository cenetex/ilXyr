# Academic scope and publication boundary

This document states what the current repository demonstrates, what it does not demonstrate, and
what evidence is still required before broader academic claims are made.

## Supported claim

The V1 reference implementation demonstrates that, in a local single-writer workspace, typed
research contributions can be compiled into an immutable experiment contract; forecasts, funding,
role separation, and execution policy can be checked before a run; and a completed run can be
resolved, scored, and recorded in a hash-linked evidence history. The test suite and the toy
end-to-end lifecycle evaluate this implementation claim.

This is a systems claim about protocol behavior. It is not evidence that using ilxyr improves the
truth, novelty, productivity, or replication rate of research compared with another workflow.

## Terminology

- **Prospectively frozen** means the experiment contract, analysis rules, and outcomes became
  immutable in ilxyr before execution.
- **Externally preregistered** means the prospectively frozen package also has a matching receipt
  from the external registry declared in the experiment. A Git commit or local ledger event alone
  is not described as an external preregistration.
- **Deterministic replay** means the declared replay process reproduced the scoped recorded result.
  It does not imply that every dependency is permanently available.
- **Multi-seed robustness** means the same research program passed its frozen rule across declared
  seeds. It is not external reproduction by a separate team.
- **Local integrity check** means object digests and hash-chain links verify relative to the ledger
  being inspected. The single-writer ledger has no external hash anchor and does not resist a
  privileged administrator rewriting the full history.

These terms keep protocol state separate from stronger open-science claims.

## Current evidence boundary

| Evidence | What it supports | Open limitation |
| --- | --- | --- |
| Rust, schema, and CLI tests | Core protocol behavior and failure handling | No comparative study of research outcomes |
| Toy promoted lifecycle | End-to-end wiring, settlement, and verification | Deliberately tautological; not a scientific benchmark |
| EXP-001 to EXP-004 | Scoped Zero method results, including preserved no-go paths | Scientific artifacts live partly in the upstream Zero repository |
| EXP-005 | Frozen three-seed family rule passed upstream | Local ilxyr import is pending; same-program seeds are not external reproduction |
| EXP-006 | Public Holo implementation ran on one public-corpus CPU proxy | Not the private-corpus/MPS result; one seed; checkpoints are not all publicly archived |
| NSRL p10m pilot | Exact custody, replay, gate failures, and preserved negative target-margin and canonical-NLL guard results | Source commit is unpublished, weights lack a licence, and independent evidence is unopened |

## Relationship to existing systems

ilxyr combines ideas that already exist in research and software infrastructure: external
registrations such as OSF, experiment tracking such as MLflow, RO-Crate and PROV-O metadata,
in-toto/SLSA attestations, content-addressed storage, proper scoring rules, and continuous-integration
gates. The individual primitives are not claimed as novel. A future paper must compare ilxyr with
the relevant systems and defend novelty in the integration, policy semantics, or measured outcome.

## Evidence required for a broader paper

Before claiming that ilxyr improves research quality or reproducibility, the project should:

1. state a narrow falsifiable systems or research-method claim;
2. compare against relevant workflow and provenance baselines;
3. measure runtime, storage, operational overhead, recovery behavior, and failure detection;
4. archive a tagged software release and complete evidence package under persistent identifiers;
5. publish data, model, and artifact licenses plus a reproducible environment specification;
6. use an authenticated external registration for any experiment described as preregistered; and
7. obtain a result reproduction by a team outside the original research program.

Until those conditions are met, ilxyr should be described as a tested research-software prototype
with scoped experiment records, not as proof that autonomous research governance improves science.
