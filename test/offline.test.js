const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { PetLibroPlatform, PetLibroFeeder, PetLibroFountain } = require('..')._test;

// HomeKit Accessory Protocol status code for "communication failure" — the
// trigger that makes Apple Home render the accessory as "Not Responding".
const SERVICE_COMMUNICATION_FAILURE = -70402;

// Each Service/Characteristic type in real HAP is a unique class; the stubs
// use symbols so getService(SomeService) lookups stay reference-equal.
function makeHapStub() {
  const Service = {
    AccessoryInformation: Symbol('AccessoryInformation'),
    Switch: Symbol('Switch'),
    Battery: Symbol('Battery'),
    HumiditySensor: Symbol('HumiditySensor')
  };
  const Characteristic = {
    Manufacturer: Symbol('Manufacturer'),
    Model: Symbol('Model'),
    SerialNumber: Symbol('SerialNumber'),
    FirmwareRevision: Symbol('FirmwareRevision'),
    Name: Symbol('Name'),
    On: Symbol('On'),
    CurrentRelativeHumidity: Symbol('CurrentRelativeHumidity')
  };
  class HapStatusError extends Error {
    constructor(hapStatus) {
      super('HAP error: ' + hapStatus);
      this.hapStatus = hapStatus;
    }
  }
  const HAPStatus = { SERVICE_COMMUNICATION_FAILURE };
  return { Service, Characteristic, HapStatusError, HAPStatus, uuid: { generate: (s) => 'uuid:' + s } };
}

function makeStubAccessory(hap) {
  const services = new Map();
  function makeService() {
    const characteristics = new Map();
    const svc = {
      setCharacteristic() { return svc; },
      getCharacteristic(cType) {
        if (!characteristics.has(cType)) {
          const c = {
            _value: undefined,
            onGet(fn) { c._getter = fn; return c; },
            onSet(fn) { c._setter = fn; return c; },
            updateValue(v) { c._value = v; return c; }
          };
          characteristics.set(cType, c);
        }
        return characteristics.get(cType);
      }
    };
    return svc;
  }
  // AccessoryInformation needs to exist before the device class constructs
  services.set(hap.Service.AccessoryInformation, makeService());
  return {
    displayName: 'stub',
    UUID: 'stub-uuid',
    context: {},
    getService(type) { return services.get(type); },
    addService(type) {
      const svc = makeService();
      services.set(type, svc);
      return svc;
    },
    removeService(svc) {
      for (const [k, v] of services) if (v === svc) services.delete(k);
    },
    _services: services
  };
}

function makeStubLog() {
  const log = function () {};
  log.info = function () {};
  log.warn = function () {};
  log.error = function () {};
  log.debug = function () {};
  return log;
}

function makeStubApi(hap) {
  return { on() {}, hap, platformAccessory: function () {} };
}

function makePlatform() {
  const hap = makeHapStub();
  const platform = new PetLibroPlatform(
    makeStubLog(),
    { email: 'u@e.com', password: 'p' },
    makeStubApi(hap)
  );
  platform.accessToken = 'tok';
  platform.tokenExpiry = Date.now() + 60_000;
  return { platform, hap };
}

test('feeder setOn throws HapStatusError when device.online === false', async () => {
  const { platform, hap } = makePlatform();
  const accessory = makeStubAccessory(hap);
  const feeder = new PetLibroFeeder(platform, accessory, {
    deviceSn: 'PLAF103OFFLINE',
    deviceName: 'Test Feeder',
    online: false
  });

  await assert.rejects(
    () => feeder.setOn(true),
    (err) => err instanceof hap.HapStatusError && err.hapStatus === SERVICE_COMMUNICATION_FAILURE
  );
});

test('feeder setOn does NOT throw when device.online === true', async (t) => {
  const { platform, hap } = makePlatform();
  const accessory = makeStubAccessory(hap);
  const feeder = new PetLibroFeeder(platform, accessory, {
    deviceSn: 'PLAF103ONLINE',
    deviceName: 'Test Feeder',
    online: true
  });

  t.mock.method(axios, 'post', async (url) => {
    if (url.endsWith('/device/device/manualFeeding')) {
      return { status: 200, data: { code: 0 } };
    }
    throw new Error('Unexpected URL ' + url);
  });

  // Should not throw
  await feeder.setOn(true);
});

test('feeder setOn does NOT throw when device.online is absent (firmware variability)', async (t) => {
  const { platform, hap } = makePlatform();
  const accessory = makeStubAccessory(hap);
  // No `online` field at all — must default to operating, not offline
  const feeder = new PetLibroFeeder(platform, accessory, {
    deviceSn: 'PLAF103NOFLAG',
    deviceName: 'Test Feeder'
  });

  t.mock.method(axios, 'post', async () => ({ status: 200, data: { code: 0 } }));
  await feeder.setOn(true);
});

test('fountain getWaterLevel throws HapStatusError when this.online === false', async (t) => {
  const { platform, hap } = makePlatform();
  const accessory = makeStubAccessory(hap);

  // Stub the initial updateWaterLevel() call so the constructor doesn't try
  // to hit a real network. Returns offline=true.
  t.mock.method(axios, 'post', async () => ({
    status: 200,
    data: { code: 0, data: { weightPercent: 75, online: false } }
  }));

  const fountain = new PetLibroFountain(platform, accessory, {
    deviceSn: 'PLWF105OFFLINE',
    deviceName: 'Test Fountain'
  });
  fountain.stopPolling();
  await fountain.updateWaterLevel();

  assert.equal(fountain.online, false);
  await assert.rejects(
    () => fountain.getWaterLevel(),
    (err) => err instanceof hap.HapStatusError && err.hapStatus === SERVICE_COMMUNICATION_FAILURE
  );
});

test('fountain getWaterLevel returns level when online', async (t) => {
  const { platform, hap } = makePlatform();
  const accessory = makeStubAccessory(hap);

  t.mock.method(axios, 'post', async () => ({
    status: 200,
    data: { code: 0, data: { weightPercent: 60, online: true } }
  }));

  const fountain = new PetLibroFountain(platform, accessory, {
    deviceSn: 'PLWF105ONLINE',
    deviceName: 'Test Fountain'
  });
  fountain.stopPolling();
  await fountain.updateWaterLevel();

  assert.equal(fountain.online, true);
  assert.equal(await fountain.getWaterLevel(), 60);
});

test('fountain treats absent realInfo.online as still online (firmware variability)', async (t) => {
  const { platform, hap } = makePlatform();
  const accessory = makeStubAccessory(hap);

  // realInfo missing `online` field entirely
  t.mock.method(axios, 'post', async () => ({
    status: 200,
    data: { code: 0, data: { weightPercent: 45 } }
  }));

  const fountain = new PetLibroFountain(platform, accessory, {
    deviceSn: 'PLWF105LEGACY',
    deviceName: 'Test Fountain'
  });
  fountain.stopPolling();
  await fountain.updateWaterLevel();

  assert.equal(fountain.online, true, 'must default to online when field absent');
  assert.equal(await fountain.getWaterLevel(), 45);
});
