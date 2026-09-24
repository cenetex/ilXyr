# ilXyr Permanent Experiment Registry

This is the Arweave and AO version of ilXyr. The website is static. It does not need an application
server or a central database. You can open it through different Arweave gateways.

## Architecture

- **Arweave manifests** store the website and experiment evidence.
- **GraphQL** finds records from configured publisher addresses.
- **`ilxyr.index.v1` files** list approved records. Each version points to the previous version.
  The first index is included in the website, so the first record is still visible if GraphQL fails.
- **The AO process** stores signed proposals, reviews, promotions, forecasts, compute credits, and
  evidence notices.
- **The ilXyr executor runs outside the dApp.** Publishers submit result records to Arweave.

The dApp ships with all seven frozen Qwen3.5 acceptance records. The canonical index preserves the
five terminal failures and the accepted v6 and v7 results; the seven path manifests are also seeded
directly so their file inventories remain available when gateway tag discovery is incomplete.
Because v3-v5 did not produce admitted `EvidenceRecorded` objects, their index `evidence_ref` values
bind the reconstructable evidence-bundle SHA-256 recorded by their publication receipts.

## Configure

```bash
cp .env.example .env
```

Set the publisher address list. After deploying `ao/ilxyr-registry.lua`, also set
`VITE_ILXYR_AO_PROCESS`. After publishing the first canonical index, set `VITE_ILXYR_INDEX_TX`.
Set `VITE_ILXYR_ARNS_NAME` only after registering or choosing an ArNS name.

New evidence publication manifests should carry `Data-Protocol=ilxyr`, `Experiment-Id`,
`Evidence-Ref`, and `ILXyr-Outcome` tags. Discovery always combines the protocol tag with the
configured publisher addresses; the canonical index remains the listing view.

## What the browser checks

The record list shows a publisher-reported outcome and whether its publisher address appears
in the configured list. Opening a record shows separate states for the listing, publisher
authentication, file retrieval, SHA-256 file integrity, ilXyr ledger binding, and scientific
disposition. A file's hash changes to `pass` only after the browser retrieves and hashes that
file. A retrieval error and a hash mismatch have different states. Existing records carry
`not checked` for publisher authentication, ledger binding, and scientific disposition until
the corresponding verification path exists. A reported `no_go` remains visible as a reported
result, including when its provenance later verifies.

## Build and verify

```bash
npm ci
npm test
npm run bundle:verify -- jguWIRC2oP5gNWNmGNNeLIGD9t155X6orv9FREZmHBk
```

## Rebuild the bundled canonical index

```bash
npm run index:build -- \
  --entries fixtures/index-entries.json \
  --sequence 1 \
  --publisher I5Z-EnOhkasZjtaMu9IbSVK3duWSecQpZ0lnKFEjjRg \
  --generated-at 2026-08-12T00:00:00.000Z \
  --out ilxyr-index.json

npm run index:validate -- ilxyr-index.json
```

## Upload

The production build uses relative asset paths and is ready for an Arweave path manifest. The
official uploader is invoked ephemerally so its broad wallet dependency tree is not shipped with
the dApp:

```bash
npm run deploy:index
# Put the returned index transaction in VITE_ILXYR_INDEX_TX, then configure the AO process ID.
npm run deploy:arweave
# Or, when an ArNS name and authority key are available:
npm run deploy:arns
```

Deployment needs an authorized upload wallet or deployment credential. Keep it outside the source
tree and use a dedicated, minimally funded deployment wallet.
