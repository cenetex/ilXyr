"use client";

type StatusItem = {
  readonly key: string;
  readonly value: string;
};

type ProtocolPortalProps = {
  status: readonly StatusItem[];
};

export function ProtocolPortal({ status }: ProtocolPortalProps) {
  const readyCount = status.filter((item) =>
    ["available_for_public_weight_experiments", "implemented", "implemented_with_fake_node"].includes(
      item.value,
    ),
  ).length;

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="ilXyr home">
          il<span>X</span>yr
        </a>
        <nav aria-label="Primary navigation">
          <a href="#system">System</a>
          <a href="#explore">Explore</a>
          <a href="https://github.com/cenetex/ilXyr">GitHub</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker"><span className="live-dot" /> Public protocol index · live</p>
          <h1>Evidence before<br /><em>execution.</em></h1>
          <p className="hero-lede">
            ilXyr turns research ideas into frozen experiments, admits only what passes its gates,
            and leaves every result in a verifiable ledger.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#explore">Explore the system <span>↘</span></a>
            <a className="button secondary" href="https://cenetex.github.io/ilXyr/">Read the project deck</a>
          </div>
        </div>

        <aside className="signal-card" aria-label="Current public system signal">
          <div className="signal-topline"><span>PUBLIC SIGNAL</span><span>READ ONLY</span></div>
          <div className="signal-score"><strong>{readyCount}</strong><span>implemented surfaces</span></div>
          <div className="signal-track"><span style={{ width: `${Math.round((readyCount / status.length) * 100)}%` }} /></div>
          <p>Protocol data is public. Compute authorization is not.</p>
        </aside>
      </section>

      <section className="status-strip" id="system" aria-label="System status">
        <div><span>01 / Local executor</span><strong>Available</strong></div>
        <div><span>02 / Remote verifier</span><strong>Implemented</strong></div>
        <div><span>03 / Cloud launcher</span><strong className="muted-status">Roadmap</strong></div>
      </section>

      <section className="preview-section" id="explore">
        <p className="section-index">01 — The protocol</p>
        <h2>One system.<br />A visible chain of proof.</h2>
      </section>
    </main>
  );
}
