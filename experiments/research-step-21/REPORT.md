# Research step 21: FERAL launch failure and transport repair

The approved FERAL attempt ended during Docker setup after the research agent
terminated it. It produced zero model answers. AWS confirmed termination and
root-volume deletion on September 5. All three setup outputs were collected
from their exact S3 versions and passed SHA-256 checks.

The failure includes an operator error. The first read-back check found extra
base64 encoding and treated that as proof that startup had failed. The collected
host log then showed that the script had run, the deadline timer was armed,
and the approved package had passed verification. The operator's termination
interrupted this working setup path.

## What happened

| Event | Evidence |
| --- | --- |
| User approved one comparison | [AUTHORIZATION.json](AUTHORIZATION.json) binds the original question, response, package, and $3 ceiling |
| Launch identity | `feral-finqa-20260905T212657Z`, instance `i-03bcb139c46b6b11e` |
| Binding launch time | September 5, 2026, 21:26:57 UTC |
| EC2 launch time | 21:27:01 UTC |
| Startup reached its final module | Console timestamp 21:28:12 UTC; deadline timer then armed |
| Operator requested termination | 21:28:18 UTC |
| Host failure record | Image phase, exit 1, 83.435 seconds after the binding time |
| First saved provider terminal observation | 21:35:13.934 UTC; the observation time bounds cleanup delay |
| Storage cleanup | EC2 returned `InvalidVolume.NotFound` for the original root volume |

[LAUNCH.json](LAUNCH.json), [HOST-TERMINAL.json](HOST-TERMINAL.json),
[COLLECTION.json](COLLECTION.json), and [TERMINATION.json](TERMINATION.json)
preserve the launch, collection, and cleanup evidence. The host terminal record
keeps its original fields; the separate provider record supplies termination
proof.

The three stored outputs are the launch input, bootstrap log, and host terminal
record. The scientific controller had yet to start. The recorded image-phase
failure describes an interrupted setup. The model comparison remains unmeasured.

## The defect and the mistaken diagnosis

The helper placed base64 text in `UserData`. The AWS CLI encoded that string
again for `RunInstances`. One decode of the provider read-back gave the encoded
script; a second decode reproduced the approved script exactly. The host's
saved script digest also matched the approved script.

The extra encoding was a real transport defect. The conclusion that it had
prevented startup was wrong. [FAILURE.json](FAILURE.json) retains both the
initial diagnosis and the correcting evidence, plus the operator action that
ended the attempt.

The repair passes the script as plain text to the CLI. This follows
[AWS's user-data guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html).
The archived host package, model, target roster, and execution plan retain
their original bytes.

The new regression test sends the rendered request through the installed AWS
CLI to an unsigned local HTTP fixture. It checks the actual request bytes in
both CLI binary modes. The original helper fails both cases. The repaired
helper passes both. All eleven existing bootstrap test groups also pass.
[TRANSPORT-CHECK.json](TRANSPORT-CHECK.json) records these results and the
successful September 5 free AWS permission dry run.

```bash
npm run test:feral-bootstrap
```

For the next attempt, compare provider bytes with the rendered script, then
use the host log and bound terminal record to establish execution state.
Resolve a format mismatch using both sources while keeping the original
deadline. This addresses the observation mistake as well as the encoding defect.

## Cost and next move

Charging compute for all 497 seconds through the first saved terminal
observation gives an upper estimate of $0.3095316. Adding the entire frozen
$0.75 infrastructure reserve gives **$1.0595316 before tax**, within the approved
$3 ceiling. This is a conservative estimate. The actual invoice amount remains
unverified. The host's 83.435-second terminal value measures a different interval
and stays separate from the provider observation bound.

[RUN-REQUEST.json](RUN-REQUEST.json) prepares one replacement attempt using
the same frozen package and scientific plan, with the repaired CLI transport.
Its proposed ceiling is one hour and $3 before tax. The original authorization
covered the completed attempt; the replacement has a separate execution record
under [CLOUD-EXECUTION.md](../../docs/CLOUD-EXECUTION.md). Refresh the live account,
price, image, network, and staged version before its launch decision.

## What this adds to the program

The shared question remains whether learned state reduces the work needed for
a correct answer on unfamiliar inputs. This attempt adds an operational failure
to that evidence trail. It gives a concrete rule for the other cloud packages:
test the real transport, read the host evidence, and account for failed work.

Reasoner retains its matched six-arm source package. Solomon retains its
count-based confidence controls. ZERO.4 retains its five retention arms and
per-source losses. Weight multiplicity retains its verified original query
trace and resource policy. Their next comparison designs remain in the
[program decision map](../research-step-18/REPORT.md).

[RESULT.json](RESULT.json) binds this step's implementation and compact records.
