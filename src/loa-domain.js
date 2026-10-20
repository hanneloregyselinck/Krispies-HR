import { createHash } from 'node:crypto';
import { validatePeriod } from './domain.js';
export const loaKey = id => createHash('sha256').update(id).digest('hex').slice(0, 32);
export function normalizeLoa(raw) {
  if (!raw || typeof raw.requestId !== 'string' || !raw.requestId.trim() || raw.requestId.length > 500
    || !/^\d+$/.test(String(raw.robloxId)) || !/^[A-Za-z0-9_]{3,20}$/.test(raw.username || '')
    || !['pending', 'approved', 'denied', 'cancelled'].includes(raw.status)
    || typeof raw.version !== 'string' || !raw.version) throw new Error('Series returned an invalid LOA request.');
  const period = validatePeriod(raw.start, raw.end);
  return { requestId: raw.requestId, robloxId: String(raw.robloxId), username: raw.username,
    start: period.start, end: period.end, reason: String(raw.reason || 'Not provided').slice(0, 1000),
    status: raw.status, version: raw.version, decisionReason: String(raw.decisionReason || '').slice(0, 1000),
    reviewedBy: raw.reviewedBy ? String(raw.reviewedBy) : null,
    operationId: raw.operationId ? String(raw.operationId) : null };
}
export function reviewIntent(decision, reason) {
  if (!['approved', 'denied'].includes(decision)) throw new Error('Invalid LOA decision.');
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw new Error('Enter a decision reason between 1 and 1000 characters.');
  return { decision, reason: reason.trim() };
}
