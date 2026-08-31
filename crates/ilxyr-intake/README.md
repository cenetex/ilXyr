# ilXyr report intake

This crate is the narrow authenticated write boundary for signed execution reports. It reads the
authoritative ilXyr ledger, applies the existing report verifier, and appends accepted reports or a
bounded rejection receipt. It cannot authorize or launch compute.

## Credential flow

1. The normal control plane records a remote authorization and launch receipt.
2. An operator issues one short-lived report credential:

   ```text
   ilxyr-intake issue <workspace> <authorization-id> 3600 5
   ```

3. The command returns the bearer token once. Deliver it to the host-side reporter over a protected
   control channel. Do not place it in the guest, job package, image, logs, shell history, or public
   site.
4. The reporter sends the exact signed `ilxyr.execution_report.v1` bytes to `POST /v1/reports`.
5. The credential becomes bound to that report digest. An exact retry is safe; different bytes
   conflict.

## Service boundary

The default listener is `127.0.0.1:8087`:

```text
ilxyr-intake serve /srv/ilxyr/ledger
```

Production should keep this listener on loopback or a private network and terminate TLS in a small
reverse proxy. If direct non-loopback binding is required, it is explicit:

```text
ilxyr-intake serve /srv/ilxyr/ledger --bind 10.0.0.8:8087 --max-body-bytes 1048576 --requests-per-minute 60 --allow-public-bind
```

The reverse proxy must set a small request-header limit, the same or a smaller body limit, a short
header timeout, a bounded body timeout, a low connection limit, and client-aware rate limiting. It
must not log authorization headers or report bodies. The intake's own peer limit is a second layer;
behind a proxy it sees the proxy as the peer and does not trust forwarded client-address headers.

Run the process as a dedicated account. Give it read/write access only to one backed-up,
single-writer ilXyr workspace. Do not give it cloud-provider, image-build, code-signing, executor,
DNS, or website-deployment credentials. Keep the public catalog and projector in separate accounts.

The public discovery document must keep the report endpoint null until this service has real TLS,
an authoritative ledger, trusted executor keys, monitoring, backups, and a tested recovery path.
