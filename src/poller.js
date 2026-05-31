const dgram = require('dgram');
const { PORT, EOJ_AC, EPC_NAME, hex, buildGet, parseEL, interpret, isValidValue, parseBitmap } = require('./echonet');

const DESIRED_EPCS = [0x80, 0x83, 0x88, 0x84, 0x85, 0x8A, 0xB0, 0xB3, 0xBA, 0xBB, 0xBE];
const SAFE_EPCS = [0x80, 0x83, 0x84, 0x85, 0x88, 0x8A, 0xB0, 0xB3, 0xBB, 0xBE]; // excludes 0xBA

function createPoller(localAddress, requestTimeoutMs) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let tidCounter = 1;
  let pending = null;
  const capabilities = {}; // ip -> { supportedEpcs, unsupportedEpcs, source }

  sock.on('message', (msg, rinfo) => {
    if (localAddress && rinfo.address === localAddress) return;
    if (pending && rinfo.address === pending.targetIP) {
      const p = parseEL(msg);
      if (p && p.tid === pending.tid) {
        pending.resolve(p);
      }
    }
  });
  sock.on('error', () => {});

  function sendGet(targetIP, epcs) {
    return new Promise((resolve) => {
      const list = Array.isArray(epcs) ? epcs : [epcs];
      const tid = tidCounter++;
      const req = buildGet(EOJ_AC, list, tid);
      const timer = setTimeout(() => {
        if (pending && pending.targetIP === targetIP && pending.tid === tid) {
          pending = null;
          resolve(null);
        }
      }, requestTimeoutMs);
      pending = {
        targetIP, tid,
        resolve: (r) => { clearTimeout(timer); pending = null; resolve(r); },
      };
      sock.send(req, 0, req.length, PORT, targetIP, (err) => {
        if (err) { clearTimeout(timer); pending = null; resolve(null); }
      });
    });
  }

  async function discoverCapability(ip) {
    const res = await sendGet(ip, 0x9F);
    if (!res || res.esv === 0x52 || !res.props.length) return null;
    const prop = res.props.find(p => p.epc === 0x9F);
    if (!prop || prop.edt.length === 0) return null;
    const all = parseBitmap(prop.edt);
    const supported = DESIRED_EPCS.filter(e => all.includes(e));
    const unsupported = DESIRED_EPCS.filter(e => !all.includes(e));
    return { supported, unsupported, source: 'property-map' };
  }

  async function ensureCapability(ip) {
    if (capabilities[ip]) return;
    const cap = await discoverCapability(ip);
    if (cap) {
      capabilities[ip] = cap;
    } else {
      capabilities[ip] = {
        supported: [...SAFE_EPCS],
        unsupported: DESIRED_EPCS.filter(e => !SAFE_EPCS.includes(e)),
        source: 'fallback',
      };
    }
  }

  async function pollDevice(ip) {
    await ensureCapability(ip);
    const cap = capabilities[ip];
    const result = { timestamp: Date.now(), values: {}, errors: {}, anySuccess: false, capability: cap };

    // Mark unsupported EPCs
    for (const epc of cap.unsupported) {
      result.errors[epc] = { reason: 'not supported' };
    }

    if (cap.supported.length === 0) return result;

    const res = await sendGet(ip, cap.supported);
    if (!res) {
      for (const epc of cap.supported) result.errors[epc] = { reason: 'no response' };
      return result;
    }

    if (res.esv === 0x52) {
      // Batch Get_SNA: fallback to individual single-EPC GETs
      for (const epc of cap.supported) {
        const single = await sendGet(ip, epc);
        if (!single) {
          result.errors[epc] = { reason: 'no response' };
        } else if (single.esv === 0x52) {
          result.errors[epc] = { reason: 'Get_SNA' };
        } else {
          const prop = single.props.find(p => p.epc === epc);
          if (prop) {
            const valid = isValidValue(epc, prop.edt);
            result.values[epc] = { raw: hex(prop.edt), dec: interpret(epc, prop.edt), valid };
            if (valid) result.anySuccess = true;
          } else {
            result.errors[epc] = { reason: 'unexpected response' };
          }
        }
      }
      return result;
    }

    // Normal batch response
    for (const epc of cap.supported) {
      const prop = res.props.find(p => p.epc === epc);
      if (prop) {
        const valid = isValidValue(epc, prop.edt);
        result.values[epc] = { raw: hex(prop.edt), dec: interpret(epc, prop.edt), valid };
        if (valid) result.anySuccess = true;
      } else {
        result.errors[epc] = { reason: 'missing in response' };
      }
    }
    return result;
  }

  async function init() {
    const bindArgs = localAddress ? [PORT, localAddress] : [PORT];
    await new Promise((resolve, reject) => {
      sock.bind(...bindArgs, (err) => { if (err) reject(err); else resolve(); });
    });
  }

  async function pollAll(devices) {
    const status = {};
    for (const device of devices) {
      status[device.ip] = await pollDevice(device.ip);
    }
    return status;
  }

  function close() { sock.close(); }

  return { init, pollAll, close };
}

module.exports = { createPoller, DESIRED_EPCS, SAFE_EPCS };
