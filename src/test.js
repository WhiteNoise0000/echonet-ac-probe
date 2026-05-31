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

// ---- summary ----
const total = passed + failed;
console.log(`\n${total} tests: ${passed} passed, ${failed} failed${failed ? ' ❌' : ' ✅'}`);
process.exit(failed ? 1 : 0);
