import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectFileReceiver } from './directFileReceiver.ts';

const attachment = { id: '123e4567-e89b-42d3-a456-426614174000', name: 'report.txt', mimeType: 'text/plain',
  size: 4, sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' };
const ticket = 'a'.repeat(43);

test('receiver acknowledges only persisted contiguous bytes and completes after digest check', async () => {
  const sent = [];
  const written = [];
  let ready = false;
  const receiver = new DirectFileReceiver(frame => { sent.push(frame); return true; },
    async () => 0,
    async (_id, offset, bytes) => { written.push([offset, bytes]); return 4; },
    async () => undefined,
    async () => undefined,
    () => { ready = true; }, () => undefined);
  await receiver.begin(attachment, ticket);
  assert.equal(sent[0].type, 'request');
  await receiver.onFrame({ type: 'data', attachmentId: attachment.id, offset: 0, bytes: 'dGVzdA==' });
  assert.deepEqual(written, [[0, 'dGVzdA==']]);
  assert.deepEqual(sent.at(-1), { type: 'ack', attachmentId: attachment.id, offset: 4 });
  await receiver.onFrame({ type: 'complete', attachmentId: attachment.id, size: 4, sha256: attachment.sha256 });
  assert.equal(ready, true);
});

test('receiver rejects duplicate blocks and aborts the temporary file', async () => {
  const aborted = [];
  const errors = [];
  const receiver = new DirectFileReceiver(() => true,
    async () => 0, async () => 4, async () => undefined,
    async id => { aborted.push(id); }, () => undefined,
    error => errors.push(error));
  await receiver.begin(attachment, ticket);
  await receiver.onFrame({ type: 'data', attachmentId: attachment.id, offset: 0, bytes: 'dGVzdA==' });
  await receiver.onFrame({ type: 'data', attachmentId: attachment.id, offset: 0, bytes: 'dGVzdA==' });
  assert.deepEqual(aborted, [attachment.id]);
  assert.equal(errors.length, 1);
});

test('receiver rejects mismatched completion digest before exposing cache', async () => {
  const aborted = [];
  let ready = false;
  const receiver = new DirectFileReceiver(() => true,
    async () => 0, async () => 4, async () => undefined,
    async id => { aborted.push(id); }, () => { ready = true; }, () => undefined);
  await receiver.begin(attachment, ticket);
  await receiver.onFrame({ type: 'data', attachmentId: attachment.id, offset: 0, bytes: 'dGVzdA==' });
  await receiver.onFrame({ type: 'complete', attachmentId: attachment.id, size: 4, sha256: '0'.repeat(64) });
  assert.equal(ready, false);
  assert.deepEqual(aborted, [attachment.id]);
});

test('receiver requests a new ticket from a preserved partial offset', async () => {
  const sent = [];
  const receiver = new DirectFileReceiver(frame => { sent.push(frame); return true; },
    async () => 2, async () => 4, async () => undefined,
    async () => undefined, () => undefined, () => undefined);
  await receiver.begin(attachment, ticket);
  assert.deepEqual(sent[0], { type: 'request', attachmentId: attachment.id, ticket, offset: 2 });
  await receiver.disconnected();
  await receiver.begin(attachment, 'b'.repeat(43));
  assert.deepEqual(sent.at(-1), { type: 'request', attachmentId: attachment.id, ticket: 'b'.repeat(43), offset: 2 });
});
