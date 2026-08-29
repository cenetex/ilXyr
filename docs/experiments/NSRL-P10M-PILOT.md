# NSRL p10m managed pilot: intake and public baseline

- Run date: 2026-08-28
- Decision authority: ADR 0005
- Checkpoint: `NSRLPM1` p10m output-calibration-v10
- Lifecycle result: continue as a managed `experimental` model
- Candidate eligible: no

## Intake

The adapter verified a clean NSRL tree at commit
`94515eabc301e759226095a14fada7020d1c5dd8` and tree
`f3314308e41f3724394b1c241bcc50737ef4f1a3`. It streamed and matched five declared
artifacts totaling 89,381,032 bytes: model, tokenizer, optimizer, model card, and executable.
The intake imported five distinct content-addressed blobs; the shared compact pilot evidence added
a sixth. A full ledger verification re-hashed all six blobs, nine JSON objects, and nine events.

Inspection confirmed 9,317,632 parameters, an 8,192-token vocabulary, six layers, a 256-token
training context, model hash `0x011da7a107200d14`, and tokenizer hash
`0xf4fe71d93c438c1a`.

Two fixed greedy runs from `The king` produced byte-identical traces and text. All 32 generated
tokens were token 854, decoded as repeated `German`. The existing interrupted continuation also
matched candidate and replay bytes for the model, optimizer, and normalized training trace.

## Fresh public baseline

The source-built NSRL runners executed the frozen `open-generation-v1` development panel against
the registered v10 checkpoint. The hidden panel was neither opened nor scored.

| Measurement | Result | Gate implication |
| --- | ---: | --- |
| Prompts / samples / generated tokens | 12 / 60 / 30,720 | complete matrix passed |
| Candidate modeling | 3,488 millibits per original UTF-8 byte | required baselines absent |
| Worst repeated four-gram share | 999 per mille | failed; maximum 150 |
| Minimum unique four-gram share | 1 per mille | failed; minimum 600 |
| Minimum entropy | 0 Q10 | failed; minimum 2,048 |
| UTF-8 validity | 1,000 per mille | passed |
| Context use | 0 per mille | failed; minimum 750 |
| Distractor resistance | 0 per mille | failed; minimum 700 |
| Cache state / workspace | 405,504 / 10,240 bytes | measured |
| Latency / throughput limits | not declared | serving gate failed |
| Inference residual saturation | 0 | passed on this surface |
| Candidate test residual saturation | 1 | numeric-health gate failed |

## Settled gates

| Gate | Status | Reason |
| --- | --- | --- |
| Integrity | passed | Source and artifact bindings matched; generation and restart replay were exact. |
| Numeric health | failed | The frozen candidate test evaluation reports one residual saturation. |
| Learning | passed | Public separated dev and test NLL improved against the parent checkpoint. |
| Generation | failed | Repetition, diversity, and entropy missed their frozen bounds. |
| Context | failed | Context use and distractor resistance were both zero. |
| Serving | failed | Memory was measured; latency and tokens-per-second limits were not declared. |
| Provenance | failed | The exact source commit is unpublished and the weights have no explicit licence. |
| Independent evidence | unopened | The hidden panel remains untouched. |

The ledger is fail-closed and reports `candidate_eligible=false`.

## Decision and next boundary

Continue the lineage as a managed experimental model. Do not promote or open the hidden panel.
Before another training run, ilXyr needs a signed compute budget and a frozen experiment targeting
the known conditional-output failure. Provenance repair can proceed independently: publish the
exact source commit and declare a weight licence. A future candidate still has to pass every gate
together; this intake does not grandfather its two passing gates.
