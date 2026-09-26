"""Small, auditable SPO mechanics for a binary-reward categorical decision.

This is an algorithm adapter, not an LLM trainer. A future FERAL runner supplies
policy probabilities, sampled selections, and resolver-verified rewards. Labels
belong to that runner's evaluator and never enter the policy input.
"""

import argparse
import json
import math
from pathlib import Path


RHO_MIN = 0.875
RHO_MAX = 0.96
WARM_SAMPLES = 8
CLIP_LOW = 0.2
CLIP_HIGH = 0.28


def _probabilities(values):
    if not values or any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError("policy probabilities must be finite and nonnegative")
    if not math.isclose(sum(values), 1.0, rel_tol=0, abs_tol=1e-9):
        raise ValueError("policy probabilities must sum to one")
    return values


def kl_divergence(previous, current):
    """D(current || previous), over the same ordered action roster."""
    _probabilities(previous)
    _probabilities(current)
    if len(previous) != len(current):
        raise ValueError("policy action rosters differ")
    if any(old == 0 and new > 0 for old, new in zip(previous, current)):
        return math.inf
    return sum(new * math.log(new / old) for old, new in zip(previous, current) if new)


def discount(kl, half_life):
    if kl < 0 or math.isnan(kl) or not math.isfinite(half_life) or half_life <= 0:
        raise ValueError("KL and half life must be valid")
    return min(RHO_MAX, max(RHO_MIN, 2 ** (-kl / half_life)))


class BetaTracker:
    def __init__(self, warm_rewards, policy):
        if len(warm_rewards) != WARM_SAMPLES or any(r not in (0, 1) for r in warm_rewards):
            raise ValueError("eight binary warm-start rewards required")
        self.last_policy = tuple(_probabilities(policy))
        value = sum(warm_rewards) / WARM_SAMPLES
        size = 1 / (1 - RHO_MIN)
        self.alpha = size * value
        self.beta = size * (1 - value)
        self.rollouts = WARM_SAMPLES

    @property
    def value(self):
        return self.alpha / (self.alpha + self.beta)

    def observe(self, reward, current_policy, half_life):
        if reward not in (0, 1):
            raise ValueError("binary reward required")
        current_policy = tuple(_probabilities(current_policy))
        prior = self.value
        kl = kl_divergence(self.last_policy, current_policy)
        rho = discount(kl, half_life)
        self.alpha = rho * self.alpha + reward
        self.beta = rho * self.beta + (1 - reward)
        self.last_policy = current_policy
        self.rollouts += 1
        return {"pre_update_baseline": prior, "advantage": reward - prior,
                "kl": kl, "rho": rho, "post_update_baseline": self.value}


def prompt_weight(value):
    if not 0 <= value <= 1:
        raise ValueError("tracker value must be a probability")
    return math.sqrt(value * (1 - value)) + 0.05


def global_advantages(raw):
    if not raw or any(not math.isfinite(v) for v in raw):
        raise ValueError("finite batch advantages required")
    mean = sum(raw) / len(raw)
    variance = sum((v - mean) ** 2 for v in raw) / len(raw)
    if variance <= 1e-24:
        return [0.0] * len(raw)
    scale = math.sqrt(variance)
    return [(v - mean) / scale for v in raw]


def clipped_objective(ratio, advantage):
    if not math.isfinite(ratio) or ratio < 0 or not math.isfinite(advantage):
        raise ValueError("finite ratio and advantage required")
    clipped = min(1 + CLIP_HIGH, max(1 - CLIP_LOW, ratio))
    return min(ratio * advantage, clipped * advantage)


def accept_rollouts(rows):
    """Record every attempt; use only completed, resolver-verified rewards."""
    used = []
    counts = {"attempted": 0, "accepted": 0, "failed": 0, "rejected": 0}
    for row in rows:
        counts["attempted"] += 1
        status = row["status"]
        if status == "accepted":
            if row.get("reward") not in (0, 1) or not row.get("resolver_verified"):
                raise ValueError("accepted rollout needs verified binary reward")
            used.append(row)
            counts["accepted"] += 1
        elif status in ("failed", "rejected"):
            counts[status] += 1
        else:
            raise ValueError("unknown rollout status")
    return used, counts


def replay(payload):
    """Apply a recorded stream with one frozen policy per accepted batch."""
    half_life = payload["kl_half_life"]
    trackers = {}
    warm_cost = 0
    for prompt in payload["prompts"]:
        key = prompt["id"]
        if key in trackers:
            raise ValueError("duplicate prompt id")
        trackers[key] = BetaTracker(prompt["warm_rewards"], prompt["initial_policy"])
        warm_cost += WARM_SAMPLES
    batches = []
    total = {"warm_start": warm_cost, "attempted": 0, "accepted": 0,
             "failed": 0, "rejected": 0}
    for batch in payload["batches"]:
        accepted, counts = accept_rollouts(batch)
        prompt_ids = [row["prompt_id"] for row in accepted]
        if len(prompt_ids) != len(set(prompt_ids)):
            raise ValueError("one accepted rollout per prompt per batch required")
        for key in counts:
            total[key] += counts[key]
        observations = []
        for row in accepted:
            if row["prompt_id"] not in trackers:
                raise ValueError("unknown prompt id")
            observation = trackers[row["prompt_id"]].observe(
                row["reward"], row["policy"], half_life)
            observations.append({"prompt_id": row["prompt_id"], **observation})
        normalized = global_advantages([row["advantage"] for row in observations]) if observations else []
        for row, advantage in zip(observations, normalized):
            row["normalized_advantage"] = advantage
        batches.append({"counts": counts, "observations": observations})
    return {"schema": "ilxyr.spo_pilot_replay.v1", "cost_rollouts": total,
            "batches": batches,
            "prompt_weights": {key: prompt_weight(tracker.value)
                               for key, tracker in trackers.items()}}


def readiness(evidence):
    """A missing or failing gate yields a measured no-go receipt."""
    required = ("learned_candidate", "verified_binary_reward", "heldout_family_split",
                "learned_gain_over_control", "frozen_matched_budget")
    count = evidence.get("training_prompts", 0)
    if type(count) is not int or count < 0:
        raise ValueError("training prompt count must be a nonnegative integer")
    gates = {key: evidence.get(key) is True for key in required}
    return {"schema": "ilxyr.spo_pilot_readiness.v1",
            "decision": "ready" if all(gates.values()) else "no_go",
            "gates": gates, "missing": [key for key, passed in gates.items() if not passed],
            "paper_warm_start_rollouts_per_prompt": WARM_SAMPLES,
            "minimum_warm_start_rollouts": WARM_SAMPLES * count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--readiness", type=Path)
    mode.add_argument("--replay", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    receipt = (readiness(json.loads(args.readiness.read_text())) if args.readiness else
               replay(json.loads(args.replay.read_text())))
    content = json.dumps(receipt, indent=2) + "\n"
    if args.output:
        args.output.write_text(content)
    else:
        print(content, end="")


if __name__ == "__main__":
    main()
