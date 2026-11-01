const express = require('express');
const path = require('path');
const { loadConfig } = require('./config');
const { createPoller } = require('./poller');
const { renderMetrics } = require('./metrics');
const version = require('./version');

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

  app.get('/api/version', (_req, res) => {
    res.json(version);
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
    res.send(renderMetrics(config.devices, latestStatus));
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
