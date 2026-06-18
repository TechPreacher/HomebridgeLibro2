const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');

const { PetLibroPlatform } = require('..')._test;

function tmpStorage() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petlibro-token-'));
}

function tokenFileFor(storagePath, email) {
  const hash = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
  return path.join(storagePath, `petlibro-token-${hash}.json`);
}

function makeStubLog() {
  const log = function () {};
  log.info = function () {};
  log.warn = function () {};
  log.error = function () {};
  log.debug = function () {};
  return log;
}

function makeApi(storagePath) {
  return {
    on() {},
    hap: { Service: {}, Characteristic: {}, uuid: { generate: (s) => 'uuid:' + s } },
    platformAccessory: function () {},
    user: { storagePath: () => storagePath }
  };
}

function makePlatform(storagePath, config = {}) {
  return new PetLibroPlatform(
    makeStubLog(),
    { email: 'roundtrip@example.com', password: 'p', ...config },
    makeApi(storagePath)
  );
}

test('persistToken writes a 0600-mode JSON file containing token + expiry', () => {
  const storage = tmpStorage();
  const platform = makePlatform(storage);
  platform.accessToken = 'persisted-token';
  platform.tokenExpiry = Date.now() + 3_600_000;

  platform.persistToken();

  const file = tokenFileFor(storage, 'roundtrip@example.com');
  assert.ok(fs.existsSync(file), 'token file should exist');

  const stat = fs.statSync(file);
  // Mask permission bits; expect rw for owner only
  assert.equal(stat.mode & 0o777, 0o600, 'file mode must be 0600');

  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(payload.token, 'persisted-token');
  assert.equal(typeof payload.expiry, 'number');
});

test('loadPersistedToken restores a valid, future-dated token on construction', () => {
  const storage = tmpStorage();
  const email = 'roundtrip@example.com';
  const future = Date.now() + 3_600_000;
  fs.writeFileSync(
    tokenFileFor(storage, email),
    JSON.stringify({ token: 'cached-token', expiry: future })
  );

  const platform = makePlatform(storage);

  assert.equal(platform.accessToken, 'cached-token');
  assert.equal(platform.tokenExpiry, future);
});

test('loadPersistedToken ignores an expired token', () => {
  const storage = tmpStorage();
  const email = 'roundtrip@example.com';
  fs.writeFileSync(
    tokenFileFor(storage, email),
    JSON.stringify({ token: 'stale-token', expiry: Date.now() - 60_000 })
  );

  const platform = makePlatform(storage);

  assert.equal(platform.accessToken, null);
  assert.equal(platform.tokenExpiry, null);
});

test('loadPersistedToken ignores a token expiring within 60s', () => {
  const storage = tmpStorage();
  const email = 'roundtrip@example.com';
  fs.writeFileSync(
    tokenFileFor(storage, email),
    JSON.stringify({ token: 'near-expiry', expiry: Date.now() + 30_000 })
  );

  const platform = makePlatform(storage);

  assert.equal(platform.accessToken, null, 'token within 60s of expiry should not be loaded');
});

test('loadPersistedToken falls back silently on corrupt JSON', () => {
  const storage = tmpStorage();
  const email = 'roundtrip@example.com';
  fs.writeFileSync(tokenFileFor(storage, email), '{ not valid json');

  // Must not throw
  const platform = makePlatform(storage);

  assert.equal(platform.accessToken, null);
  assert.equal(platform.tokenExpiry, null);
});

test('loadPersistedToken does nothing when no file exists', () => {
  const storage = tmpStorage();
  const platform = makePlatform(storage);

  assert.equal(platform.accessToken, null);
  assert.equal(platform.tokenExpiry, null);
});

test('resolveTokenFilePath returns null when api.user.storagePath is unavailable', () => {
  // No `user` on api → no persistence
  const platform = new PetLibroPlatform(
    makeStubLog(),
    { email: 'x@y.com', password: 'p' },
    { on() {}, hap: { Service: {}, Characteristic: {}, uuid: { generate: () => 'u' } }, platformAccessory: function () {} }
  );
  assert.equal(platform.tokenFilePath, null);
  // Must not throw on persist/load when path is unavailable
  platform.persistToken();
  platform.loadPersistedToken();
});

test('authenticate() persists the freshly-obtained token to disk', async (t) => {
  const storage = tmpStorage();
  const platform = makePlatform(storage);

  t.mock.method(axios, 'post', async (url) => {
    if (url.endsWith('/member/auth/login')) {
      return {
        status: 200,
        data: { code: 0, data: { token: 'brand-new-token', expires_in: 3600 } }
      };
    }
    throw new Error('Unexpected URL ' + url);
  });

  await platform.authenticate();

  const file = tokenFileFor(storage, 'roundtrip@example.com');
  assert.ok(fs.existsSync(file));
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(payload.token, 'brand-new-token');
});

test('different emails produce different filenames (multi-account safety)', () => {
  const storage = tmpStorage();
  const a = makePlatform(storage, { email: 'first@example.com' });
  const b = makePlatform(storage, { email: 'second@example.com' });
  assert.notEqual(a.tokenFilePath, b.tokenFilePath);
});

test('email hash does not appear in plaintext in filename', () => {
  const storage = tmpStorage();
  const email = 'private-account@example.com';
  const platform = makePlatform(storage, { email });
  assert.ok(!platform.tokenFilePath.includes(email), 'email must be hashed, not in filename');
});
