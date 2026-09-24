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

The record list shows a publisher-reported outcome. For a configured canonical
index transaction, the browser reads that transaction's owner from the
configured HTTPS Arweave gateway's GraphQL response. It checks the owner
against `published_by` and the approved address list. It checks each bundle
transaction's owner separately; an entry's `owner` field is only a claim. A
bundled local fallback has no index transaction owner proof. Missing or
conflicting gateway metadata leaves an explicit unknown or failed state. An
authenticated gateway record can replace an unverified canonical listing in
the de-duplicated view while preserving the canonical error.

This is gateway-backed provenance: the browser trusts the configured HTTPS
gateway to report transaction owners accurately. It does not independently
verify Arweave signatures or consensus. Publisher provenance does not prove
the core ledger binding or scientific outcome. Those remain separate checks.
A reported `no_go` remains visible as a reported result.

Opening a record shows separate states for the listing, gateway owner checks,
file retrieval, byte integrity, ilXyr ledger binding, and scientific
disposition. A file passes byte integrity only after the browser retrieves it
and checks both size and SHA-256. Retrieval and integrity failures stay distinct.

The browser and `bundle:verify` accept `ilxyr.publication-manifest.v1` and the
published `lecore.qwen35-publication-manifest.v1` file format. Both check
manifest fields, transaction paths, file sizes and SHA-256 hashes. Manifest
reads stop at 1 MiB; each evidence file stops at 64 MiB even when the server
omits a length header. A malformed manifest stays visible as an explicit
record error. A manifest with a different experiment or evidence reference
cannot replace the registry listing's identity. Legacy ledger-verification
fields remain publisher reports until the core-to-AO proof is checked.

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
