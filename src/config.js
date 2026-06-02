const fs = require('fs');
const path = require('path');

function parseIntegerOrExit(name, envValue, configValue, defaultValue, min, max) {
  let raw;
  if (envValue !== undefined && envValue !== '') {
    raw = envValue;
  } else if (configValue !== undefined && configValue !== null && configValue !== '') {
    raw = String(configValue);
  } else {
    return defaultValue;
  }
  if (!/^-?\d+$/.test(String(raw).trim())) {
    console.error(`error: ${name} must be an integer (got "${raw}")`);
    process.exit(1);
  }
  const n = parseInt(raw, 10);
  if (n < min || n > max) {
    console.error(`error: ${name} must be in [${min}, ${max}] (got ${n})`);
    process.exit(1);
  }
  return n;
}

function loadConfig() {
  const defaultPath = path.resolve(__dirname, '..', 'config.json');
  const configPath = process.env.CONFIG_PATH || defaultPath;
  const hasExplicitPath = !!process.env.CONFIG_PATH;
  const hasDevicesJson = !!process.env.DEVICES_JSON;
  const fileExists = fs.existsSync(configPath);

  let raw = {};
  let source;

  if (fileExists) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    source = configPath;
  } else if (hasDevicesJson) {
    source = 'environment';
  } else if (hasExplicitPath) {
    console.warn(`warning: config not found at ${configPath}. set DEVICES_JSON env var or mount config file.`);
    source = configPath + ' (missing)';
  } else {
    console.warn(`warning: config not found at ${configPath}. set DEVICES_JSON env var or create config.json.`);
    source = defaultPath + ' (missing)';
  }

  const localAddress = process.env.LOCAL_ADDRESS || raw.localAddress || null;
  const httpPort = parseIntegerOrExit('HTTP_PORT', process.env.HTTP_PORT, raw.httpPort, 3000, 1, 65535);
  const pollIntervalMs = parseIntegerOrExit('POLL_INTERVAL_MS', process.env.POLL_INTERVAL_MS, raw.pollIntervalMs, 30000, 100, 86400000);
  const requestTimeoutMs = parseIntegerOrExit('REQUEST_TIMEOUT_MS', process.env.REQUEST_TIMEOUT_MS, raw.requestTimeoutMs, 5000, 100, 30000);

  let devices = raw.devices || [];
  if (hasDevicesJson) {
    try { devices = JSON.parse(process.env.DEVICES_JSON); }
    catch (e) { console.error('DEVICES_JSON parse error:', e.message); process.exit(1); }
  }

  if (!Array.isArray(devices) || devices.length === 0) {
    console.error('error: devices is empty. set config.json devices or DEVICES_JSON env var.');
    process.exit(1);
  }

  const enriched = devices.map((d) => {
    const displayName = d.name || d.room || d.id || d.ip;
    return {
      ip: d.ip,
      id: d.id || d.room || d.ip,
      room: d.room || d.id || d.ip,
      name: displayName,
    };
  });

  return { localAddress, httpPort, pollIntervalMs, requestTimeoutMs, devices: enriched, source, hasDevicesJson };
}

module.exports = { loadConfig };
