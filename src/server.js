const express = require('express');
const path = require('path');
const { loadConfig } = require('./config');
const { createPoller } = require('./poller');
const { interpret } = require('./echonet');

const STALE_MS = 90000;
const config = loadConfig();

async function main() {
  const poller = createPoller(config.localAddress, config.requestTimeoutMs);
  await poller.init();

  let latestStatus = {};
  const lastSuccessAt = {};
  const pollStatus = {
    lastPollStartedAt: 0,
    lastPollFinishedAt: 0,
    pollingDurationMs: 0,
    pollInProgress: false,
  };

  for (const device of config.devices) {
    latestStatus[device.ip] = { timestamp: 0, values: {}, errors: { init: { reason: 'pending' } } };
    lastSuccessAt[device.ip] = 0;
  }

  async function poll() {
    if (pollStatus.pollInProgress) return;
    pollStatus.pollInProgress = true;
    pollStatus.lastPollStartedAt = Date.now();
    try {
      const fresh = await poller.pollAll(config.devices);
      const now = Date.now();
      for (const device of config.devices) {
        const s = fresh[device.ip];
        if (s && s.anySuccess) lastSuccessAt[device.ip] = now;
        s.lastSuccessAt = lastSuccessAt[device.ip] || 0;
        s.stale = s.lastSuccessAt > 0 && (now - s.lastSuccessAt > STALE_MS);
      }
      latestStatus = fresh;
    } catch (err) {
      console.error('poll error:', err.message);
    }
    pollStatus.lastPollFinishedAt = Date.now();
    pollStatus.pollingDurationMs = pollStatus.lastPollFinishedAt - pollStatus.lastPollStartedAt;
    pollStatus.pollInProgress = false;
  }

  async function pollLoop() {
    await poll();
    setTimeout(pollLoop, config.pollIntervalMs);
  }

  const app = express();

  app.listen(config.httpPort, () => {
    console.log(`ECHONET Lite Web Server running on http://0.0.0.0:${config.httpPort}`);
    console.log(`  Config: ${config.source}`);
    console.log(`  Devices: ${config.devices.map(d => `${d.name} (${d.ip})`).join(', ')}`);
    if (config.localAddress) console.log(`  Source:  ${config.localAddress}`);
    else console.log(`  Source:  (OS default route)`);
    console.log(`  Poll interval: ${config.pollIntervalMs}ms, stale threshold: ${STALE_MS}ms`);
    console.log(`  Read-only mode (no SET commands)`);
    if (!config.localAddress) console.log(`  Note: multi-NIC/VPN environment requires LOCAL_ADDRESS`);
  });

  pollLoop();

  app.use(express.static(path.resolve(__dirname, 'public')));

  app.get('/health', (_req, res) => {
    res.json({ status: 'alive', uptime: process.uptime() });
  });

  app.get('/api/devices', (_req, res) => {
    res.json(config.devices);
  });

  app.get('/api/status', (_req, res) => {
    const data = {};
    const now = Date.now();
    for (const device of config.devices) {
      const s = latestStatus[device.ip] || {};
      const lsa = s.lastSuccessAt || 0;
      const cap = s.capability;
      data[device.ip] = {
        name: device.name,
        id: device.id,
        room: device.room,
        ip: device.ip,
        timestamp: s.timestamp || null,
        lastSuccessAt: lsa || null,
        stale: lsa > 0 && (now - lsa > STALE_MS),
        values: s.values || {},
        errors: s.errors || {},
        capability: cap ? {
          supportedGetEpcs: cap.supported,
          unsupportedEpcs: cap.unsupported,
          source: cap.source,
        } : null,
      };
    }
    res.json({ devices: data, pollStatus });
  });

  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    const lines = [];
    const now = Date.now();

    function esc(v) { return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`; }

    function labelStr(device) {
      return `id=${esc(device.id)},name=${esc(device.name)},room=${esc(device.room)},ip=${esc(device.ip)}`;
    }

    lines.push('# HELP nocria_ac_up Device reachability (1=up, 0=down)');
    lines.push('# TYPE nocria_ac_up gauge');
    lines.push('# HELP nocria_ac_stale Data is stale (>90s since last success)');
    lines.push('# TYPE nocria_ac_stale gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const l = labelStr(device);
      const lsa = s.lastSuccessAt || 0;
      const stale = lsa > 0 && (now - lsa > STALE_MS);
      const up = (lsa > 0 && !stale) ? 1 : 0;
      lines.push(`nocria_ac_up{${l}} ${up}`);
      lines.push(`nocria_ac_stale{${l}} ${stale ? 1 : 0}`);
    }

    lines.push('# HELP nocria_ac_last_success_timestamp_seconds Unix timestamp of last successful poll');
    lines.push('# TYPE nocria_ac_last_success_timestamp_seconds gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const lsa = s.lastSuccessAt || 0;
      lines.push(`nocria_ac_last_success_timestamp_seconds{${labelStr(device)}} ${(lsa / 1000).toFixed(3)}`);
    }

    lines.push('# HELP nocria_ac_operation_status Operation status (1=ON, 0=OFF)');
    lines.push('# TYPE nocria_ac_operation_status gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x80];
      if (v) lines.push(`nocria_ac_operation_status{${labelStr(device)}} ${v.dec === 'ON' ? 1 : 0}`);
    }

    lines.push('# HELP nocria_ac_error_status Error status (1=fault, 0=normal)');
    lines.push('# TYPE nocria_ac_error_status gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x88];
      if (v) lines.push(`nocria_ac_error_status{${labelStr(device)}} ${v.dec.startsWith('異常あり') ? 1 : 0}`);
    }

    lines.push('# HELP nocria_ac_instant_power_w Instantaneous power in watts');
    lines.push('# TYPE nocria_ac_instant_power_w gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x84];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_instant_power_w{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_total_energy_kwh Cumulative energy in kWh');
    lines.push('# TYPE nocria_ac_total_energy_kwh gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x85];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_total_energy_kwh{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_set_temperature_c Set temperature in Celsius');
    lines.push('# TYPE nocria_ac_set_temperature_c gauge');
    lines.push('# HELP nocria_ac_set_temperature_valid Whether set temperature data is valid (1=valid, 0=auto/unavailable)');
    lines.push('# TYPE nocria_ac_set_temperature_valid gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xB3];
      if (v) {
        lines.push(`nocria_ac_set_temperature_valid{${labelStr(device)}} ${v.valid ? 1 : 0}`);
        if (v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_set_temperature_c{${labelStr(device)}} ${n}`); }
      }
    }

    lines.push('# HELP nocria_ac_room_temperature_c Room temperature in Celsius');
    lines.push('# TYPE nocria_ac_room_temperature_c gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xBB];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_room_temperature_c{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_room_humidity_percent Room humidity in percent');
    lines.push('# TYPE nocria_ac_room_humidity_percent gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xBA];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_room_humidity_percent{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_outdoor_temperature_c Outdoor temperature in Celsius');
    lines.push('# TYPE nocria_ac_outdoor_temperature_c gauge');
    lines.push('# HELP nocria_ac_outdoor_temperature_valid Whether outdoor temperature data is valid');
    lines.push('# TYPE nocria_ac_outdoor_temperature_valid gauge');
    for (const device of config.devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xBE];
      if (v) {
        lines.push(`nocria_ac_outdoor_temperature_valid{${labelStr(device)}} ${v.valid ? 1 : 0}`);
        if (v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_outdoor_temperature_c{${labelStr(device)}} ${n}`); }
      }
    }

    lines.push('');
    res.send(lines.join('\n'));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
