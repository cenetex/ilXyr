// Candidate and batch rules copied from the frozen phase 1 source.
// scripts/test-weight-selection-pilot.mjs verifies every copied byte.

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const randomInteger = (random, maximum) =>
  maximum <= 1 ? 0 : Math.floor(random() * maximum);

const weakComposition = (total, length, random, balanced = false) => {
  const output = Array(length).fill(0);
  if (balanced) {
    const base = Math.floor(total / length);
    output.fill(base);
    total -= base * length;
  }
  for (let index = 0; index < total; index += 1)
    output[randomInteger(random, length)] += 1;
  return output;
};


const stratumFor = (multiplicity) => {
  const value = BigInt(multiplicity);
  if (value === 0n) return "0";
  if (value === 1n) return "1";
  if (value <= 7n) return "2-7";
  if (value <= 31n) return "8-31";
  return ">31";
};

const subtractRootCombination = (highest, cartan, coefficient) =>
  highest.map((value, row) => value - coefficient.reduce(
    (sum, amount, column) => sum + cartan[row][column] * amount,
    0,
  ));

const reflect = (weight, coefficient, cartan, simple) => {
  const pairing = weight[simple];
  const reflectedWeight = weight.map(
    (value, row) => value - pairing * cartan[row][simple],
  );
  const reflectedCoefficient = [...coefficient];
  reflectedCoefficient[simple] += pairing;
  return { weight: reflectedWeight, coefficient: reflectedCoefficient };
};

const reflectWeight = (weight, cartan, simple) => {
  const pairing = weight[simple];
  return weight.map((value, row) => value - pairing * cartan[row][simple]);
};

const orientDominant = (weight, coefficient, cartan) => {
  let state = { weight: [...weight], coefficient: [...coefficient] };
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const simple = state.weight.findIndex((value) => value < 0);
    if (simple < 0) return state;
    state = reflect(state.weight, state.coefficient, cartan, simple);
  }
  return null;
};

const antiDominant = (highest, cartan) => {
  let state = { weight: [...highest], coefficient: Array(highest.length).fill(0) };
  for (let iteration = 0; iteration < 4096; iteration += 1) {
    const simple = state.weight.findIndex((value) => value > 0);
    if (simple < 0) return state;
    state = reflect(state.weight, state.coefficient, cartan, simple);
  }
  return null;
};

const makeNonDominant = (dominant, cartan, random) => {
  let state = { weight: [...dominant.weight], coefficient: [...dominant.coefficient] };
  const steps = 1 + randomInteger(random, 3);
  for (let step = 0; step < steps; step += 1) {
    const choices = state.weight
      .map((value, index) => value > 0 ? index : -1)
      .filter((index) => index >= 0);
    if (choices.length === 0) break;
    state = reflect(
      state.weight,
      state.coefficient,
      cartan,
      choices[randomInteger(random, choices.length)],
    );
  }
  return state.weight.some((value) => value < 0) ? state : null;
};

const queryKey = (type, highest, target) =>
  `${type}\t${highest.join(",")}\t${target.join(",")}`;


const prepareRepresentations = (manifest, rootSystems) => manifest.representations.map((entry) => {
  const system = rootSystems.systems[entry.canonical_type];
  if (!system) throw new Error(`missing root system ${entry.canonical_type}`);
  const anti = antiDominant(entry.highest_weight, system.cartan);
  if (!anti) throw new Error(`could not find anti-dominant endpoint for ${entry.canonical_id}`);
  return {
    ...entry,
    system,
    anti_coefficient: anti.coefficient,
    maximum_depth: anti.coefficient.reduce((sum, value) => sum + value, 0),
  };
});

const interiorCoefficient = (representation, desired, random) => {
  const maximum = representation.maximum_depth;
  if (maximum <= 0) return Array(representation.rank).fill(0);
  const range = desired === "8-31" ? [0.32, 0.72]
    : desired === "2-7" ? [0.08, 0.55]
      : [0.0, 0.45];
  const fraction = range[0] + (range[1] - range[0]) * random();
  if (random() < 0.7) {
    return representation.anti_coefficient.map((value) => Math.max(
      0,
      Math.round(value * fraction) + randomInteger(random, 3) - 1,
    ));
  }
  const depth = Math.max(0, Math.min(maximum,
    Math.round(maximum * fraction)));
  return weakComposition(
    depth,
    representation.rank,
    random,
    desired === "8-31",
  );
};

const exteriorCoefficient = (representation, random) => {
  const shellDepth = representation.maximum_depth + 1 + randomInteger(random, 256);
  return weakComposition(
    shellDepth,
    representation.rank,
    random,
    random() < 0.5,
  );
};

