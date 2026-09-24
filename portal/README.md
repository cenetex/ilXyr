# ilXyr public protocol index

The deliberately plain public website for ilXyr. It lists public read-only HTTP APIs, command line
calls, research protocols, experiment records, and current execution boundaries.

## Public boundary

The hosted site has no database binding, proposal records, write route, authentication state, or
cloud-launch route. Its JSON endpoints expose only the same public protocol catalog rendered on the
page. It does not execute submissions or append to ilXyr's authoritative experiment ledger.

## Public data

The portal reads `app/public-snapshot.json`, an exact copy of the shared
`docs/public-snapshot-v1.json`. The snapshot is generated from the lab
registry and published diagnostic records. Its source date and build time
appear separately. API results name the check state for each claim. See
`docs/PUBLIC-SNAPSHOT.md` for the freshness rule and update command.

## Local development

```bash
npm ci
npm run dev
npm run build
npm test
```
