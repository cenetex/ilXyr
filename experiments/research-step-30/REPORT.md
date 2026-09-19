# Research step 30: FERAL capacity window closed

The fixed FERAL package reached **12 capacity failures**: four initial launch
attempts and eight scheduled follow-ups. Each of the four supported zones
was tried three times. Every attempt passed its free dry run, then returned
`InsufficientInstanceCapacity`. Each exact request was reconciled before
the next attempt. All reconciliations found zero instances.

The final request was made at 17:03:40 UTC on September 8, 2026. A final
provider query at 17:04:34 UTC confirmed zero instances across all twelve
request tokens and zero active FERAL instances. The follow-up was paused
after the 17:05 UTC cutoff (10:05 in Vancouver).
[CAPACITY-WINDOW.json](CAPACITY-WINDOW.json) retains all attempts, their
observation times, and hashes of the private receipts.
[VERIFICATION.json](VERIFICATION.json) binds the final reconciliation.

## Budget and research state

These attempts used **$0 in instance compute**. The approved first paid run
remains pending. Its package is
`25c350b4819e499bcf1adabe56d5d05cb8ef7c07daccb13d7a221545cd74d821`,
with the same one-hour limit and $3 before-tax cap. Every selected rate check
held at $2.24208 per hour, for a maximum estimate of $2.99208 with the reserve.
The earlier price-document assertion failure remains in
[step 29](../research-step-29/REPORT.md).

The scientific comparison still awaits execution. It produced zero model
answers in this window. The next execution step is the same approved package
when GPU capacity is available, after fresh provider and package checks.
It starts with synthetic generation in the loaded model, followed by the
1,147 scored inputs and both frozen calculator controls. The earlier GPU
cache failure and repeated control scores remain in
[step 28](../research-step-28/REPORT.md).

## Follow-up and retained failures

[FOLLOW-UP.json](FOLLOW-UP.json) verifies the paused schedule. The first pause
update was rejected because its prompt repeated operational details. A short
status prompt passed and the saved pause was verified.
[FOLLOW-UP-UPDATE.json](FOLLOW-UP-UPDATE.json) records that failure and its
resolution. Raw cloud and authorization receipts stay in local custody.

The shared program lesson is to distinguish a supported machine offering
from current launch capacity. Fresh permission checks and a supported-zone
listing establish that a request is eligible. The actual provider response
establishes capacity at the attempted time. The bounded retry window keeps
this execution constraint visible while preserving the scientific package
and earlier results.
