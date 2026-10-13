import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFileFrame, validateAck, validateNextChunk, FILE_CHUNK_BYTES, FILE_WINDOW_BYTES } from './fileTransferProtocol.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';
const ticket = 'a'.repeat(43);

test('file transfer rejects forged tickets, oversized chunks, and invalid offsets', () => {
  assert.equal(parseFileFrame({ type: 'request', attachmentId: id, ticket, offset: 0 }).type, 'request');
  assert.throws(() => parseFileFrame({ type: 'request', attachmentId: id, ticket: 'short', offset: 0 }));
  assert.throws(() => parseFileFrame({ type: 'request', attachmentId: id, ticket, offset: 200 * 1024 * 1024 + 1 }));
  assert.throws(() => parseFileFrame({ type: 'data', attachmentId: id, offset: 0, bytes: 'a'.repeat(FILE_CHUNK_BYTES * 2) }));
  assert.throws(() => parseFileFrame({ type: 'complete', attachmentId: id, size: 4, sha256: 'bad' }));
});

test('only contiguous chunks and cumulative non-regressing ACKs advance transfer', () => {
  assert.equal(validateNextChunk(0, { type: 'data', attachmentId: id, offset: 0, bytes: 'dGVzdA==' }), 4);
  assert.throws(() => validateNextChunk(4, { type: 'data', attachmentId: id, offset: 0, bytes: 'dGVzdA==' }));
  assert.throws(() => validateNextChunk(4, { type: 'data', attachmentId: id, offset: 8, bytes: 'dGVzdA==' }));
  assert.equal(validateAck(4, 8, 4), 4);
  assert.throws(() => validateAck(5, 8, 4));
  assert.throws(() => validateAck(4, 8, 9));
  assert.equal(FILE_WINDOW_BYTES, 1024 * 1024);
});

test('cancellation and completion frames require bounded metadata', () => {
  assert.equal(parseFileFrame({ type: 'cancel', attachmentId: id }).type, 'cancel');
  assert.equal(parseFileFrame({ type: 'complete', attachmentId: id, size: 0, sha256: '0'.repeat(64) }).type, 'complete');
  assert.throws(() => parseFileFrame({ type: 'error', attachmentId: id, code: 'a'.repeat(1000) }));
});
