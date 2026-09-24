# ZERO.4 replacement readiness, September 24, 2026

The exact replacement archive remains the one recorded in [PACKAGE.json](PACKAGE.json):
SHA-256 `8ba320df1dc2a7015ac01eafb904585e499fa01f2b99672cdaace226eec123a8`,
54,886,400 bytes, source commit `21a66780fee398a02257e7439f48ef8b05735f15`.
Its frozen ceiling is $12 before tax and 48,600 instance seconds. Step 57
verified its source and local package binding after the adapter repair.

| Stage | Current evidence |
| --- | --- |
| Package ready | Step 57 source and archive record; new regression uses a controlled test archive with the real controller sources. |
| Host ready | The prior 160 GiB host passed its disk reserve. A fresh provider preflight for the replacement is pending. |
| Controller reached | The new packaged-launch regression enters the cloud adapter and reaches the full controller's native build boundary. |
| Scientific process started | Zero in the regression and zero in the previous failed host attempt. |
| Scientific result complete | Pending the replacement run. |

The regression renders the launch request, verifies and unpacks the test host
archive, checks the cloud execution identity and limits, loads the controller
from that archive, and stops at a controlled native boundary. It keeps the
result record with zero model processes. This covers the handoff missed by the
earlier opened-mode and Docker-only checks. The test archive is a local
fixture; the exact 54,886,400-byte archive still needs a fresh provider
preflight and package-specific paid approval before launch.

Run `npm run test:zero4-cloud` to replay the regression. On macOS, the host
fixture uses shell process substitution, so run this check in an environment
that permits `/dev/fd` access.