const candidateFor = (representation, desired, status, random, natural = false) => {
  const highest = representation.highest_weight;
  const cartan = representation.system.cartan;
  let coefficient;
  if (natural) {
    const draw = random();
    if (draw < 0.15) {
      coefficient = exteriorCoefficient(representation, random);
    } else if (draw < 0.3) {
      coefficient = Array(representation.rank).fill(0);
    } else {
      coefficient = interiorCoefficient(representation, "natural", random);
    }
  } else if (desired === "0") {
    coefficient = exteriorCoefficient(representation, random);
  } else if (desired === "1" && random() < 0.2) {
    let orbit = { weight: [...highest], coefficient: Array(representation.rank).fill(0) };
    const steps = 1 + randomInteger(random, representation.rank * 4 + 1);
    for (let step = 0; step < steps; step += 1) {
      const choices = orbit.weight
        .map((value, index) => value !== 0 ? index : -1)
        .filter((index) => index >= 0);
      if (!choices.length) break;
      orbit = reflect(
        orbit.weight,
        orbit.coefficient,
        cartan,
        choices[randomInteger(random, choices.length)],
      );
    }
    coefficient = orbit.coefficient;
  } else {
    coefficient = interiorCoefficient(representation, desired, random);
  }
  const target = subtractRootCombination(highest, cartan, coefficient);
  const dominant = orientDominant(target, coefficient, cartan);
  if (!dominant) return null;
  const oriented = status === "non_dominant"
    ? makeNonDominant(dominant, cartan, random)
    : dominant;
  if (!oriented) return null;
  const targetStatus = oriented.weight.some((value) => value < 0)
    ? "non_dominant" : "dominant";
  if (targetStatus !== status) return null;
  return {
    canonical_type: representation.canonical_type,
    legacy_zero_type: representation.legacy_zero_type,
    canonical_representation_id: representation.canonical_id,
    legacy_zero_representation_id: representation.legacy_zero_id,
    rank: representation.rank,
    representation_dimension: representation.representation_dimension,
    highest_weight_height: representation.highest_weight_height,
    highest_weight: [...highest],
    target_weight: oriented.weight,
    target_status: targetStatus,
    target_depth: oriented.coefficient.reduce((sum, value) => sum + value, 0),
    target_magnitude_l1: oriented.weight.reduce((sum, value) => sum + Math.abs(value), 0),
    dominant_target_key: dominant.weight.join(","),
    desired_stratum: desired,
    query_key: queryKey(representation.canonical_type, highest, oriented.weight),
  };
};

class RepresentationPicker {
  constructor(representations, seed) {
    this.random = makeRandom(seed);
    this.byType = new Map();
    for (const representation of representations) {
      const entries = this.byType.get(representation.canonical_type) ?? [];
      entries.push(representation);
      this.byType.set(representation.canonical_type, entries);
    }
    this.types = [...this.byType.keys()].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
    this.typeCursor = 0;
    this.repCursors = new Map();
  }

  eligible(representation, desired) {
    const dimension = BigInt(representation.representation_dimension);
    if (desired === "8-31") return dimension >= 32n && representation.maximum_depth >= 4;
    if (desired === "2-7") return dimension >= 4n && representation.maximum_depth >= 2;
    return true;
  }

  pick(desired, allowed = null) {
    for (let typeAttempt = 0; typeAttempt < this.types.length; typeAttempt += 1) {
      const type = this.types[this.typeCursor++ % this.types.length];
      const entries = this.byType.get(type).filter((entry) =>
        this.eligible(entry, desired) && (!allowed || allowed(entry)));
      if (!entries.length) continue;
      if (desired === "8-31") entries.sort((left, right) =>
        BigInt(left.representation_dimension) > BigInt(right.representation_dimension) ? -1 : 1);
      const cursor = this.repCursors.get(type) ?? randomInteger(this.random, entries.length);
      this.repCursors.set(type, cursor + 1);
      return entries[cursor % entries.length];
    }
    return null;
  }
}


const createCandidateBatch = ({
  picker,
  slices,
  sliceStats,
  batchSize,
  random,
  usedQueries,
  trainingOrbits,
  orbitRestricted,
  exceptionalState,
}) => {
  const candidates = [];
  let orderedSlices = slices.filter((slice) => slice.accepted < slice.required);
  if (exceptionalState && orderedSlices.length) {
    const constrainedStratum = orderedSlices[0].desired;
    orderedSlices = orderedSlices.filter(
      (slice) => slice.desired === constrainedStratum,
    );
  }
  let cursor = 0;
  let guard = 0;
  while (candidates.length < batchSize && orderedSlices.length && guard++ < batchSize * 100) {
    const slice = orderedSlices[cursor++ % orderedSlices.length];
    if (slice.accepted >= slice.required) continue;
    const allowed = exceptionalState ? (representation) =>
      exceptionalState.remaining.get(representation.canonical_id) > 0 : null;
    const representation = exceptionalState
      ? exceptionalState.pick(slice.desired, allowed)
      : picker.pick(slice.desired, allowed);
    if (!representation) continue;
    const candidate = candidateFor(
      representation,
      slice.desired,
      slice.status,
      random,
    );
    if (!candidate || usedQueries.has(candidate.query_key)) continue;
    const orbitKey = `${candidate.canonical_type}|${candidate.canonical_representation_id}|${candidate.dominant_target_key}`;
    if (orbitRestricted && trainingOrbits.has(orbitKey)) continue;
    candidate.slice = slice;
    candidate.orbit_key = orbitKey;
    if (exceptionalState) {
      candidate.balance_representation_id = representation.canonical_id;
      exceptionalState.reserve(representation.canonical_id);
    }
    candidates.push(candidate);
    usedQueries.add(candidate.query_key);
    if (orbitRestricted) trainingOrbits.add(orbitKey);
    slice.attempts += 1;
    sliceStats.total_attempts += 1;
  }
  return candidates;
};

export { fnv1a, makeRandom, queryKey, stratumFor, prepareRepresentations, candidateFor, RepresentationPicker, createCandidateBatch };
