# Research step 15: FERAL host bootstrap and collection

The FERAL host package now connects the frozen controller to an EC2 bootstrap.
It arms shutdown from the rendered launch time before metadata or storage
calls, verifies the host and execution archives, runs the fixed image, collects
results, and requests shutdown. The launch helper renders an EC2 dry-run
request by default. A paid dispatch checks the matching package, plan, budget,
approval reference, fresh launch time, and AWS account.

Eleven bootstrap test groups passed. The full schema suite passed, followed
by the final host identity checks. The archived bootstrap also passed three
separate probes with local service stubs: complete execution, a failed
controller, and failed result collection. Each used the exact archived body.
The probes exercised package extraction and checksum verification while model
generation and cloud instance counts stayed at zero.

## Failures retained

| Case | Retained result |
| --- | --- |
| Metadata, package, or image failure | Failed phase, exit code, host log, and shutdown request |
| Controller exits 7 | Prediction prefix collected, container cleanup requested, controller failure retained |
| Result upload fails | Failed host record, collection flag, exit code 1, and shutdown request |
| Launch time has expired | Shutdown requested before cloud or package work |
| Reviewed bootstrap body changes | Digest failure before metadata access |
| Launch response is lost | Actual submitted request, client token, and `launch_outcome_unknown` receipt |

Review caught a collection-path error: the controller stores its large model
and extracted source under `run/`, while the first filter checked only the
top level. The filter now covers both paths. The probes keep predictions and
verify the upload roster. Review also caught a zero exit code after failed
collection. That failure now reaches both the host record and shell exit.

The first fixture run hit a local sandbox restriction on `/dev/fd`. The same
fixtures passed with normal file-descriptor access. AWS, Docker, systemd, and
shutdown were replaced by local stubs throughout those checks.

## Identity, deadline, and collection

The launcher records the rendered user-data digest. The host verifies its
reviewed body and records the user-data digest and observed instance ID in its
terminal receipt. Each run uses a stable client token, one instance, encrypted
storage, IMDSv2, and termination on shutdown.

The host schedules shutdown at second 3,570 after the rendered launch time.
The controller keeps its latest TERM and KILL times at seconds 3,270 and
3,300. The remaining time covers collection and shutdown. Every host command
uses the original launch deadline. Late startup consumes the same budget.

The frozen image runs with one GPU, eight CPUs, a 56 GiB memory limit, a
read-only root filesystem, and isolated container networking. The model and
source trees stay on the instance. Result uploads use SHA-256 validation,
encryption, and conditional writes that require a new object key. These are
the documented [S3 PutObject checks](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html).

A host shutdown request is one stage of the evidence. The collector still
needs the provider's terminal state, matching artifact hashes, and the full
cost receipt before the run can supply cloud performance evidence. A lost
launch response requires inspection with the saved client token and submitted
request before deciding the next action.

## Reproduce

The host archive binds commit
`b36e0ae4d13f44859260f9dfe043dee14ce18cb2`. It contains 1,638,400 bytes with
SHA-256 `4ad780b4a09134255eea0d8a3cbb87727d9843de10f9cee7e110c91381ac2355`.
[ARCHIVE.json](ARCHIVE.json) binds the host body and the unchanged step 14
execution package. Rebuilding after an uncommitted body edit produced the
same archive. An attempted overwrite preserved the existing archive.

```bash
python3 scripts/feral_cloud_package.py build \
  --repo /path/to/ilxyr \
  --revision b36e0ae4d13f44859260f9dfe043dee14ce18cb2 \
  --execution-archive /path/to/step-14-execution.tar \
  --out /tmp/feral-host-v1.tar
python3 scripts/test_feral_bootstrap.py
```

The `render`, `dry-run`, and `launch` commands take a versioned host-package
binding and a resolved subnet/security-group file. Rendering writes the
user data and dry-run request for review. Dispatch first verifies the selected
AWS account. Paid dispatch also requires the exact bounded approval record.
[RESULT.json](RESULT.json) preserves five source bindings, packaged failure
probes, and the credential check.

## Live preflight and next step

The read-only identity query for the selected `default` AWS profile returned
an expired SSO token and failed refresh. That profile uses the `staging` SSO
session. A session refresh has been requested.

Once access is ready, verify the AMI, machine shape, subnet, security group,
IAM profile, bucket settings, object version, and current price. Then freeze
the live network binding and run the EC2 dry run. The budget draft remains
one hour and $3.00 before tax. Paid execution follows completed preflight and
the bounded approval.

This closes another preparation gap in the shared program: failed attempts
keep their output, identity, and cost path. The next scientific comparison
still concerns correct final answers against the fixed controls. The earlier
Reasoner, Solomon, ZERO.4, and weight-multiplicity failures remain preserved
in their own source records.
