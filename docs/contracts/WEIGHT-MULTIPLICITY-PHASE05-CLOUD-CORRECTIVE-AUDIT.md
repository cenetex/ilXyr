# Phase 0.5 cloud corrective audit

This audit corrects three narrow evidence gaps. It does not reopen Phase 1 and
does not authorize a corpus or model training.

## Exactness labels

An observed multiplicity disagreement is an exactness failure. A complete
replay with different response bytes is also an exactness failure. An
incomplete replay is not evidence that an answer was wrong: exactness is
unknown for that replay and the representation fails the time gate.

The append-only correction is bound to cloud run `33329981839`. It must change
only the two frozen false labels, `B6:0,0,1,2,1,0` and `F4:0,2,5,0`, from
`exactness_fail` to `time_fail`. The original result remains unchanged.

## Allocator policy

The allocator check reruns five representations selected from the safe prefix
of the earlier local result. Each representation uses the exact Linux Zero
executable from cloud run `33329981839`, the same c6i.4xlarge instance type,
the same generated targets, and the same ascending target order. The only
experimental change is memo-table initialization: default capacity 1,024
versus presized capacity 8,388,608.

Linux `/proc` high-water memory is read immediately before a timed-out process
is killed. This is an exact high-water observation up to the hard timeout. If
the value is below two GiB, it does not claim that an unbounded query would
remain below two GiB.

The comparison can show that the observed boundary depends on allocator
policy. It cannot turn the old local run into a cloud measurement or establish
a universal memory ceiling across operating systems.

## Independent witness

The frozen 496 LiE Version 3 cases are rebound without changing a case to the
exact Linux executable from cloud run `33329981839`. Any disagreement,
timeout, process error, or parse error is Hold. LiE remains a temporary
independent witness, not a product dependency.

## Cost and stop conditions

The cloud run has a fresh hard EC2 ceiling of $0.50 on one c6i.4xlarge. It
stops on any LiE disagreement or allocator answer disagreement. The run may
produce only the correction record, allocator evidence, LiE evidence,
identity records, logs, and checksums.
