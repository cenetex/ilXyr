# Research step 25: FERAL startup check and calculator v2

The repaired FERAL package is frozen, staged, and ready for a bounded GPU run.
The worker initializes CUDA, loads the fixed model once, and generates a short
synthetic answer before scoring the 1,147 original inputs. Each phase writes a
record. Readiness requires GPU placement and a nonempty generated response.
The synthetic answer is retained as a diagnostic; it contributes zero scored
rows. Setup and generation remain inside the original process costs and limits.
Live model startup remains the first test in the paid comparison.

## Package and bounded run

The host package SHA-256 is
`3602dfc569d45962aba00d76f888c3aa9b6b024b4ddc8bad8c7294ca9376bc75`.
[PACKAGE.json](PACKAGE.json) records its immutable object version and verified
read-back. The nested execution archive is
`90f393eda219d4070e2b8318f3bd625eb76ea9eff4338dff096a247f58badf05`;
the plan is `eeb5658143faebd7aeb9db25185c5503a59ab5dc555c378cbdd243c35a2b3e49`.
The scientific source archive, model revision, 1,147 inputs, revised targets,
and both v1 controls keep their original bytes. Earlier failed runs and
control scores remain in their own records.

Free provider checks passed on September 8, 2026. The resolved machine is one
`g6e.2xlarge` in `us-east-1b`, with one L40S GPU, 64 GiB RAM, and a 150 GiB
encrypted root volume. The fixed runtime image and AMI remain in the plan and
request. The free launch dry run created zero instances.

The proposed limit is one hour and **$3 before tax**. The verified hourly
compute price is $2.24208; the $0.75 reserve gives a maximum estimate of
$2.99208. The shutdown timer remains fixed at launch. [PREFLIGHT.json](PREFLIGHT.json)
and [DRY-RUN.json](DRY-RUN.json) retain the evidence. Launch approval must bind
this package and budget under [CLOUD-EXECUTION.md](../../docs/CLOUD-EXECUTION.md).

## Separate calculator development

Calculator v2 adds explicit single-year ratios, percentages, differences,
sums, and value lookups. It checks units, ambiguity, and evidence spans. Its
operand-only control selects the same cells. Existing supported v1 paths keep
their recorded answers.

On the five opened development cases, v2 scores **5/5**, up from v1's **4/5**.
The added correct answer is the Masco versus S&P 500 cumulative-return
difference, **111.97 percentage points**. Three cases receive numeric answers;
two receive correct abstentions. The v2 operand-only arm scores 2/5.
[CALCULATOR-V2-SMOKE.json](CALCULATOR-V2-SMOKE.json) retains all traces and
source hashes. These are development results. A separately frozen fresh roster
is the [next coverage test](CALCULATOR-V2-NEXT.md).

The paid model comparison keeps v1 as its fixed baseline. This preserves the
original scientific question while v2 develops as a separate control.

## Verification and shared lesson

Local checks passed: 18 execution groups, 12 host lifecycle groups, one real
AWS CLI transport fixture, and seven calculator v2 groups. They cover startup
failure phases, a shared model instance, raw response retention, GPU placement,
archive binding, evidence ambiguity, unit checks, and arithmetic changes under
counterfactual inputs. GPU behavior itself will be checked on the frozen host.

The common research question is whether each added component earns its full
cost. FERAL now records the path from model startup through evidence selection
to the final answer. Failures at each stage remain useful evidence for choosing
the next learned component.
