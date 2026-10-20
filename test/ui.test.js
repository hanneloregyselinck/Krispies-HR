import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModalBuilder } from 'discord.js';
import { commands } from '../src/commands.js';
import { verificationModal, history, textPayload } from '../src/ui.js';
test('all slash commands serialize and use guild-only permissions', () => {
  for (const c of commands) {
    const json = c.toJSON();
    assert.equal(json.dm_permission, false);
    assert.ok(json.default_member_permissions);
  }
  assert.equal(new Set(commands.map(c => c.name)).size, commands.length);
  assert.ok(commands.some(c => c.name === 'robloxlookup'));
});
test('verification modal has four required text inputs and one optional upload', () => {
  const json = new ModalBuilder(verificationModal()).toJSON();
  assert.equal(json.components.length, 5);
  assert.deepEqual(json.components.slice(0, 4).map(c => c.component.custom_id), ['username', 'rank', 'timezone', 'invited']);
  assert.ok(json.components.slice(0, 4).every(c => c.component.required));
  assert.equal(json.components[4].component.type, 19);
  assert.equal(json.components[4].component.required, false);
});
test('staff history paginates without omitting older records', () => {
  const s = { _id: '1', username: 'Example', strikes: 5, events: Array.from({ length: 11 }, (_, n) => ({
    id: String(n), type: 'consequence', actorId: '123', reason: 'test', at: new Date(), strikes: 1,
  })) };
  assert.equal(history(s, 0).embeds[0].toJSON().fields.length, 5);
  assert.equal(history(s, 2).embeds[0].toJSON().fields.length, 1);
  assert.match(history(s, 0).embeds[0].toJSON().description, /TERMINATION REQUIRED/);
});
test('large reports retain full contents in an attachment', () => {
  const payload = textPayload('x'.repeat(9000));
  assert.equal(payload.embeds[0].toJSON().description.length, 4000);
  assert.equal(payload.files[0].attachment.length, 9000);
});
