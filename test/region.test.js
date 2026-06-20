const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBaseUrl, API_REGIONS } = require('..')._test;

// v1.5.1 reverted the speculative EU endpoint and country-to-region
// auto-routing introduced in v1.5.0. Only two paths now exist:
//   1. config.apiEndpoint override (full URL)
//   2. api.us.petlibro.com (always, for everything else)
// These tests pin that contract so the routing doesn't accidentally
// regrow into something speculative again.

test('resolveBaseUrl: apiEndpoint override wins', () => {
  assert.equal(
    resolveBaseUrl({ apiEndpoint: 'https://custom.example.com' }),
    'https://custom.example.com'
  );
});

test('resolveBaseUrl: apiEndpoint override wins even with region/country set', () => {
  assert.equal(
    resolveBaseUrl({
      apiEndpoint: 'https://override.example.com',
      region: 'EU',
      country: 'DE'
    }),
    'https://override.example.com'
  );
});

test('resolveBaseUrl: empty config returns US endpoint', () => {
  assert.equal(resolveBaseUrl({}), API_REGIONS.US);
  assert.equal(resolveBaseUrl({}), 'https://api.us.petlibro.com');
});

test('resolveBaseUrl: region field is ignored (no auto-routing)', () => {
  // region was a speculative addition in 1.5.0 and is now a no-op
  assert.equal(resolveBaseUrl({ region: 'US' }), API_REGIONS.US);
  assert.equal(resolveBaseUrl({ region: 'EU' }), API_REGIONS.US);
  assert.equal(resolveBaseUrl({ region: 'asia' }), API_REGIONS.US);
});

test('resolveBaseUrl: country field is ignored (no auto-routing)', () => {
  // country was used to map to a region in 1.5.0; no longer routed on
  for (const country of ['DE', 'FR', 'GB', 'CH', 'US', 'CA', 'ZZ']) {
    assert.equal(
      resolveBaseUrl({ country }),
      API_REGIONS.US,
      `${country} must resolve to US`
    );
  }
});

test('API_REGIONS exposes only the US endpoint', () => {
  assert.deepEqual(Object.keys(API_REGIONS), ['US']);
  assert.equal(API_REGIONS.US, 'https://api.us.petlibro.com');
});
