# ilXyr AWS launcher

This crate connects the ilXyr remote execution protocol to AWS EC2 and S3.

The launcher has five steps:

1. Stage canonical job package JSON in a digest-named S3 object.
2. Check the AWS account, AMI, machine type, network, IAM profile, storage, price, and cost limit.
3. Create one EC2 instance from a ledgered launch approval.
4. Read its status from S3 or EC2.
5. Collect its signed execution report from S3.

The EC2 launch uses a private network interface. It also uses encrypted `gp3` storage, IMDSv2,
termination on shutdown, and an AWS client token derived from the ilXyr launch reservation. The
frozen bootstrap script arms the watchdog.

The bootstrap script is part of the frozen job package. Its SHA-256 digest and size must match the
package harness. The script writes status and report files to the result path in the launcher
config.

See `docs/REMOTE_EXECUTION.md` for the full command flow.
