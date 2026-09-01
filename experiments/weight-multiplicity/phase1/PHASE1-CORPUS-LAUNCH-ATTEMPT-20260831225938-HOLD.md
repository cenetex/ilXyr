# Phase 1 corpus launch attempt 20260831225938 — Hold

Date: 2026-08-31

Status: Hold before budget freeze and before corpus generation

The first Phase 1 corpus instance exposed a finite-support defect in the
yield pilot. The pilot required 512 unique candidate queries for each
exceptional type and stratum. The `G2` zero-multiplicity proposal space was
smaller than that request, so the JavaScript controller remained in candidate
construction and never reached the oracle batch.

Evidence:

- package SHA-256:
  `3b2f0ee3795e5ee0ee7af3c7ed86bc79a0c8755c26dfe963fc66c81ca08c746b`;
- IlXYr commit: `9b8ea316e5e764e8740635e94b342aad411dff36`;
- instance: `i-0b3f9208acb0cc465`, one AWS `c6i.4xlarge` in `us-east-1`;
- launch: 2026-09-01 00:48:42 UTC;
- manual termination: 2026-09-01 00:54:18 UTC;
- estimated EC2 cost at the frozen $0.68 hourly rate: $0.06347;
- AWS system and instance health checks were both `ok`;
- CPU telemetry was about 6.7%, consistent with one busy controller core on
  the 16-vCPU machine;
- no frozen budget, corpus partition, corpus manifest, or model artifact was
  written; and
- the instance reached `terminated` state.

The oracle builds were valid. The two independent LiE executables matched
each other and the earlier preflight executable hash, and Zero passed its
self-test from the pinned source commit. The defect was in candidate
construction, not in either oracle.

Correction:

1. pilot sampling is bounded and permits repeated diagnostic draws, while
   corpus records remain globally exact-query de-duplicated;
2. the pilot reports both total draws and unique query count;
3. a hard candidate-draw limit converts any future finite-support mistake to
   an explicit Hold; and
4. zero-label candidates use a broader root-composition shell outside the
   representation depth, preventing the corpus zero stratum from inheriting
   the same finite-support defect.

The failed package must not be relaunched. A corrected package requires a new
digest, free preflight, and explicit launch approval. Model training and model
evaluation remain unauthorized.
