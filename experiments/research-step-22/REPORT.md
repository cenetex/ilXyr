# Research step 22: FERAL replacement comparison

The replacement comparison launched on September 8 at 06:14:02 UTC as
`i-0c979a0b88567f77d`, run `feral-finqa-20260908T061358Z`.
The bound deadline is 07:13:58 UTC, with a $3 ceiling before tax.

AWS first returned `InsufficientInstanceCapacity` in `us-east-1a`.
The exact client-token lookup returned zero instances. The next request used
an existing subnet in `us-east-1b`, where AWS reported capacity. It uses the
same VPC, security group, main route table, and network ACL. The fixed machine,
AMI, scientific package, and budget retain their approved values.
[CAPACITY-FAILURE.json](CAPACITY-FAILURE.json) preserves the first response,
its resolution, and both network-binding digests.

The live provider script bytes match the rendered script after one base64
decode. The host console shows its deadline timer armed and the fixed image
pull in progress. Startup also logged an NVIDIA GRID daemon version warning;
container runtime evidence will determine GPU readiness.
[LAUNCH.json](LAUNCH.json) preserves this running observation. Completion,
result collection, provider termination, and cost verification follow it.

The study compares the frozen Qwen model, evidence calculator, and operand-only
control on all 1,147 revised FinQA inputs. Raw answers and partial outputs stay
in the result record. The [earlier operator failure](../research-step-21/REPORT.md)
retains its original outcome.

The user approved both research directions. Reasoner's next deliverable is its
cloud package for the frozen six-arm, 128-family, 12-pass comparison. Its machine,
build environment, collection path, deadline, and cost ceiling are being bound
before that paid execution decision.
