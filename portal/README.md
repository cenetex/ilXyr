# ilXyr Lab Portal

The proposal, review, funding, and evidence surface for ilXyr.

## Product boundary

The portal stores editable proposals, structured reviews, sealed forecasts, and compute-credit
commitments in D1. It does not execute submissions or append directly to ilXyr's authoritative
experiment ledger. Promotion freezes an eligible proposal as a funding candidate; execution
remains behind the ilXyr control-plane policy boundary.

## Local development

```bash
npm ci
npm run dev
npm run build
npm test
```

Database declarations live in `db/schema.ts`, with generated migrations in `drizzle/`.
