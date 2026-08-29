# ADR 0005: ilXyr stewardship of the NSRL p10m model

- Status: accepted for a managed pilot
- Date: 2026-08-28

## Context

NSRL has a small integer language model with a reported 9,317,632 parameters, an 8,192-token
vocabulary, a 256-token context, and deterministic training and generation. Its production
artifact is about 13 MB and its optional optimizer state is about 71 MB. These values are intake
claims until ilXyr verifies them against pinned source and artifacts.

The model is a useful research substrate because integer execution, restartable training, and
byte-identical replay make its behavior unusually inspectable. It is not ready for a capability
claim. The latest reported checkpoint improved held-out likelihood and target rank but still had
severe free-generation collapse: a high self-loop rate and only two distinct greedy tokens across
the prompt panel. No checkpoint has passed an open-generation quality gate.

ilXyr already owns experiment policy, budgets, evidence, and promotion decisions for the Zero and
Solomon families. NSRL should remain the authority for model implementation. Moving experiment
policy back into NSRL would split the evidence boundary and make negative results easier to lose.

## Decision

ilXyr accepts operational stewardship of NSRL p10m for a 30-day managed pilot. The asset status is
`experimental`. Acceptance is permission to register and evaluate the model, not a promotion,
release approval, production deployment, public capability claim, or paid scaling decision.

### Ownership boundary

ilXyr owns:

- content-addressed registration of source commits, models, tokenizers, and optimizer states;
- experiment admission, signed compute budgets, scheduling, and execution authority;
- frozen public and hidden evaluation contracts;
- evidence settlement, checkpoint comparison, and lifecycle status;
- promotion, demotion, retirement, and release decisions; and
- experiments that cross the Zero and Solomon families.

NSRL owns:

- the integer architecture, kernels, numeric contracts, tokenizer, and artifact formats;
- training, inference, inspection, generation, and evaluation implementations;
- backward-compatible artifact loading;
- correctness, replay, and serialization tests; and
- stable machine-readable metrics for ilXyr adapters.

The dependency is one-way. ilXyr invokes a source-pinned NSRL executable; NSRL does not depend on
ilXyr. A new executable or model handle remains a human-acknowledged policy-boundary event under
ADR 0003.

### Registered bundle

Each checkpoint registration contains these logical files:

```text
model.nsrlpm
tokenizer.nsrlbpe
manifest.json
MODEL_CARD.md
```

The manifest binds the model and tokenizer SHA-256 digests, source repository and full commit,
artifact schema versions, architecture and parameter count, parent checkpoint and training
lineage, generation defaults, data and weight licences, optimizer-state availability, ilXyr
experiment/evidence references, and every evaluation gate as `passed`, `failed`, or `unopened`.
Missing is not equivalent to unopened. A gate result may change only through a new evidence object;
registration history is never rewritten.

Optimizer state is a separate continuation bundle. It is required when a claim depends on exact
training continuation and is not required for an inference release. The production `NSRLPM1`
lineage and the older successor-v2 benchmark lineage must have distinct handles and must never be
presented as interchangeable checkpoints.

### Pilot sequence

1. **Intake:** register one source commit, model, tokenizer, and optimizer state; verify every
   digest; reproduce inspection and a fixed generation trace; record the asset as `experimental`.
2. **Baseline:** reproduce the public evaluation; freeze the prompt/continuation panel; measure
   likelihood, target rank, repetition, token diversity, context use, numeric saturation, memory,
   latency, and generation throughput; verify byte-identical interrupted-training continuation.
3. **Controlled experiments:** investigate global-token and self-loop attractors, output-head
   calibration, conditional-ranking objectives, context weighting, and greedy versus sampled
   generation. Every run freezes its checkpoint, data, metrics, budget, and stopping rule before
   execution.
4. **Decision:** continue the lineage as managed experimental work, promote a qualifying checkpoint
   to `candidate`, or freeze the lineage. A failed pilot remains settled negative evidence.

### Candidate gates

No checkpoint becomes `candidate` until one immutable evidence set passes all eight gates:

1. **Integrity:** exact artifact, tokenizer, source, and replay bindings.
2. **Numeric health:** no unauthorized overflow, saturation, or corrupt state.
3. **Learning:** improvement on frozen and separated evaluation data.
4. **Generation:** bounded repetition, useful token diversity, and nonzero continuation accuracy.
5. **Context:** measured use of recent prompt information and resistance to distractors.
6. **Serving:** declared memory, latency, and tokens-per-second limits.
7. **Provenance:** clear licences and complete training lineage.
8. **Independent evidence:** a previously untouched evaluation controlled by ilXyr.

Likelihood or target-rank improvement alone cannot authorize promotion. Hidden evaluation access
must stay outside NSRL's training and tuning path.

## Pilot completion record

The pilot is complete only when ilXyr records:

- the verified intake bundle and source-pinned execution adapter;
- the frozen evaluation contract and baseline evidence, including failures;
- the exact-restart result and declared serving measurements;
- every admitted experiment and its settled outcome; and
- one of the three final lifecycle decisions, with reasons and evidence references.

If an artifact, licence, source commit, hidden evaluation, or deterministic restart cannot be
verified, the corresponding gate fails closed. The model remains `experimental`; the lineage is
not silently discarded.

## Consequences

- ilXyr gains custody of the evidence and lifecycle decision, not ownership of NSRL model code.
- Negative generation results become durable evidence instead of cleanup candidates.
- The pilot creates new model-handle and executable registrations, so existing human
  acknowledgement and signed-budget controls still apply.
- At acceptance, protocol objects did not yet represent the full native checkpoint bundle or all
  eight lifecycle gates. Those contracts and the NSRL adapter had to be implemented before intake
  could be called complete.
- Promotion remains a later, separate decision. This ADR cannot be cited as a quality endorsement.

## Implementation record

The native checkpoint/continuation registry, source-root verifier, append-only gate evidence, and
first p10m intake were implemented on 2026-08-28. The executed result is recorded in
`docs/experiments/NSRL-P10M-PILOT.md`. This implementation note does not change the original
decision boundary or the model's experimental status.
