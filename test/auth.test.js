const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');

const { PetLibroPlatform } = require('..')._test;

// Minimal Homebridge API stub. The plugin only touches `api.on(...)` during
// construction, so anything else can stay empty.
function makeStubApi() {
  return {
    on() {},
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: (s) => 'uuid:' + s }
    },
    platformAccessory: function () {}
  };
}

// Logger stub: callable + .info/.warn/.error/.debug, all no-ops.
function makeStubLog() {
  const log = function () {};
  log.info = log;
  log.warn = log;
  log.error = log;
  log.debug = log;
  return log;
}

function makePlatform(config = {}) {
  return new PetLibroPlatform(
    makeStubLog(),
    { email: 'user@example.com', password: 'hunter2', ...config },
    makeStubApi()
  );
}

test('hashPassword: MD5 of known fixture matches RFC 1321 vector', () => {
  const platform = makePlatform();
  // md5("password") per RFC 1321
  assert.equal(platform.hashPassword('password'), '5f4dcc3b5aa765d61d8327deb882cf99');
  // md5("") empty string
  assert.equal(platform.hashPassword(''), 'd41d8cd98f00b204e9800998ecf8427e');
});

test('hashPassword: matches node crypto MD5', () => {
  const platform = makePlatform();
  const pw = 'C0mpl3x!Pass';
  const expected = crypto.createHash('md5').update(pw).digest('hex');
  assert.equal(platform.hashPassword(pw), expected);
});

test('apiPost: code 1009 triggers re-auth + retry, rotates token', async (t) => {
  const platform = makePlatform();
  // Pre-seed a valid-looking token so ensureAuthenticated() is a no-op on entry
  platform.accessToken = 'stale-token';
  platform.tokenExpiry = Date.now() + 60_000;

  const calls = [];
  t.mock.method(axios, 'post', async (url, body, opts) => {
    calls.push({ url, body, token: opts && opts.headers && opts.headers.token });

    if (url.endsWith('/device/device/list') && calls.filter(c => c.url.endsWith('/device/device/list')).length === 1) {
      return { status: 200, data: { code: 1009, msg: 'NOT_YET_LOGIN' } };
    }
    if (url.endsWith('/member/auth/login')) {
      return {
        status: 200,
        data: { code: 0, data: { token: 'fresh-token', expires_in: 3600 } }
      };
    }
    if (url.endsWith('/device/device/list')) {
      return { status: 200, data: { code: 0, data: [{ deviceSn: 'TEST123' }] } };
    }
    throw new Error('Unexpected axios.post call to ' + url);
  });

  const response = await platform.apiPost('/device/device/list', {});

  assert.equal(calls.length, 3, 'expected target → login → target');
  assert.ok(calls[0].url.endsWith('/device/device/list'));
  assert.equal(calls[0].token, 'stale-token');
  assert.ok(calls[1].url.endsWith('/member/auth/login'));
  assert.ok(calls[2].url.endsWith('/device/device/list'));
  assert.equal(calls[2].token, 'fresh-token', 'retry call must use rotated token');

  assert.equal(response.data.code, 0);
  assert.equal(platform.accessToken, 'fresh-token');
});

test('apiPost: success on first call does not retry or re-auth', async (t) => {
  const platform = makePlatform();
  platform.accessToken = 'good-token';
  platform.tokenExpiry = Date.now() + 60_000;

  const calls = [];
  t.mock.method(axios, 'post', async (url, body, opts) => {
    calls.push({ url, token: opts && opts.headers && opts.headers.token });
    return { status: 200, data: { code: 0, data: { ok: true } } };
  });

  const response = await platform.apiPost('/device/device/realInfo', { id: 'X', deviceSn: 'X' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'good-token');
  assert.equal(response.data.code, 0);
  assert.equal(platform.accessToken, 'good-token');
});

test('apiPost: ensureAuthenticated authenticates when no token cached', async (t) => {
  const platform = makePlatform();
  // No accessToken, no tokenExpiry → ensureAuthenticated must trigger login

  const calls = [];
  t.mock.method(axios, 'post', async (url, body, opts) => {
    calls.push(url);
    if (url.endsWith('/member/auth/login')) {
      return {
        status: 200,
        data: { code: 0, data: { token: 'first-token', expires_in: 3600 } }
      };
    }
    return { status: 200, data: { code: 0, data: 'ok' } };
  });

  await platform.apiPost('/device/device/list', {});

  assert.ok(calls[0].endsWith('/member/auth/login'), 'login must precede target call');
  assert.ok(calls[1].endsWith('/device/device/list'));
  assert.equal(platform.accessToken, 'first-token');
});

test('apiPost: sends only `token` header, no Authorization Bearer', async (t) => {
  const platform = makePlatform();
  platform.accessToken = 'tok-abc';
  platform.tokenExpiry = Date.now() + 60_000;

  let capturedHeaders = null;
  t.mock.method(axios, 'post', async (url, body, opts) => {
    capturedHeaders = opts && opts.headers;
    return { status: 200, data: { code: 0, data: null } };
  });

  await platform.apiPost('/device/device/list', {});

  assert.equal(capturedHeaders.token, 'tok-abc');
  assert.equal(capturedHeaders.source, 'ANDROID');
  assert.equal(capturedHeaders.version, '1.3.45');
  assert.equal(capturedHeaders.Authorization, undefined, 'must not send Bearer header');
});

test('authenticate: requires email and password', async () => {
  const platform = makePlatform({ email: '', password: '' });
  await assert.rejects(
    () => platform.authenticate(),
    /Email and password are required/
  );
});
