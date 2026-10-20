export const TERMINATION_WARNING = 'TERMINATION REQUIRED: Staff member has reached 5 strikes.';
export function activeLoa(staff, start = new Date(), end = start) {
  return (staff.events || []).some(e => e.type === 'loa' && e.source === 'series' && e.status === 'approved'
    && new Date(e.start) <= end && new Date(e.end) >= start);
}
export function consequenceAllowed(staff, quota, start, end) {
  if (staff.terminatedAt) throw new Error('This staff record is terminated. Further consequences are blocked.');
  if (staff.strikes >= 5) throw new Error(TERMINATION_WARNING);
  if (quota && activeLoa(staff, start, end)) throw new Error('Approved LOA overlaps this quota period. No quota consequence issued.');
}
export function validatePeriod(start, end) {
  const a = new Date(start), b = new Date(end);
  if (!Number.isFinite(+a) || !Number.isFinite(+b) || b <= a) throw new Error('Use valid ISO dates; the end must be after the start.');
  return { start: a, end: b };
}
export function evaluate(requirements, metrics) {
  return requirements.map(({ metric, target }) => {
    const actual = metrics[metric];
    if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0) throw new Error(`Series did not return a valid value for ${metric}. No failure inferred.`);
    return { metric, target, actual, complete: actual >= target };
  });
}
