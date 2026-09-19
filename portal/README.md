# ilXyr public protocol index

The deliberately plain public website for ilXyr. It lists public read-only HTTP APIs, command line
calls, research protocols, experiment records, and current execution boundaries.

## Public boundary

The hosted site has no database binding, proposal records, write route, authentication state, or
cloud-launch route. Its JSON endpoints expose only the same public protocol catalog rendered on the
page. It does not execute submissions or append to ilXyr's authoritative experiment ledger.

## Local development

```bash
npm ci
npm run dev
npm run build
npm test
```
