const assert = require('assert');
const { retryRequest } = require('./poller');

(async () => {
  let attempts = 0;
  const result = await retryRequest(async () => {
    attempts += 1;
    return attempts === 3 ? 'ok' : null;
  }, 2, 0);
  assert.strictEqual(result, 'ok', 'retry: succeeds on the third attempt');
  assert.strictEqual(attempts, 3, 'retry: performs two retries after the initial attempt');

  attempts = 0;
  const failed = await retryRequest(async () => {
    attempts += 1;
    return null;
  }, 2, 0);
  assert.strictEqual(failed, null, 'retry: returns null after all attempts fail');
  assert.strictEqual(attempts, 3, 'retry: stops after the configured retry budget');

  console.log('retry tests: 2 passed ✅');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
