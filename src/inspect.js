const dgram = require('dgram');
const os = require('os');
const { PORT, EOJ_AC, EPC_NAME, hex, eojName, esvName, buildGet, parseEL, parseBitmap, interpret } = require('./echonet');

const INTERESTING = [0x80, 0x83, 0x84, 0x85, 0x88, 0x8A, 0xB0, 0xB3, 0xBA, 0xBB, 0xBE];

function warnNoInterface(addr) {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    if (addrs.some(a => a.family === 'IPv4' && a.address === addr)) return;
  }
  console.warn(`warning: address "${addr}" not found in network interfaces.`);
}

function help() {
  console.log('ECHONET Lite Inspect - Read EPCs from a Home Air Conditioner');
  console.log('');
  console.log('Usage:');
  console.log('  node src/inspect.js --local-address <IP> --target <IP> [--target <IP> ...] [options]');
  console.log('  npm run inspect -- --local-address <IP> --target <IP>');
  console.log('');
  console.log('Options:');
  console.log('  --local-address <IP>    Source IPv4 address for binding');
  console.log('  --target <IP>           Target AC IP (repeatable for multiple units)');
  console.log('  --timeout <ms>          Per-request timeout (default: 5000)');
  console.log('  --help, -h              Show this help');
}

function parseArgs() {
  const args = process.argv.slice(2);
  let localAddress = null;
  const targets = [];
  let timeout = 5000;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--local-address':
        if (++i >= args.length) { console.error('error: --local-address requires an argument'); process.exit(1); }
        localAddress = args[i];
        break;
      case '--target':
        if (++i >= args.length) { console.error('error: --target requires an argument'); process.exit(1); }
        targets.push(args[i]);
        break;
      case '--timeout':
        if (++i >= args.length) { console.error('error: --timeout requires an argument'); process.exit(1); }
        timeout = parseInt(args[i], 10);
        if (isNaN(timeout) || timeout <= 0) { console.error('error: --timeout must be a positive number'); process.exit(1); }
        break;
      case '--help': case '-h': help(); process.exit(0);
      default: console.error(`error: unknown option: ${args[i]}`); help(); process.exit(1);
    }
  }
  if (targets.length === 0) { console.error('error: at least one --target is required'); process.exit(1); }
  return { localAddress, targets, timeout };
}

async function main() {
  const { localAddress, targets, timeout } = parseArgs();
  warnNoInterface(localAddress);

  console.log(`ECHONET Lite Inspect`);
  console.log(`  Source:  ${localAddress}`);
  console.log(`  Targets: ${targets.join(', ')}`);
  console.log(`  EOJ:     ${eojName(EOJ_AC)} (Home Air Conditioner)`);
  console.log('');

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

  sock.on('error', (err) => {
    console.error(`socket error: ${err.message}`);
    process.exit(1);
  });

  function sendGet(targetIP, deoj, epc) {
    return new Promise((resolve) => {
      const tid = tidCounter++;
      const req = buildGet(deoj, epc, tid);
      const timer = setTimeout(() => {
        if (pending && pending.targetIP === targetIP && pending.tid === tid) {
          pending = null;
          resolve(null);
        }
      }, timeout);

      pending = { targetIP, tid, resolve: (result) => { clearTimeout(timer); resolve(result); } };
      sock.send(req, 0, req.length, PORT, targetIP, (err) => {
        if (err) {
          clearTimeout(timer);
          pending = null;
          console.error(`  send error to ${targetIP}: ${err.message}`);
          resolve(null);
        }
      });
    });
  }

  await new Promise((resolveBind) => {
    sock.bind(PORT, localAddress || undefined, resolveBind);
  });

  for (const ip of targets) {
    console.log(`===== ${ip} =====`);
    console.log('');

    const propRes = await sendGet(ip, EOJ_AC, 0x9F);
    if (!propRes) {
      console.log('  [No response for Get(0x9F)]\n');
      continue;
    }

    if (propRes.esv === 0x52) {
      console.log(`  ESV=0x52 (Get_SNA)\n`);
      continue;
    }

    const rawEdt = propRes.props.find(p => p.epc === 0x9F);
    if (!rawEdt || rawEdt.edt.length === 0) {
      console.log('  [No property map data]\n');
      continue;
    }

    console.log(`  Property map bitmap (${rawEdt.edt.length} bytes): ${hex(rawEdt.edt)}`);
    console.log('');

    const propCodes = parseBitmap(rawEdt.edt);
    const inMap = [];
    const notInMap = [];
    for (const epc of INTERESTING) {
      if (propCodes.includes(epc)) inMap.push(epc); else notInMap.push(epc);
    }
    console.log(`  In bitmap:  ${inMap.map(e => `0x${e.toString(16).padStart(2, '0')}`).join(' ')}`);
    console.log(`  Not in bitmap: ${notInMap.map(e => `0x${e.toString(16).padStart(2, '0')}`).join(' ')}`);
    console.log('');

    for (const targetEpc of INTERESTING) {
      const inBmp = propCodes.includes(targetEpc);
      console.log(`  0x${targetEpc.toString(16).padStart(2, '0')}  ${EPC_NAME[targetEpc] || ''}  ${inBmp ? '' : '(not in bitmap)'}`);

      const valRes = await sendGet(ip, EOJ_AC, targetEpc);
      if (!valRes) {
        console.log(`    No response`);
        console.log('');
        continue;
      }
      if (valRes.esv === 0x52) {
        console.log(`    Get_SNA`);
        console.log('');
        continue;
      }

      for (const p of valRes.props) {
        if (p.epc === targetEpc) {
          const edtHex = p.edt.length ? hex(p.edt) : '(empty)';
          const interpreted = interpret(targetEpc, p.edt);
          console.log(`    EDT: ${edtHex}`);
          console.log(`    Dec: ${interpreted}`);
        }
      }
      console.log('');
    }
  }

  sock.close();
}

main();
