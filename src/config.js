const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = process.env.CONFIG_PATH || path.resolve(__dirname, '..', 'config.json');

  let raw = {};
  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else {
    console.warn(`config not found at ${configPath}, using env defaults`);
  }

  const localAddress = process.env.LOCAL_ADDRESS || raw.localAddress || '';
  const httpPort = parseInt(process.env.HTTP_PORT || String(raw.httpPort || 3000), 10);
  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || String(raw.pollIntervalMs || 30000), 10);
  const requestTimeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS || String(raw.requestTimeoutMs || 5000), 10);

  let devices = raw.devices || [];
  if (process.env.DEVICES_JSON) {
    try { devices = JSON.parse(process.env.DEVICES_JSON); }
    catch (e) { console.error('DEVICES_JSON parse error:', e.message); process.exit(1); }
  }

  if (!Array.isArray(devices) || devices.length === 0) {
    console.error('error: devices is empty. set config.json devices or DEVICES_JSON env var.');
    process.exit(1);
  }

  if (!localAddress) {
    console.error('error: localAddress is required. set in config.json or LOCAL_ADDRESS env var.');
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

  return { localAddress, httpPort, pollIntervalMs, requestTimeoutMs, devices: enriched };
}

module.exports = { loadConfig };
