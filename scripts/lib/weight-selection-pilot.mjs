import { candidateFor, stratumFor } from './weight-candidates-v2.mjs';
import { canonicalQuery, ExactQueryCache, SelectionHold } from './weight-query-cache.mjs';

const requireValue = (ok, reason) => { if (!ok) throw new SelectionHold(reason); };
const positive = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
export const orbitKey = candidate => {
  requireValue(typeof candidate.canonical_representation_id === 'string' &&
    candidate.canonical_representation_id.startsWith(candidate.canonical_type + ':') &&
    candidate.canonical_representation_id.length <= 100 &&
    typeof candidate.dominant_target_key === 'string' && candidate.dominant_target_key.length <= 256,
  'invalid_orbit_identity');
  const coordinates = candidate.dominant_target_key.split(',');
  requireValue(coordinates.length === candidate.target_weight.length && coordinates.every(value =>
    /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value))), 'invalid_orbit_coordinates');
  return `${candidate.canonical_type}|${candidate.canonical_representation_id}|${candidate.dominant_target_key}`;
};
const fields = ['candidate_draws', 'construction_failed', 'no_representation', 'query_exclusions',
  'orbit_exclusions', 'candidates_reserved', 'candidate_evaluations', 'oracle_calls', 'oracle_failures',
  'cache_hits', 'label_matches', 'stratum_rejections', 'quota_rejections', 'accepted_rows'];
const empty = () => Object.fromEntries(fields.map(key => [key, 0]));
const describeCandidate = candidate => ({
  query_key: candidate.query_key, canonical_type: candidate.canonical_type,
  canonical_representation_id: candidate.canonical_representation_id,
  highest_weight: candidate.highest_weight, target_weight: candidate.target_weight,
  target_status: candidate.target_status, dominant_target_key: candidate.dominant_target_key,
});
const release = (candidate, state) => {
  state.usedQueries.delete(candidate.query_key);
  if (state.orbitRestricted) state.trainingOrbits.delete(candidate.orbit_key);
};

// Same ordering, draw guard, query reservations and orbit reservations as the
// source-bound createCandidateBatch. Counter hooks leave successful draws unchanged.
export function selectionBatch({ picker, slices, batchSize, random, state, bump,
  makeCandidate = candidateFor, sliceOffset = 0, onEvent = () => {}, batch = 1 }) {
  const candidates = [];
  const orderedSlices = slices.filter(slice => slice.accepted < slice.required);
  let cursor = sliceOffset; let guard = 0;
  try {
    while (candidates.length < batchSize && orderedSlices.length && guard++ < batchSize * 100) {
      const slice = orderedSlices[cursor++ % orderedSlices.length];
      if (slice.accepted >= slice.required) continue;
      bump('candidate_draws', slice);
      const representation = picker.pick(slice.desired, null);
      if (!representation) { bump('no_representation', slice); onEvent({ kind: 'draw', batch, slice_id: slice.id, outcome: 'no_representation' }); continue; }
      const candidate = makeCandidate(representation, slice.desired, slice.status, random);
      if (!candidate) { bump('construction_failed', slice); onEvent({ kind: 'draw', batch, slice_id: slice.id, outcome: 'construction_failed' }); continue; }
      candidate.query_key = canonicalQuery(candidate);
      requireValue(candidate.target_status === slice.status &&
        candidate.target_weight.some(v => v < 0) === (slice.status === 'non_dominant'), 'candidate_status_differs');
      requireValue(candidate.desired_stratum === slice.desired &&
        typeof candidate.canonical_representation_id === 'string' && candidate.canonical_representation_id.length <= 100 &&
        typeof candidate.dominant_target_key === 'string' && candidate.dominant_target_key.length <= 256,
      'candidate_selection_identity_differs');
      if (state.usedQueries.has(candidate.query_key)) { bump('query_exclusions', slice);
        onEvent({ kind: 'draw', batch, slice_id: slice.id, outcome: 'query_exclusions', candidate: describeCandidate(candidate) }); continue; }
      const orbit = orbitKey(candidate);
      if (state.orbitRestricted && state.trainingOrbits.has(orbit)) { bump('orbit_exclusions', slice);
        onEvent({ kind: 'draw', batch, slice_id: slice.id, outcome: 'orbit_exclusions', candidate: describeCandidate(candidate) }); continue; }
      candidate.slice = slice; candidate.orbit_key = orbit;
      candidates.push(candidate); state.usedQueries.add(candidate.query_key);
      if (state.orbitRestricted) state.trainingOrbits.add(orbit);
      slice.attempts += 1; bump('candidates_reserved', slice);
      onEvent({ kind: 'draw', batch, slice_id: slice.id, outcome: 'reserved', candidate: describeCandidate(candidate) });
    }
    return candidates;
  } catch (error) {
    for (const candidate of candidates) { release(candidate, state);
      onEvent({ kind: 'release', batch, query_key: candidate.query_key, reason: 'incomplete_batch_construction' }); }
    throw error;
  }
}

