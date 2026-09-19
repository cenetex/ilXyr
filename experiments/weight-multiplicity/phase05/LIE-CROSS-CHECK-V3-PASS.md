# LiE cross-check Version 3 — Pass

Version 3 passed all 496 frozen cases: 16 exact agreements for each of the 31
supported types and no disagreement, timeout, process error, or parse error.
It includes all seven E7 and all eight E8 fundamental representations.

Observed multiplicities covered every program stratum:

- `1`: 230 cases;
- `2–7`: 179 cases;
- `8–31`: 65 cases; and
- `32+`: 22 cases.

The largest checked multiplicity was 265. A1 is multiplicity-free by nature;
the higher strata are distributed across the other types rather than forced
artificially into every per-type sample.

Evidence identities:

- case manifest SHA-256:
  `644b5a7b787767ab596cdc641f500982ad3f97d1ccac2f784793eec335b91a00`;
- result SHA-256:
  `36af25195bf77ece9be430e8f442b54500ec981267b7bae817de5b6e10d4bdee`;
- Zero executable SHA-256:
  `cb57c268c58a4ed16df5dc2ca08edd8d5a249028308395e15195a2852999bb46`;
  and
- temporary LiE executable SHA-256:
  `aaf91a06cb8012f27d1f7baf9e2d753726fe386c79e68ce88efb9abb01d4cd11`.

The independent-correctness Hold is cleared. This Pass authorizes only the
already-approved Phase 0.5 resource-frontier run. It does not authorize corpus
generation or training.
