import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePairingCode } from '../src/bridge.ts';

test('accepts only a local app pairing URI and a bounded secret', () => {
  const id = '3ecc3126-67a5-4e33-bfad-f1fe2308ef9e';
  const secret = 'A'.repeat(43);
  assert.deepEqual(parsePairingCode(`harmonywork://pair?id=${id}&secret=${secret}`), { pairingId: id, secret });
  assert.throws(() => parsePairingCode(`https://evil.example/pair?id=${id}&secret=${secret}`));
  assert.throws(() => parsePairingCode(`harmonywork://evil@pair?id=${id}&secret=${secret}`));
  assert.throws(() => parsePairingCode(`harmonywork://pair:80?id=${id}&secret=${secret}`));
  assert.throws(() => parsePairingCode(`harmonywork://pair?id=${id}&secret=${secret}#extra`));
  assert.throws(() => parsePairingCode(`harmonywork://pair?id=../../api/auth/me&secret=${secret}`));
  assert.throws(() => parsePairingCode(`harmonywork://pair?id=${id}&secret=short`));
});

test('accepts the desktop copy format and query text pasted from pairing details', () => {
  const id = '3ecc3126-67a5-4e33-bfad-f1fe2308ef9e';
  const secret = 'B'.repeat(43);
  assert.deepEqual(parsePairingCode(`  harmonywork://pair?id=${id}&secret=${secret}\n`), { pairingId: id, secret });
  assert.deepEqual(parsePairingCode(`id=${id}&secret=${secret}`), { pairingId: id, secret });
  assert.deepEqual(parsePairingCode(`pairingId=${id}\nsecret=${secret}`), { pairingId: id, secret });
});

test('accepts the desktop QR on WebViews that parse custom schemes as opaque paths', () => {
  const id = '3ecc3126-67a5-4e33-bfad-f1fe2308ef9e';
  const secret = 'C'.repeat(43);
  const NativeURL = globalThis.URL;
  globalThis.URL = class LegacyWebViewURL extends NativeURL {
    constructor(input, base) {
      super(input, base);
      if (String(input).startsWith('harmonywork://')) {
        Object.defineProperty(this, 'hostname', { value: '' });
        Object.defineProperty(this, 'pathname', { value: '//pair' });
      }
    }
  };
  try {
    assert.deepEqual(parsePairingCode(`harmonywork://pair?id=${id}&secret=${secret}`), { pairingId: id, secret });
  } finally {
    globalThis.URL = NativeURL;
  }
});
