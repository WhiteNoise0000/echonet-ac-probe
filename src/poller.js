const dgram = require('dgram');
const { PORT, EOJ_AC, EPC_NAME, hex, buildGet, parseEL, interpret, isValidValue } = require('./echonet');

const EPC_LIST = [0x80, 0x83, 0x88, 0x84, 0x85, 0x8A, 0xB0, 0xB3, 0xBA, 0xBB, 0xBE];

function createPoller(localAddress, requestTimeoutMs) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let tidCounter = 1;
  let pending = null;

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
        resolve: (r) => { clearTimeout(timer); resolve(r); },
      };
      sock.send(req, 0, req.length, PORT, targetIP, (err) => {
        if (err) { clearTimeout(timer); pending = null; resolve(null); }
      });
    });
  }

  async function init() {
    const bindArgs = localAddress ? [PORT, localAddress] : [PORT];
    await new Promise((resolve) => sock.bind(...bindArgs, resolve));
  }

  async function pollDevice(ip) {
    const result = { timestamp: Date.now(), values: {}, errors: {}, anySuccess: false };
    const res = await sendGet(ip, EPC_LIST);
    if (!res) {
      for (const epc of EPC_LIST) result.errors[epc] = { reason: 'no response' };
    } else if (res.esv === 0x52) {
      for (const epc of EPC_LIST) result.errors[epc] = { reason: 'Get_SNA' };
    } else {
      for (const epc of EPC_LIST) {
        const prop = res.props.find(p => p.epc === epc);
        if (prop) {
          const valid = isValidValue(epc, prop.edt);
          result.values[epc] = {
            raw: hex(prop.edt),
            dec: interpret(epc, prop.edt),
            valid,
          };
          if (valid) result.anySuccess = true;
        } else {
          result.errors[epc] = { reason: 'missing in response' };
        }
      }
    }
    return result;
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

module.exports = { createPoller, EPC_LIST };
