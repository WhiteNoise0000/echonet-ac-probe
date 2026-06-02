const { parseBitmap, interpret, isValidValue } = require('./echonet');
const { loadConfig } = require('./config');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { console.error(`FAIL: ${msg}`); failed++; }
}

// ---- parseBitmap ----
// List format (count < 16)
assert(JSON.stringify(parseBitmap(Buffer.from([3, 0x80, 0x84, 0x85]))) === JSON.stringify([0x80, 0x84, 0x85]),
  'list format: count=3, EPCs=80,84,85');

assert(JSON.stringify(parseBitmap(Buffer.from([1, 0x80]))) === JSON.stringify([0x80]),
  'list format: single EPC 0x80');

assert(JSON.stringify(parseBitmap(Buffer.from([0]))) === JSON.stringify([]),
  'list format: empty list');

// Bitmap format (count >= 16)
const nocriaEDT = Buffer.from([
  0x1c, // count = 28 >= 16 → bitmap mode
  0x0d, 0x09, 0x01, 0x0f, 0x01, 0x01, 0x80,
  0x02, 0x03, 0x01, 0x01, 0x09, 0x11, 0x03,
  0x0a, 0x03,
]);
const bmp = parseBitmap(nocriaEDT);
assert(bmp.includes(0x80), 'bitmap should include 0x80 (operating status)');
assert(bmp.includes(0x84), 'bitmap should include 0x84 (instant power)');
assert(bmp.includes(0x85), 'bitmap should include 0x85 (cumulative power)');
assert(bmp.includes(0x88), 'bitmap should include 0x88 (error status)');
assert(bmp.includes(0xB0), 'bitmap should include 0xB0 (operation mode)');
assert(bmp.includes(0xB3), 'bitmap should include 0xB3 (set temperature)');
assert(bmp.includes(0xBB), 'bitmap should include 0xBB (indoor temperature)');
assert(bmp.includes(0xBE), 'bitmap should include 0xBE (outdoor temperature)');
assert(!bmp.includes(0xBA), 'bitmap should NOT include 0xBA (humidity, not supported)');

// ---- interpret ----
assert(interpret(0x80, Buffer.from([0x30])) === 'ON', 'operating status ON');
assert(interpret(0x80, Buffer.from([0x31])) === 'OFF', 'operating status OFF');

assert(interpret(0x83, Buffer.from([0x01, 0x02, 0x03])) === '01 02 03', 'identification number raw hex');
assert(interpret(0x8A, Buffer.from([0x00, 0x00, 0x01])) === '00 00 01', 'manufacturer code raw hex');
assert(interpret(0x84, Buffer.from([0x00, 0x5A])) === '90 W', 'instant power 90W');
assert(interpret(0x85, Buffer.from([0x00, 0x00, 0x33, 0x3E])) === '13.118 kWh', 'cumulative power 13.118kWh');

assert(interpret(0x88, Buffer.from([0x41])) === '異常あり (Fault)', 'error status fault');
assert(interpret(0x88, Buffer.from([0x42])) === '異常なし (Normal)', 'error status normal');

assert(interpret(0xB0, Buffer.from([0x42])) === '冷房', 'operation mode cooling');

// temperature: 1-byte sentinel
assert(interpret(0xBE, Buffer.from([0x7E])) === '126 °C', 'outdoor 126 raw');
assert(interpret(0xBE, Buffer.from([0x1D])) === '29 °C', 'outdoor 29 raw');

// ---- 0xB3 auto-mode special value ----
assert(interpret(0xB3, Buffer.from([0xFD])) === '自動制御', 'set temp auto mode (0xFD)');
assert(interpret(0xB3, Buffer.from([0xF0])) === '自動制御', 'set temp auto mode (0xF0)');
assert(interpret(0xB3, Buffer.from([25])) === '25 °C', 'set temp manual 25');

// ---- isValidValue ----
assert(isValidValue(0xBE, Buffer.from([0x1D])) === true, 'valid outdoor 29');
assert(isValidValue(0xBE, Buffer.from([0x7E])) === false, 'invalid outdoor 126');
assert(isValidValue(0xBB, Buffer.from([0x7F])) === false, 'invalid indoor 127');
assert(isValidValue(0xBB, Buffer.from([25])) === true, 'valid indoor 25');
assert(isValidValue(0xB3, Buffer.from([25])) === true, 'set temp 25 valid');
assert(isValidValue(0xB3, Buffer.from([0xFD])) === false, 'set temp 0xFD invalid (auto mode)');
assert(isValidValue(0xB3, Buffer.from([0xF0])) === false, 'set temp 0xF0 invalid (auto mode)');
assert(isValidValue(0xB3, Buffer.from([0x7E])) === true, 'set temp 126 valid (not a sensor, under 0xF0)');
assert(isValidValue(0x80, Buffer.from([0x30])) === true, 'operating status always valid');
assert(isValidValue(0x84, Buffer.from([0x00, 0x01])) === true, 'instant power always valid');

