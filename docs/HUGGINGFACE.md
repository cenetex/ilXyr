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
