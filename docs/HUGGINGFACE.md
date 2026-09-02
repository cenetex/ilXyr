# Hugging Face integration

ilXyr imports public Hugging Face model metadata as an immutable ledger object. The import resolves
the repository to a full 40-character Hub commit, records every file's Git blob ID and size, and
records the SHA-256 object ID for each LFS file. That produces two stable handles:

- `model_ref` identifies the model behind a model actor.
- `weight_ref` identifies the exact weights in an experiment's `models` list.

Neither handle points at mutable `main`. The importer records metadata only; it does not download
the linked model's 19 GB of weights or call an inference service.

## Import the leCore Qwen3.5 checkpoint

Initialize or open an ilXyr workspace, then import the model:

```bash
cargo run -p ilxyr-cli -- init .
cargo run -p ilxyr-cli -- huggingface-import . staccs/lecore-qwen35-9b-assimilated
```

The command queries the Hub, resolves the current commit, validates that the repository is public
and ungated, and records the result. To require a revision you already selected, pass its full SHA:

```bash
cargo run -p ilxyr-cli -- huggingface-import . \
  staccs/lecore-qwen35-9b-assimilated \
  4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5
```

The repository includes the corresponding golden manifest at
`examples/schema/huggingface-model.json`. It can also be registered without a network request:

```bash
cargo run -p ilxyr-cli -- huggingface-register . examples/schema/huggingface-model.json
```

Repeating an identical import or registration is idempotent.

Inspect the registered object using the `model_ref` returned by the import:

```bash
cargo run -p ilxyr-cli -- huggingface-show . \
  model://huggingface/staccs/lecore-qwen35-9b-assimilated@4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5
```

## Bind it to ilXyr protocol objects

Use `model_ref` when this checkpoint is the accountable model actor:

```json
{
  "id": "model://research/qwen35-assimilated",
  "kind": "model",
  "model_ref": "model://huggingface/staccs/lecore-qwen35-9b-assimilated@4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5"
}
```

Use `weight_ref` in a frozen experiment:

```json
{
  "models": [
    "weight://huggingface/staccs/lecore-qwen35-9b-assimilated@4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5"
  ]
}
```

The importer deliberately does not grant the model a role, admit an experiment, or infer evidence
authority. Existing ilXyr contribution, forecast, funding, admission, execution, and attestation
rules still apply.

## Bind the Transformers run

The model manifest identifies weights. A Transformers execution profile
identifies the recipe that turns those weights and data into a run.

[`transformers-execution-profile.schema.json`](../schemas/transformers-execution-profile.schema.json)
records the run-changing factors that often live in library defaults:

- Python, PyTorch, Transformers, Accelerate, PEFT, and Safetensors versions;
- the Transformers source revision and distribution digest;
- the source code, reference config, final config, and dependency-lock digests;
- image, executor, accelerator, driver, and runtime identity;
- dtype, device map, attention and mask backends, cache, checkpointing, and
  compile settings;
- optimizer, scheduler, batch shape, initial evaluation, and save/evaluation
  strategy;
- tokenizer revision, chat-template digest, training view, truncation,
  padding, label mask, and collator digest;
- LoRA settings; and
- all seeds and data-loader behavior.

The base-only profile also binds the resolved generation config, output length,
sampling mode, beam count, and batch size.

A draft profile has a non-empty `unresolved` list. A frozen profile has exact
values for every required software, image, hardware, optimizer, scheduler,
tokenizer, and input-view field. Its `execution_authorized` value stays
`false`; ilXyr spend and dispatch records carry run authority.

Drafts describe the target recipe. `source_config_sha256` records the source
example. `config_sha256` records the final run config at freeze. Open
implementation items require updated source and config digests before freeze.

The prepared FERAL-7B
[`base-only profile`](../examples/feral-7b/transformers-base-profile.json) and
[`one-percent LoRA calibration profile`](../examples/feral-7b/transformers-calibration-profile.json)
bind Transformers 5.16.1, source revision
`93c8b7b485963a10800c91f55304db6be211c2bd`, the exact Qwen revision, the
Runner Watch trainer revision and file digests, PEFT 0.20.0, and the planned
LoRA recipe. Their open lists give the path to two frozen checks. The base
check establishes quality, memory, and generation timing. The LoRA check
measures the real training path for the full-run cost estimate.

Check either draft with:

```bash
npm run check:research-profile -- examples/feral-7b/transformers-base-profile.json
```

Frozen representation probes use the shared
[`representation audit contract`](REPRESENTATION-AUDITS.md).

## Load or serve the exact revision

Use the same revision outside the control plane when downloading or loading weights:

```bash
hf download staccs/lecore-qwen35-9b-assimilated \
  --revision 4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5
```

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

repo_id = "staccs/lecore-qwen35-9b-assimilated"
revision = "4e14e0ee3d5b6936dfd3dd0fa7454d9118fe88c5"

model = AutoModelForCausalLM.from_pretrained(
    repo_id,
    revision=revision,
    torch_dtype="auto",
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained(repo_id, revision=revision)
```

An executor adapter may load those weights locally or serve them through a compatible endpoint,
but it must consume the frozen `weight_ref` and emit run provenance that binds back to the ilXyr
run. Shared hosted inference that cannot prove the selected Hub revision should not be treated as
revision-bound evidence.

## Security boundary

- The optional `HF_TOKEN` environment variable is sent only as an authorization header and is
  never written to the ledger.
- V1 rejects private, gated, or disabled repositories rather than misclassifying them as public
  weights.
- The Hub commit and file digests establish artifact identity. They do not establish model quality,
  safety, the truth of the model card, or the execution environment.
- The linked model card reports a prove run with no compression win and matched sample perplexity;
  ilXyr records that checkpoint identity but does not elevate the report into evidence by import.
