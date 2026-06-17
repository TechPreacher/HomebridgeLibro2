const test = require('node:test');
const assert = require('node:assert/strict');

const { getDeviceType, DEVICE_TYPE } = require('..')._test;

test('getDeviceType: PLWF deviceSn prefix → fountain', () => {
  assert.equal(getDeviceType({ deviceSn: 'PLWF105ABC123' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ deviceSn: 'plwf106xyz' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ deviceSn: 'PLWF305AAA' }), DEVICE_TYPE.FOUNTAIN);
});

test('getDeviceType: productName containing "Dockstream" → fountain', () => {
  assert.equal(getDeviceType({ productName: 'Dockstream Smart Fountain' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ productName: 'DOCKSTREAM 2' }), DEVICE_TYPE.FOUNTAIN);
});

test('getDeviceType: productName containing "Fountain" → fountain', () => {
  assert.equal(getDeviceType({ productName: 'Generic Water Fountain' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ productName: 'fountain xyz' }), DEVICE_TYPE.FOUNTAIN);
});

test('getDeviceType: case-insensitive matching', () => {
  assert.equal(getDeviceType({ productName: 'doCkStrEaM' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ deviceSn: 'plwf123' }), DEVICE_TYPE.FOUNTAIN);
});

test('getDeviceType: feeder defaults', () => {
  assert.equal(getDeviceType({ productName: 'Granary Smart Feeder', deviceSn: 'PLAF103' }), DEVICE_TYPE.FEEDER);
  assert.equal(getDeviceType({ productName: 'Air Smart Feeder', deviceSn: 'PLAF108' }), DEVICE_TYPE.FEEDER);
  assert.equal(getDeviceType({ productName: 'Polar Wet Food Feeder', deviceSn: 'PLAF109' }), DEVICE_TYPE.FEEDER);
});

test('getDeviceType: missing fields default to feeder', () => {
  assert.equal(getDeviceType({}), DEVICE_TYPE.FEEDER);
  assert.equal(getDeviceType({ productName: '' }), DEVICE_TYPE.FEEDER);
});

test('getDeviceType: alias field names (product_name, model)', () => {
  assert.equal(getDeviceType({ product_name: 'Dockstream' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ model: 'Water Fountain' }), DEVICE_TYPE.FOUNTAIN);
});

test('getDeviceType: alias serial field names (device_id, deviceId)', () => {
  assert.equal(getDeviceType({ device_id: 'PLWF999' }), DEVICE_TYPE.FOUNTAIN);
  assert.equal(getDeviceType({ deviceId: 'PLWF888' }), DEVICE_TYPE.FOUNTAIN);
});

test('getDeviceType: feeder model with name not matching fountain identifiers', () => {
  // Real-world feeder products from README
  for (const sn of ['PLAF103', 'PLAF107', 'PLAF108', 'PLAF109', 'PLAF203', 'PLAF301']) {
    assert.equal(
      getDeviceType({ deviceSn: sn, productName: 'Smart Feeder' }),
      DEVICE_TYPE.FEEDER,
      `Expected ${sn} to be a feeder`
    );
  }
});
