# Public evidence snapshot

`docs/public-snapshot-v1.json` is the shared read-only projection for the
hosted portal and GitHub Pages. `portal/app/public-snapshot.json` is an exact
build copy. The generator reads `docs/lab-registry.json`, the public cloud
diagnostic acceptance record, its execution report, and the environment
profiles. It checks that the diagnostic identities and references agree.

Run `node scripts/build-public-snapshot.mjs` after a source update. Required
CI runs `npm run test:public-snapshot` and rejects a stale generated copy.
The snapshot records the source registry commit and SHA-256 digest, the
registry's `as_of` date, and the separate generation time.

The freshness rule is 14 days after the registry's `as_of` date. The portal
checks that deadline at request time. A later page build keeps the original
registry date. The Pages renderer labels its source date separately from its
build time.

Each experiment carries separate scientific outcome, execution, disclosure,
lifecycle, evidence maturity, and local import states. Publisher, file, and
ledger checks stay `not_checked` until the public verifier consumes proof.
The cloud diagnostic result is labeled `source_reported_acceptance`: the
snapshot generator checks local source agreement and does not repeat the
cryptographic report or core ledger verification.

The snapshot accepts the registry discovery health structure from the
permaweb viewer when a verified capture is supplied. Its current build marks
that source `not_checked`, since the static build does not query the gateway.
The lab registry file and published diagnostic source each have their own
health entry.
