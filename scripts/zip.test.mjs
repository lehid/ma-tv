import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipStore, crc32 } from './lib/zip.mjs';

test('crc32 de référence', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zipStore : en-têtes locaux, répertoire central et fin cohérents', () => {
  const files = [['a.txt', Buffer.from('bonjour')], ['dir/é.json', Buffer.from('{}')]];
  const z = zipStore(files);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  assert.equal(z.readUInt16LE(end + 10), 2);
  const cdOffset = z.readUInt32LE(end + 16);
  assert.equal(z.readUInt32LE(cdOffset), 0x02014b50);
  assert.equal(cdOffset + z.readUInt32LE(end + 12), end);
  // Le contenu du premier fichier suit son en-tête local, non compressé.
  assert.equal(z.subarray(30 + 5, 30 + 5 + 7).toString(), 'bonjour');
});
