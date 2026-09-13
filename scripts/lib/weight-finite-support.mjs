import { canonicalQuery, SelectionHold } from './weight-query-cache.mjs';
import { stratumFor } from './weight-candidates-v2.mjs';
import { orbitKey } from './weight-selection-pilot.mjs';

// Maximum row assignment over the supplied finite roster. The caller supplies
// its completeness argument; the result describes that roster explicitly.
export function finiteSupportCapacity(records, slices, { orbitRestricted = true } = {}) {
  if (!Array.isArray(records) || records.length > 1000 || !slices.length || slices.length > 8)
    throw new SelectionHold('finite_roster_size_limit');
  const quotas = new Map();
  for (const slice of slices) {
    const key = `${slice.desired}|${slice.status}`;
    if (!['0','1','2-7','8-31'].includes(slice.desired) ||
      !['dominant','non_dominant'].includes(slice.status) || quotas.has(key) ||
      !Number.isSafeInteger(slice.required) || slice.required <= 0 || slice.required > 100000)
      throw new SelectionHold('invalid_finite_quota');
    quotas.set(key, slice.required);
  }
  const queries = new Map(); const units = new Map(); const unitValues = new Map();
  for (const candidate of records) {
    const key = canonicalQuery(candidate); const value = candidate.multiplicity;
    if (!['dominant','non_dominant'].includes(candidate.target_status) ||
      candidate.target_weight.some(v => v < 0) !== (candidate.target_status === 'non_dominant'))
      throw new SelectionHold('finite_target_status_differs');
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 4096)
      throw new SelectionHold('invalid_finite_label');
    if (queries.has(key) && queries.get(key) !== value) throw new SelectionHold('conflicting_finite_label');
    queries.set(key, value);
    const unit = orbitRestricted ? orbitKey(candidate) : key;
    if (unitValues.has(unit) && unitValues.get(unit) !== value) throw new SelectionHold('conflicting_orbit_label');
    unitValues.set(unit, value);
    const slice = `${stratumFor(value)}|${candidate.target_status}`;
    if (quotas.has(slice)) {
      if (!units.has(unit)) units.set(unit, new Set());
      units.get(unit).add(slice);
    }
  }
  const assigned = new Map([...quotas.keys()].map(key => [key, []]));
  function place(unit, visited) {
    if (visited.has(unit)) return false;
    visited.add(unit);
    for (const slice of units.get(unit)) {
      const occupants = assigned.get(slice);
      if (occupants.length < quotas.get(slice)) { occupants.push(unit); return true; }
      for (let index = 0; index < occupants.length; index += 1) {
        if (place(occupants[index], visited)) { occupants[index] = unit; return true; }
      }
    }
    return false;
  }
  let maximum = 0;
  for (const unit of units.keys()) if (place(unit, new Set())) maximum += 1;
  const required = [...quotas.values()].reduce((sum, n) => sum + n, 0);
  return { scope: 'supplied_finite_roster', status: maximum < required ? 'quota_unreachable' : 'quota_assignment_exists',
    roster_rows: records.length, unique_queries: queries.size, eligible_selection_units: units.size,
    required_rows: required, maximum_assignable_rows: maximum,
    slices: [...quotas].map(([id, count]) => ({ id, required: count, assigned: assigned.get(id).length })) };
}
