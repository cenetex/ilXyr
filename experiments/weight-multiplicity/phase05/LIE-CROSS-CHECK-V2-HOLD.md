# LiE cross-check Version 2 — Hold on unresolved case

## Decision

Version 2 corrected the type and coordinate mappings from Version 1. It then
recorded 207 consecutive exact agreements before halting on one unresolved B6
case. The resource frontier did not run.

The unresolved query was:

- Zero type: B6;
- highest weight: `[2,0,4,0,0,2]`;
- exact representation dimension: `998098101000`;
- target: `[0,0,0,0,0,0]` at depth 101;
- LiE query type: C6;
- LiE result: `56073120` in about 5.8 ms; and
- Zero fresh-query result: no response within the frozen 60-second witness
  allowance.

This is not an integer disagreement. It is still Hold because an unanswered
side cannot establish correctness.

## Selection defect

The Version 2 generator selected representations at minimum highest-weight
heights 1, 2, 4, and 8. That rule imported a nearly one-trillion-dimensional,
depth-101 B6 query into a sample whose purpose is correctness, not resource
frontier discovery. The approved LiE terms require at least 12 cases per type,
nontrivial depths and multiplicity strata, all E7/E8 fundamentals, and the
named small exceptional cases. They do not require the witness to duplicate
the extreme resource surface.

Increasing the witness timeout would blur the separate one-second frontier
question and could turn a small correctness sample into another unbounded
cost study. Version 2 therefore remains immutable Hold.

## Version 3 correction

Version 3 must keep the same type/coordinate mappings and the same 16-case
count per type, but select the non-mandatory cases from the smallest available
representations by exact dimension. It must prefer positive target depths no
greater than 24. The all-fundamental E7/E8 requirement remains unchanged and
uses the shallowest generated positive-depth target for each fundamental.

Only a complete Version 3 pass clears the independent witness.
