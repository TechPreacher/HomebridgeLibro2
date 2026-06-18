const test = require('node:test');
const assert = require('node:assert/strict');

const { PetLibroFeeder } = require('..')._test;

// UUID v4 shape: 8-4-4-4-12 hex, third group starts with 4, fourth with 8/9/a/b
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Tiny stub so we can construct a feeder just to exercise generateRequestId
function makeFeeder() {
  const hap = {
    Service: { AccessoryInformation: Symbol(), Switch: Symbol() },
    Characteristic: {
      Manufacturer: Symbol(), Model: Symbol(), SerialNumber: Symbol(),
      FirmwareRevision: Symbol(), Name: Symbol(), On: Symbol()
    }
  };
  const noop = () => ({ setCharacteristic: () => noop(), getCharacteristic: () => ({ onGet: () => ({ onSet: () => {} }), onSet: () => {} }) });
  const accessory = {
    getService: () => ({
      setCharacteristic: function () { return this; },
      getCharacteristic: () => ({ onGet: function () { return this; }, onSet: function () { return this; } })
    }),
    addService: () => ({
      setCharacteristic: function () { return this; },
      getCharacteristic: () => ({ onGet: function () { return this; }, onSet: function () { return this; } })
    })
  };
  const log = function () {};
  log.info = function () {};
  log.warn = function () {};
  log.error = function () {};
  log.debug = function () {};
  const platform = { log, config: {}, api: { hap } };
  return new PetLibroFeeder(platform, accessory, { deviceSn: 'TEST' });
}

test('generateRequestId returns a UUID v4', () => {
  const feeder = makeFeeder();
  const id = feeder.generateRequestId();
  assert.match(id, UUID_V4, `expected UUID v4, got ${id}`);
});

test('generateRequestId produces unique values across calls', () => {
  const feeder = makeFeeder();
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    seen.add(feeder.generateRequestId());
  }
  assert.equal(seen.size, 100, 'every requestId must be unique');
});