export async function runSelectionPilot({ picker, random, slices: requested, query,
  oracleSha256, limits, cacheLimits, orbitRestricted = true, makeCandidate = candidateFor, rotateSlices = true, onEvent = () => {} }) {
  requireValue(typeof oracleSha256 === 'string' && /^[a-f0-9]{64}$/.test(oracleSha256), 'invalid_oracle_identity');
  for (const [name, cap] of Object.entries({ maxDraws: 1000000, maxOracleCalls: 100000,
    maxEvaluations: 100000, maxBatches: 10000, batchSize: 512, maxAcceptedRows: 100000 }))
    requireValue(positive(limits[name], cap), 'invalid_pilot_limits:' + name);
  requireValue(requested.length > 0 && requested.length <= 8, 'invalid_slice_count');
  const seen = new Set();
  const slices = requested.map(slice => {
    requireValue(['0','1','2-7','8-31'].includes(slice.desired) &&
      ['dominant','non_dominant'].includes(slice.status) && positive(slice.required, 100000), 'invalid_slice');
    const id = `${slice.desired}|${slice.status}`;
    requireValue(!seen.has(id), 'duplicate_slice'); seen.add(id);
    return { ...slice, id, accepted: 0, attempts: 0 };
  });
  const cache = cacheLimits ? new ExactQueryCache({ oracleSha256, ...cacheLimits }) : null;
  const totals = empty(); const bySlice = Object.fromEntries(slices.map(s => [s.id, empty()]));
  const state = { usedQueries: new Set(), trainingOrbits: new Set(), orbitRestricted };
  const accepted = []; const evaluations = []; const checkpoints = [];
  const bump = (field, slice) => {
    if (field === 'candidate_draws' && totals.candidate_draws >= limits.maxDraws)
      throw new SelectionHold('candidate_draw_limit');
    totals[field] += 1; bySlice[slice.id][field] += 1;
  };
  let hold = null; let pending = []; let batches = 0;
  let previous = structuredClone(bySlice);
  const checkpoint = () => {
    checkpoints.push({ batch: batches, accepted_rows: accepted.length, slices: slices.map(slice => {
      const current = bySlice[slice.id]; const delta = Object.fromEntries(fields.map(key => [key, current[key] - previous[slice.id][key]]));
      const remaining = slice.required - slice.accepted;
      return { id: slice.id, accepted: slice.accepted, remaining, ...delta,
        new_rows_per_draw: delta.candidate_draws ? delta.accepted_rows / delta.candidate_draws : null,
        calls_for_remaining_at_block_rate: delta.accepted_rows > 0 && delta.oracle_calls > 0
          ? Math.ceil(remaining * delta.oracle_calls / delta.accepted_rows) : null };
    }) });
    previous = structuredClone(bySlice);
    onEvent({ kind: 'checkpoint', ...checkpoints.at(-1) });
  };
  try {
    while (slices.some(slice => slice.accepted < slice.required)) {
      requireValue(batches < limits.maxBatches, 'batch_limit');
      requireValue(accepted.length < limits.maxAcceptedRows, 'pilot_occupancy_limit');
      pending = selectionBatch({ picker, slices, batchSize: limits.batchSize, random, state, bump, makeCandidate,
        sliceOffset: rotateSlices ? batches % slices.filter(slice => slice.accepted < slice.required).length : 0,
        onEvent, batch: batches + 1 });
      batches += 1;
      requireValue(pending.length > 0, 'candidate_generation_exhausted');
      const results = [];
      for (const candidate of pending) {
        requireValue(totals.candidate_evaluations < limits.maxEvaluations, 'evaluation_limit');
        const saved = cache?.get(candidate, oracleSha256);
        let value; let sourceSequence;
        if (saved) {
          value = saved.multiplicity; sourceSequence = saved.source_query_sequence;
          bump('cache_hits', candidate.slice);
        } else {
          requireValue(totals.oracle_calls < limits.maxOracleCalls, 'oracle_call_limit');
          cache?.requireRoom(candidate, oracleSha256);
          bump('oracle_calls', candidate.slice); sourceSequence = totals.oracle_calls;
          let result;
          try { result = await query(candidate, sourceSequence); }
          catch (error) {
            bump('oracle_failures', candidate.slice);
            evaluations.push({ query_key: candidate.query_key, slice_id: candidate.slice.id,
              source: 'oracle', source_query_sequence: sourceSequence, status: 'failed', reason: error.reason ?? error.message });
            onEvent({ kind: 'evaluation', batch: batches, ...evaluations.at(-1) });
            throw new SelectionHold('oracle_failure');
          }
          if (result.status !== 'ok' || typeof result.multiplicity !== 'string' ||
            !/^(0|[1-9][0-9]*)$/.test(result.multiplicity) || result.multiplicity.length > (cache?.maxValueBytes ?? 4096)) {
            bump('oracle_failures', candidate.slice);
            evaluations.push({ query_key: candidate.query_key, slice_id: candidate.slice.id,
              source: 'oracle', source_query_sequence: sourceSequence, status: 'failed', reason: 'invalid_oracle_result' });
            onEvent({ kind: 'evaluation', batch: batches, ...evaluations.at(-1) });
            throw new SelectionHold('invalid_oracle_result');
          }
          value = result.multiplicity;
          cache?.put(candidate, oracleSha256, value, sourceSequence);
        }
        bump('candidate_evaluations', candidate.slice);
        const observed = stratumFor(value);
        const record = { query_key: candidate.query_key, slice_id: candidate.slice.id,
          source: saved ? 'cache' : 'oracle', source_query_sequence: sourceSequence,
          multiplicity: value, observed_stratum: observed, status: 'ok', disposition: 'pending_batch' };
        evaluations.push(record); results.push({ value, observed, record });
        onEvent({ kind: 'evaluation', batch: batches, ...record });
      }
      for (let index = 0; index < pending.length; index += 1) {
        const candidate = pending[index]; const { value, observed, record } = results[index];
        const slice = candidate.slice;
        if (observed === slice.desired) bump('label_matches', slice);
        if (observed !== slice.desired || slice.accepted >= slice.required) {
          const field = observed !== slice.desired ? 'stratum_rejections' : 'quota_rejections';
          bump(field, slice); release(candidate, state); record.disposition = field;
          onEvent({ kind: 'selection', batch: batches, query_key: candidate.query_key, outcome: field });
          continue;
        }
        if (accepted.length >= limits.maxAcceptedRows) {
          onEvent({ kind: 'selection', batch: batches, query_key: candidate.query_key, outcome: 'occupancy_limit' });
          throw new SelectionHold('pilot_occupancy_limit');
        }
        slice.accepted += 1; bump('accepted_rows', slice); record.disposition = 'accepted';
        accepted.push({ query_key: candidate.query_key, orbit_key: candidate.orbit_key,
          canonical_type: candidate.canonical_type, highest_weight: [...candidate.highest_weight],
          target_weight: [...candidate.target_weight], target_status: candidate.target_status,
          multiplicity: value, slice_id: slice.id, source_query_sequence: record.source_query_sequence });
        onEvent({ kind: 'selection', batch: batches, query_key: candidate.query_key, outcome: 'accepted' });
      }
      pending = []; checkpoint();
    }
  } catch (error) {
    if (!(error instanceof SelectionHold)) throw error;
    hold = error.reason;
    onEvent({ kind: 'hold', batch: batches, reason: hold });
    const committed = new Set(accepted.map(row => row.query_key));
    for (const candidate of pending) if (!committed.has(candidate.query_key) && state.usedQueries.has(candidate.query_key)) {
      release(candidate, state); onEvent({ kind: 'release', batch: batches, query_key: candidate.query_key, reason: 'incomplete_batch' });
    }
    for (const evaluation of evaluations) if (evaluation.disposition === 'pending_batch') evaluation.disposition = 'uncommitted_at_hold';
    checkpoint();
  }
  return { schema: 'ilxyr.weight_selection_pilot.v1', status: hold ? 'hold' : 'requested_quotas_reached', hold,
    oracle_sha256: oracleSha256, mode: cache ? 'cached' : 'uncached_control',
    scheduling: rotateSlices ? 'rotate_unfinished_slices_each_batch' : 'original_fixed_start',
    limits, totals, by_slice: bySlice, slices, cache: cache?.snapshot() ?? null,
    selected_queries: state.usedQueries.size, selected_orbits: state.trainingOrbits.size,
    candidate_support: { status: 'unknown', reason: 'Sampling observations cover proposed candidates; complete reachable support requires a separate finite roster.' },
    projection_scope: 'Observed block rates only. Adaptive selection and cache occupancy require a new prospective budget study.',
    checkpoints, accepted, evaluations };
}
