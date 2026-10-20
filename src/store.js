import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { required } from './config.js';
export const mongo = new MongoClient(required('MONGODB_URI'), { serverSelectionTimeoutMS: 10000 });
export let db;
export async function connect() {
  await mongo.connect();
  db = mongo.db(process.env.MONGODB_DATABASE || 'krispies_hr');
  await db.collection('pending').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
export async function staff(user) {
  await db.collection('staff').updateOne({ _id: user.robloxId }, {
    $set: { username: user.username },
    $setOnInsert: { strikes: 0, version: 0, department: 'General', events: [] },
  }, { upsert: true });
  return db.collection('staff').findOne({ _id: user.robloxId });
}
// All strike changes and audit events commit together in one atomic document update.
export async function mutate(id, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await db.collection('staff').findOne({ _id: id });
    if (!current) throw new Error('Staff record not found.');
    const { set = {}, event } = change(current);
    const result = await db.collection('staff').updateOne({ _id: id, version: current.version }, {
      $set: set, $inc: { version: 1 }, ...(event ? { $push: { events: event } } : {}),
    });
    if (result.modifiedCount) return { ...current, ...set };
  }
  throw new Error('This record is busy. Please retry.');
}
export function event(type, actorId, data = {}) {
  return { id: randomUUID(), type, actorId, at: new Date(), logStatus: 'pending', ...data };
}
export async function pending(actorId, action, data) {
  const id = randomUUID();
  await db.collection('pending').insertOne({ _id: id, actorId, action, data, expiresAt: new Date(Date.now() + 600000) });
  return id;
}
export async function consume(id, actorId) {
  const row = await db.collection('pending').findOneAndDelete({ _id: id, actorId, expiresAt: { $gt: new Date() } });
  if (!row) throw new Error('This confirmation expired, was already used, or belongs to another HR member. Run the command again.');
  return row;
}
