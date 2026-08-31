# ADR 0006: Unified research registry is a read-only projection

## Status

Accepted for the Qwen-SEC pilot.

## Context

ilXyr evidence is spread across local ledgers, corpus records, approved publication indexes, and
producer repositories. Each surface preserves its own evidence, but a reader must already know
which repository or artifact digest to inspect.

Qwen-SEC shows the risk. Runner Watch contains an experiment example and working corpus, training,
evaluation, scoring, profiling, and completion code. That does not mean the experiment is
registered or that a baseline, adapter, or paid run exists.

## Decision

Add a typed research registry as a read-only projection. A project record joins stable IDs and
aliases to exact source revisions, model weights, corpora, experiments, dispatches, evaluations,
artifacts, costs, lifecycle stages, and explicit missing requirements.

The projection carries every indexed ledger or publication head and its indexing time. Query
responses calculate the index age and say when it is stale. Search is case-insensitive and exact
aliases, project IDs, and experiment IDs resolve to one project.

Metrics may appear only when the record also names their predictions, dataset, evaluator revision,
and model revision. Sealed artifacts may expose hashes but not locations. Registration and state
changes remain event-backed operations outside this API.

The first interfaces are CLI and stdio MCP. Both use the same Rust read model. HTTP can expose the
same response types in a later phase without changing their meaning.

## Qwen-SEC pilot truth

The initial record says:

- Runner Watch training and evaluation code is implemented at pinned revisions.
- A 403-example development export exists but is not a registered full corpus.
- The full corpus is not frozen or materialized.
- The experiment file is an example with placeholder artifact digests, not a compiled experiment.
- Base SEC, FinQA, and citation-support evaluations have not run.
- No adapter exists, no cloud job was dispatched, and paid training spend is zero.

The record is therefore `blocked`. It becomes eligible for dispatch only after the missing corpus,
profile, baseline, and experiment evidence resolves through ilXyr.

## Consequences

The registry improves discovery without becoming a second authority. A rebuild can discard the
projection and recreate it from the named ledger and approved publication heads. A stale or
externally referenced result remains visibly weaker than recorded or verified evidence.

Producer hooks and the HTTP surface remain follow-up work. The pilot intentionally does not claim
that code in another repository has registered itself with ilXyr.
