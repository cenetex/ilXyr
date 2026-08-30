# ilXyr protocol index

The deliberately plain website for ilXyr. It lists the callable HTTP and command line APIs,
research protocols, experiment records, and current execution boundaries.

## Product boundary

The HTTP API stores editable proposals, structured reviews, sealed forecasts, and compute-credit
commitments in D1. The website has no cloud-launch route. It does not execute submissions or append
directly to ilXyr's authoritative experiment ledger. Execution remains behind the ilXyr
control-plane policy boundary.

The portable, authoritative handoff is `ilxyr.experiment_proposal.v1`. A portal or agent should
export that object and submit it with `ilxyr proposal-submit`; authoritative reviews bind the
returned content-addressed reference. The D1 workflow is a collaboration surface and must not be
treated as a substitute for the ledgered draft → review → freeze → package → compile lifecycle.

## Local development

```bash
npm ci
npm run dev
npm run build
npm test
```

Database declarations live in `db/schema.ts`, with generated migrations in `drizzle/`.
