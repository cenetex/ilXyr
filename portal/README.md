# ilXyr Lab Portal

The proposal, review, funding, and evidence surface for ilXyr.

## Product boundary

The portal stores editable proposals, structured reviews, sealed forecasts, and compute-credit
commitments in D1. It does not execute submissions or append directly to ilXyr's authoritative
experiment ledger. Promotion freezes an eligible proposal as a funding candidate; execution
remains behind the ilXyr control-plane policy boundary.

The portable, authoritative handoff is `ilxyr.experiment_proposal.v1`. A portal or agent should
export that object and submit it with `ilxyr proposal-submit`; authoritative reviews bind the
returned content-addressed reference. The D1 workflow is a collaboration surface and must not be
treated as a substitute for the ledgered draft → review → freeze → package → compile lifecycle.

## Local development

```bash
npm install
npm run dev
npm run build
npm test
```

Database declarations live in `db/schema.ts`, with generated migrations in `drizzle/`.
