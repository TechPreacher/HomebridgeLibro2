const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBaseUrl, API_REGIONS } = require('..')._test;

test('resolveBaseUrl: apiEndpoint override wins over everything', () => {
  const url = resolveBaseUrl({
    apiEndpoint: 'https://custom.example.com',
    region: 'EU',
    country: 'DE'
  });
  assert.equal(url, 'https://custom.example.com');
});

test('resolveBaseUrl: explicit region EU → EU endpoint', () => {
  assert.equal(resolveBaseUrl({ region: 'EU' }), API_REGIONS.EU);
});

test('resolveBaseUrl: explicit region US → US endpoint', () => {
  assert.equal(resolveBaseUrl({ region: 'US' }), API_REGIONS.US);
});

test('resolveBaseUrl: region trumps country', () => {
  assert.equal(resolveBaseUrl({ region: 'US', country: 'DE' }), API_REGIONS.US);
  assert.equal(resolveBaseUrl({ region: 'EU', country: 'US' }), API_REGIONS.EU);
});

test('resolveBaseUrl: lowercase region is normalized', () => {
  assert.equal(resolveBaseUrl({ region: 'eu' }), API_REGIONS.EU);
  assert.equal(resolveBaseUrl({ region: 'us' }), API_REGIONS.US);
});

test('resolveBaseUrl: country maps to EU for European codes', () => {
  for (const country of ['DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'SE', 'PL']) {
    assert.equal(
      resolveBaseUrl({ country }),
      API_REGIONS.EU,
      `Expected ${country} to resolve to EU`
    );
  }
});

test('resolveBaseUrl: lowercase country code is normalized', () => {
  assert.equal(resolveBaseUrl({ country: 'de' }), API_REGIONS.EU);
  assert.equal(resolveBaseUrl({ country: 'fr' }), API_REGIONS.EU);
});

test('resolveBaseUrl: country US/CA/AU default to US', () => {
  assert.equal(resolveBaseUrl({ country: 'US' }), API_REGIONS.US);
  assert.equal(resolveBaseUrl({ country: 'CA' }), API_REGIONS.US);
  assert.equal(resolveBaseUrl({ country: 'AU' }), API_REGIONS.US);
});

test('resolveBaseUrl: unknown country falls back to US', () => {
  assert.equal(resolveBaseUrl({ country: 'ZZ' }), API_REGIONS.US);
  assert.equal(resolveBaseUrl({ country: 'XYZ' }), API_REGIONS.US);
});

test('resolveBaseUrl: empty config defaults to US', () => {
  assert.equal(resolveBaseUrl({}), API_REGIONS.US);
});

test('resolveBaseUrl: unknown region falls back to US', () => {
  assert.equal(resolveBaseUrl({ region: 'ASIA' }), API_REGIONS.US);
});
