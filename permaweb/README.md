# ilXyr Permanent Experiment Registry

This is the Arweave and AO version of ilXyr. The website is static. It does not need an application
server or a central database. You can open it through different Arweave gateways.

## Architecture

- **Arweave manifests** store the website and experiment evidence.
- **GraphQL** finds records from approved publisher wallets.
- **`ilxyr.index.v1` files** list approved records. Each version points to the previous version.
  The first index is included in the website, so the first record is still visible if GraphQL fails.
- **The AO process** stores signed proposals, reviews, promotions, forecasts, compute credits, and
  evidence notices.
- **The ilXyr executor runs outside the dApp.** It sends verified results to Arweave.

The dApp ships with the existing Qwen3.5 acceptance evidence transaction as its first known record:
`jguWIRC2oP5gNWNmGNNeLIGD9t155X6orv9FREZmHBk`.

## Configure

```bash
cp .env.example .env
```

Set the trusted publisher wallet list. After deploying `ao/ilxyr-registry.lua`, also set
`VITE_ILXYR_AO_PROCESS`. After publishing the first canonical index, set `VITE_ILXYR_INDEX_TX`.
Set `VITE_ILXYR_ARNS_NAME` only after registering or choosing an ArNS name.

New evidence publication manifests should carry `Data-Protocol=ilxyr`, `Experiment-Id`,
`Evidence-Ref`, and `ILXyr-Outcome` tags. Discovery always combines the protocol tag with the
configured trusted publisher addresses; the canonical index remains the authoritative view.

## Build and verify

```bash
npm install
npm test
npm run bundle:verify -- jguWIRC2oP5gNWNmGNNeLIGD9t155X6orv9FREZmHBk
```

## Build the first canonical index

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