// ---- capability filtering ----
const DESIRED = [0x80, 0x83, 0x84, 0x85, 0x88, 0x8A, 0xB0, 0xB3, 0xBA, 0xBB, 0xBE];
const SAFE = [0x80, 0x83, 0x84, 0x85, 0x88, 0x8A, 0xB0, 0xB3, 0xBB, 0xBE]; // no 0xBA
// Simulate bitmap with 0xBA missing (our real device response)
const nocriaEDT2 = Buffer.from([0x1c, 0x0d, 0x09, 0x01, 0x0f, 0x01, 0x01, 0x80, 0x02, 0x03, 0x01, 0x01, 0x09, 0x11, 0x03, 0x0a, 0x03]);
const bmpCodes = parseBitmap(nocriaEDT);
const fromMap = DESIRED.filter(e => bmpCodes.includes(e));
const notInMap = DESIRED.filter(e => !bmpCodes.includes(e));
assert(fromMap.length === 10, 'capability: 10 EPCs supported by bitmap');
assert(!fromMap.includes(0xBA), 'capability: 0xBA excluded from supported');
assert(notInMap.includes(0xBA), 'capability: 0xBA in unsupported list');
// 0x9F discovery failure → SAFE fallback
assert(!SAFE.includes(0xBA), 'capability: 0xBA excluded from SAFE fallback');
assert(SAFE.includes(0x80), 'capability: 0x80 in SAFE fallback');

// ---- poller shape ----
const { createPoller } = require('./poller');
const p = createPoller('127.0.0.1', 2000);
assert(typeof p.init === 'function', 'poller: init is a function');
assert(typeof p.pollAll === 'function', 'poller: pollAll is a function');
assert(typeof p.close === 'function', 'poller: close is a function');
// close without init should not throw
p.close();

// ---- config ----
(function testConfig() {
  const saveCfg = process.env.CONFIG_PATH;
  const saveAddr = process.env.LOCAL_ADDRESS;
  const saveDev = process.env.DEVICES_JSON;

  process.env.CONFIG_PATH = 'NONEXISTENT';
  delete process.env.LOCAL_ADDRESS;
  process.env.DEVICES_JSON = '[{"ip":"10.0.0.1"}]';
  const c = loadConfig();
  assert(c.localAddress === null, 'config: null localAddress when unset');
  assert(c.devices.length === 1, 'config: 1 device from env');
  assert(c.source === 'environment', 'config: source=environment when DEVICES_JSON set');
  assert(c.hasDevicesJson === true, 'config: hasDevicesJson=true');

  // restore
  if (saveCfg) process.env.CONFIG_PATH = saveCfg; else delete process.env.CONFIG_PATH;
  if (saveAddr) process.env.LOCAL_ADDRESS = saveAddr; else delete process.env.LOCAL_ADDRESS;
  if (saveDev) process.env.DEVICES_JSON = saveDev; else delete process.env.DEVICES_JSON;
})();

