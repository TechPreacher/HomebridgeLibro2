const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { PetLibroPlatform } = require('..')._test;

function makeStubApi() {
  return {
    on() {},
    hap: { Service: {}, Characteristic: {}, uuid: { generate: (s) => 'uuid:' + s } },
    platformAccessory: function () {}
  };
}

// Capturing logger: records every call against each level so the test can
// inspect what was emitted. Behaves as both callable (default `log()`) and
// namespaced methods.
function makeCapturingLog() {
  const calls = { default: [], info: [], warn: [], error: [], debug: [] };
  const log = function (...args) { calls.default.push(args.join(' ')); };
  log.info = (...args) => calls.info.push(args.join(' '));
  log.warn = (...args) => calls.warn.push(args.join(' '));
  log.error = (...args) => calls.error.push(args.join(' '));
  log.debug = (...args) => calls.debug.push(args.join(' '));
  log._calls = calls;
  return log;
}

function makePlatform(config = {}, log) {
  return new PetLibroPlatform(
    log || makeCapturingLog(),
    { email: 'user@example.com', password: 'hunter2', ...config },
    makeStubApi()
  );
}

const fakeDeviceList = [
  { deviceSn: 'PLAF108DEMO', productName: 'Air Smart Feeder', deviceName: 'Kitchen' },
  { deviceSn: 'PLWF116DEMO', productName: 'Dockstream 2 Cordless', deviceName: 'Hallway' }
];

function stubListEndpoint(t) {
  t.mock.method(axios, 'post', async (url) => {
    if (url.endsWith('/member/auth/login')) {
      return { status: 200, data: { code: 0, data: { token: 'tok', expires_in: 3600 } } };
    }
    if (url.endsWith('/device/device/list')) {
      return { status: 200, data: { code: 0, data: fakeDeviceList } };
    }
    throw new Error('Unexpected URL ' + url);
  });
}

test('debugDeviceDump=true logs raw device list as JSON', async (t) => {
  const log = makeCapturingLog();
  const platform = makePlatform({ debugDeviceDump: true }, log);
  stubListEndpoint(t);

  const devices = await platform.fetchDevicesFromAPI();

  assert.equal(devices.length, 2);

  const dumpLines = log._calls.info.filter(line => line.includes('[debugDeviceDump]'));
  assert.equal(dumpLines.length, 1, 'expected exactly one dump line');
  assert.match(dumpLines[0], /PLAF108DEMO/);
  assert.match(dumpLines[0], /PLWF116DEMO/);
  assert.match(dumpLines[0], /Dockstream 2 Cordless/);
});

test('debugDeviceDump=false (default) does not log raw device list', async (t) => {
  const log = makeCapturingLog();
  const platform = makePlatform({}, log);
  stubListEndpoint(t);

  await platform.fetchDevicesFromAPI();

  const dumpLines = log._calls.info.filter(line => line.includes('[debugDeviceDump]'));
  assert.equal(dumpLines.length, 0, 'no dump line should be emitted when flag is absent');
});

test('debugDeviceDump=true does not leak credentials in any log line', async (t) => {
  const secret = 'super-secret-password-do-not-leak';
  const log = makeCapturingLog();
  const platform = makePlatform({ password: secret, debugDeviceDump: true }, log);
  stubListEndpoint(t);

  await platform.fetchDevicesFromAPI();

  const allLines = [
    ...log._calls.default,
    ...log._calls.info,
    ...log._calls.warn,
    ...log._calls.error,
    ...log._calls.debug
  ];
  for (const line of allLines) {
    assert.doesNotMatch(line, new RegExp(secret), 'plaintext password must never appear in logs');
  }
});
