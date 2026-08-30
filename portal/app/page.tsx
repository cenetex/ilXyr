import {
  cliGroups,
  experiments,
  guide,
  protocolDocuments,
  publicRoutes,
  repository,
  siteStatus,
} from "./catalog";

export default function Home() {
  return (
    <main>
      <h1>ilXyr</h1>
      <p>Intelligent Lab eXperiment Yielding Research.</p>
      <p>
        A research protocol, ledger, and command line tool. This public website is a read-only
        index. It is not an experiment executor and it does not authorize compute.
      </p>

      <h2>Status</h2>
      <ul>
        {siteStatus.map((item) => (
          <li key={item.key}>{item.key.replaceAll("_", " ")}: {item.value.replaceAll("_", " ")}</li>
        ))}
      </ul>

      <h2>Public HTTP API</h2>
      <p>These calls return public, read-only JSON. There are no write or cloud-launch routes.</p>
      <ul>
        {publicRoutes.map((route) => (
          <li key={route.path}>
            <a href={route.path}><code>{route.method} {route.path}</code></a> — {route.description}
          </li>
        ))}
      </ul>

      <h2>Command line API</h2>
      <p>Prefix each call with <code>ilxyr</code>.</p>
      {cliGroups.map((group) => (
        <section key={group.name}>
          <h3>{group.name}</h3>
          <ul>
            {group.calls.map((call) => <li key={call}><code>{call}</code></li>)}
          </ul>
        </section>
      ))}

      <h2>Cloud executor protocol (not implemented)</h2>
      <p>A cloud job will be admitted only as an immutable package bound by digest.</p>
      <ul>
        <li>one experiment ID and one compiled experiment digest</li>
        <li>exact source commits and source archive digests</li>
        <li>exact executable, oracle, harness, data, and model digests</li>
        <li>provider, region, machine type, machine image, storage, and architecture</li>
        <li>time and cost ceilings, watchdog behavior, and shutdown policy</li>
        <li>target order, concurrency, allocation policy, and failure policy</li>
        <li>network and export policy</li>
        <li>write-once launch, identity, status, result, and attestation receipts</li>
      </ul>
      <p>
        A normal frontier and a presized-memory audit must use separate experiment IDs, packages,
        budgets, and result records. A package is not an authorization to spend.
      </p>

      <h2>Protocol documents</h2>
      <ul>
        {protocolDocuments.map((document) => (
          <li key={document.id}><a href={document.url}>{document.title}</a></li>
        ))}
      </ul>

      <h2>Experimental protocols and results</h2>
      <ul>
        {experiments.map((experiment) => (
          <li key={experiment.id}>
            <a href={experiment.url}>{experiment.id}: {experiment.title}</a> — {experiment.status}
          </li>
        ))}
      </ul>

      <h2>Source</h2>
      <ul>
        <li><a href={repository}>github.com/cenetex/ilXyr</a></li>
        <li><a href={guide}>published experiment guide</a></li>
      </ul>
    </main>
  );
}