// ---- config integer validation ----
function trapExit(fn) {
  const origExit = process.exit;
  const origErr = console.error;
  let code = null;
  const errs = [];
  process.exit = (c) => { code = c; throw new Error('__EXIT__'); };
  console.error = (m) => errs.push(String(m));
  try {
    fn();
    return { exited: false, code, errs };
  } catch (e) {
    if (e.message === '__EXIT__') return { exited: true, code, errs };
    throw e;
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
}

function reloadConfig() {
  delete require.cache[require.resolve('./config')];
  return require('./config');
}

(function testConfigValidation() {
  const saveCfg = process.env.CONFIG_PATH;
  const saveAddr = process.env.LOCAL_ADDRESS;
  const saveDev = process.env.DEVICES_JSON;
  const savePort = process.env.HTTP_PORT;
  const savePoll = process.env.POLL_INTERVAL_MS;
  const saveTimeout = process.env.REQUEST_TIMEOUT_MS;

  process.env.CONFIG_PATH = 'NONEXISTENT';
  delete process.env.LOCAL_ADDRESS;
  process.env.DEVICES_JSON = '[{"ip":"10.0.0.1"}]';

  // Defaults
  delete process.env.HTTP_PORT;
  delete process.env.POLL_INTERVAL_MS;
  delete process.env.REQUEST_TIMEOUT_MS;
  let c = reloadConfig().loadConfig();
  assert(c.httpPort === 3000, 'config: default httpPort');
  assert(c.pollIntervalMs === 30000, 'config: default pollIntervalMs');
  assert(c.requestTimeoutMs === 5000, 'config: default requestTimeoutMs');

  // Valid env override
  process.env.HTTP_PORT = '8080';
  process.env.POLL_INTERVAL_MS = '60000';
  process.env.REQUEST_TIMEOUT_MS = '1000';
  c = reloadConfig().loadConfig();
  assert(c.httpPort === 8080, 'config: httpPort from env');
  assert(c.pollIntervalMs === 60000, 'config: pollIntervalMs from env');
  assert(c.requestTimeoutMs === 1000, 'config: requestTimeoutMs from env');

  // Invalid: non-integer
  process.env.HTTP_PORT = 'abc';
  let r = trapExit(() => reloadConfig().loadConfig());
  assert(r.exited && r.code === 1, 'config: HTTP_PORT=abc exits with code 1');
  assert(r.errs.some(e => e.includes('HTTP_PORT')), 'config: error mentions HTTP_PORT');

  // Invalid: out of range (port 0)
  process.env.HTTP_PORT = '0';
  r = trapExit(() => reloadConfig().loadConfig());
  assert(r.exited, 'config: HTTP_PORT=0 exits');
  assert(r.errs.some(e => e.includes('HTTP_PORT')), 'config: error mentions HTTP_PORT (range)');

  // Invalid: out of range (port 99999)
  process.env.HTTP_PORT = '99999';
  r = trapExit(() => reloadConfig().loadConfig());
  assert(r.exited, 'config: HTTP_PORT=99999 exits');

  // Invalid: POLL_INTERVAL_MS=0
  process.env.HTTP_PORT = '3000';
  process.env.POLL_INTERVAL_MS = '0';
  r = trapExit(() => reloadConfig().loadConfig());
  assert(r.exited, 'config: POLL_INTERVAL_MS=0 exits');
  assert(r.errs.some(e => e.includes('POLL_INTERVAL_MS')), 'config: error mentions POLL_INTERVAL_MS');

  // Invalid: REQUEST_TIMEOUT_MS=foo
  process.env.POLL_INTERVAL_MS = '30000';
  process.env.REQUEST_TIMEOUT_MS = 'foo';
  r = trapExit(() => reloadConfig().loadConfig());
  assert(r.exited, 'config: REQUEST_TIMEOUT_MS=foo exits');
  assert(r.errs.some(e => e.includes('REQUEST_TIMEOUT_MS')), 'config: error mentions REQUEST_TIMEOUT_MS');

  // restore
  if (saveCfg) process.env.CONFIG_PATH = saveCfg; else delete process.env.CONFIG_PATH;
  if (saveAddr) process.env.LOCAL_ADDRESS = saveAddr; else delete process.env.LOCAL_ADDRESS;
  if (saveDev) process.env.DEVICES_JSON = saveDev; else delete process.env.DEVICES_JSON;
  if (savePort) process.env.HTTP_PORT = savePort; else delete process.env.HTTP_PORT;
  if (savePoll) process.env.POLL_INTERVAL_MS = savePoll; else delete process.env.POLL_INTERVAL_MS;
  if (saveTimeout) process.env.REQUEST_TIMEOUT_MS = saveTimeout; else delete process.env.REQUEST_TIMEOUT_MS;
  reloadConfig();
})();

// ---- version module ----
function reloadVersion() {
  delete require.cache[require.resolve('./version')];
  return require('./version');
}

(function testVersion() {
  const saveVer = process.env.APP_VERSION;
  const saveSha = process.env.APP_GIT_SHA;
  const saveDate = process.env.APP_BUILD_DATE;
  const saveEnv = process.env.NODE_ENV;

  // Defaults (env unset)
  delete process.env.APP_VERSION;
  delete process.env.APP_GIT_SHA;
  delete process.env.APP_BUILD_DATE;
  delete process.env.NODE_ENV;
  let v = reloadVersion();
  assert(v.gitSha === 'unknown', 'version: default gitSha');
  assert(v.gitShaShort === 'unknown', 'version: default gitShaShort');
  assert(v.buildDate === 'unknown', 'version: default buildDate');
  assert(v.appVersion === '1.0.0', 'version: appVersion falls back to package.json');

  // From env
  process.env.APP_VERSION = 'v1.2.3';
  process.env.APP_GIT_SHA = 'abc1234567890def';
  process.env.APP_BUILD_DATE = '2026-06-02T00:00:00Z';
  process.env.NODE_ENV = 'production';
  v = reloadVersion();
  assert(v.appVersion === 'v1.2.3', 'version: appVersion from env overrides package.json');
  assert(v.gitSha === 'abc1234567890def', 'version: gitSha from env');
  assert(v.gitShaShort === 'abc1234', 'version: gitShaShort truncates to 7');
  assert(v.buildDate === '2026-06-02T00:00:00Z', 'version: buildDate from env');
  assert(v.nodeEnv === 'production', 'version: nodeEnv from env');

  // Long SHA also truncates
  process.env.APP_GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
  v = reloadVersion();
  assert(v.gitShaShort === '0123456', 'version: gitShaShort of long SHA');

  // restore
  if (saveVer) process.env.APP_VERSION = saveVer; else delete process.env.APP_VERSION;
  if (saveSha) process.env.APP_GIT_SHA = saveSha; else delete process.env.APP_GIT_SHA;
  if (saveDate) process.env.APP_BUILD_DATE = saveDate; else delete process.env.APP_BUILD_DATE;
  if (saveEnv) process.env.NODE_ENV = saveEnv; else delete process.env.NODE_ENV;
  reloadVersion();
})();

// ---- summary ----
const total = passed + failed;
console.log(`\n${total} tests: ${passed} passed, ${failed} failed${failed ? ' ❌' : ' ✅'}`);
process.exit(failed ? 1 : 0);
