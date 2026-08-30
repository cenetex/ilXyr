# Symmetry-informed proposal drafts

These are proposal inputs, not claims that exceptional mathematics automatically improves neural
networks. The useful research idea is narrower: regular transformations should be handled by a
shared rule, while irreducible residual cases may deserve explicit capacity. Each proposal must
beat ordinary, capacity-matched controls.

- `zero-orbit-quotient.proposal.json` tests a canonical-representative curriculum. This is the most
  direct use of symmetry: quotient known transformations out of the training distribution, then
  test held-out representatives and new compositions.
- `solomon-e8-codebook.proposal.json` tests E8 only in eight-dimensional quantization blocks, where
  its lattice geometry is relevant. Learned, cubic, and rate-matched controls prevent “E8” from
  becoming a decorative label.
- `zero-exception-routing.proposal.json` tests a family-plus-exception architecture under fixed
  active capacity. It borrows the classification shape without claiming that the learned
  exceptions are literal sporadic groups.

Moonshine suggests a different research habit: take unlikely cross-domain numerical or
representational coincidences seriously enough to test, but pre-register the search space and
null distribution first. Without that protection, “moonshine for ML” is mostly a recipe for
multiple-comparisons errors. It is not included here as a training intervention until a concrete,
falsifiable bridge is specified.

Submit a draft with:

```bash
ilxyr proposal-submit WORKSPACE examples/proposals/zero-orbit-quotient.proposal.json
```

Use the returned artifact reference in `proposal_review.proposal_ref`. Revisions increment
`revision` and point `predecessor_ref` at the prior exact artifact. A current independent review is
required again after every revision.
