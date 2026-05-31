const dgram = require('dgram');
const { PORT, EOJ_AC, EPC_NAME, hex, buildGet, parseEL, interpret, isValidValue } = require('./echonet');

const EPC_LIST = [0x80, 0x88, 0x84, 0x85, 0xB0, 0xB3, 0xBA, 0xBB, 0xBE];

function createPoller(localAddress, requestTimeoutMs) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let tidCounter = 1;
  let pending = null;

  sock.on('message', (msg, rinfo) => {
    if (rinfo.address === localAddress) return;
    if (pending && rinfo.address === pending.targetIP) {
      const p = parseEL(msg);
      if (p && p.tid === pending.tid) {
        pending.resolve(p);
      }
    }
  });
  sock.on('error', () => {});

  function sendGet(targetIP, epc) {
    return new Promise((resolve) => {
      const tid = tidCounter++;
      const req = buildGet(EOJ_AC, epc, tid);
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
    await new Promise((resolve) => sock.bind(PORT, localAddress, resolve));
  }

  async function pollDevice(ip) {
    const result = { timestamp: Date.now(), values: {}, errors: {}, anySuccess: false };
    for (const epc of EPC_LIST) {
      const res = await sendGet(ip, epc);
      if (!res) {
        result.errors[epc] = { reason: 'no response' };
      } else if (res.esv === 0x52) {
        result.errors[epc] = { reason: 'Get_SNA' };
      } else {
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
          result.errors[epc] = { reason: 'unexpected response', raw: hex(res) };
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
