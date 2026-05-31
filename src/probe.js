const dgram = require('dgram');
const os = require('os');

const MULTICAST_ADDR = '224.0.23.0';
const PORT = 3610;

function help() {
  console.log('ECHONET Lite Probe - Discover ECHONET Lite devices on LAN');
  console.log('');
  console.log('Usage:');
  console.log('  node src/probe.js --local-address <IP> [options]');
  console.log('  npm run probe -- --local-address <IP> [options]');
  console.log('');
  console.log('Modes (mutually exclusive):');
  console.log('  (no --target, no --scan)  Multicast to 224.0.23.0:3610 (default)');
  console.log('  --target <IP>             Unicast directly to a specific IP');
  console.log('  --scan                    Scan /24 subnet sequentially, stop on first hit');
  console.log('  --scan-all                Scan /24 subnet fully, show all responses');
  console.log('');
  console.log('Options:');
  console.log('  --local-address <IP>      Source IPv4 address for binding');
  console.log('  --timeout <ms>            Response wait time (default: 10000)');
  console.log('  --scan-interval <ms>      Delay between scan probes (default: 300)');
  console.log('  --help, -h                Show this help');
}

function parseArgs() {
  const args = process.argv.slice(2);
  let localAddress = null;
  let target = null;
  let scan = false;
  let scanAll = false;
  let scanInterval = 300;
  let timeout = 10000;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--local-address':
        if (++i >= args.length) { console.error('error: --local-address requires an argument'); process.exit(1); }
        localAddress = args[i];
        break;
      case '--target':
        if (++i >= args.length) { console.error('error: --target requires an argument'); process.exit(1); }
        target = args[i];
        break;
      case '--scan':
        scan = true;
        break;
      case '--scan-all':
        scanAll = true;
        break;
      case '--scan-interval':
        if (++i >= args.length) { console.error('error: --scan-interval requires an argument'); process.exit(1); }
        scanInterval = parseInt(args[i], 10);
        if (isNaN(scanInterval) || scanInterval <= 0) { console.error('error: --scan-interval must be a positive number'); process.exit(1); }
        break;
      case '--timeout':
        if (++i >= args.length) { console.error('error: --timeout requires an argument'); process.exit(1); }
        timeout = parseInt(args[i], 10);
        if (isNaN(timeout) || timeout <= 0) { console.error('error: --timeout must be a positive number'); process.exit(1); }
        break;
      case '--help': case '-h': help(); process.exit(0);
      default:
        console.error(`error: unknown option: ${args[i]}`); help(); process.exit(1);
    }
  }
  if (scanAll) scan = true;
  return { localAddress, target, scan, scanAll, scanInterval, timeout };
}

function warnNoInterface(addr) {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    if (addrs.some(a => a.family === 'IPv4' && a.address === addr)) return;
  }
  console.warn(`warning: address "${addr}" not found in network interfaces. multicast may fail.`);
}

function buildGet(epc) {
  const b = Buffer.alloc(14);
  b[0] = 0x10;
  b[1] = 0x81;
  b.writeUInt16BE(1, 2);
  b[4] = 0x0E; b[5] = 0xF0; b[6] = 0x01;
  b[7] = 0x0E; b[8] = 0xF0; b[9] = 0x01;
  b[10] = 0x62; // Get
  b[11] = 0x01; // OPC
  b[12] = epc;
  b[13] = 0x00; // PDC
  return b;
}

function hex(buf) {
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function parseEL(msg) {
  if (msg.length < 12 || msg[0] !== 0x10 || msg[1] !== 0x81) return null;
  const tid = msg.readUInt16BE(2);
  const seoj = msg.slice(4, 7);
  const deoj = msg.slice(7, 10);
  const esv = msg[10];
  const opc = msg[11];
  const props = [];
  let off = 12;
  for (let i = 0; i < opc; i++) {
    if (off + 1 > msg.length) break;
    const epc = msg[off++];
    if (off + 1 > msg.length) break;
    const pdc = msg[off++];
    if (off + pdc > msg.length) break;
    const edt = msg.slice(off, off + pdc);
    off += pdc;
    props.push({ epc, pdc, edt });
  }
  return { tid, seoj, deoj, esv, opc, props };
}

function esvName(v) {
  const m = {
    0x50: 'SetI', 0x51: 'SetC', 0x52: 'Get_SNA',
    0x53: 'SetI_SNA', 0x54: 'SetC_SNA',
    0x60: 'Set', 0x61: 'Set_Get', 0x62: 'Get',
    0x63: 'Inf', 0x64: 'SetGet_SNA', 0x65: 'Set_Get_SNA',
    0x6E: 'InfC',
    0x71: 'Set_Res', 0x72: 'Get_Res', 0x73: 'Inf_Res',
    0x74: 'SetGet_Res', 0x75: 'Set_Get_Res', 0x7E: 'InfC_Res',
    0x80: 'SetI_SVA', 0x81: 'SetC_SVA', 0x82: 'Get_SVA',
  };
  return m[v] || `0x${v.toString(16).padStart(2, '0')}`;
}

function eojName(b) {
  const g = b[0].toString(16).padStart(2, '0');
  const c = b[1].toString(16).padStart(2, '0');
  const i = b[2].toString(16).padStart(2, '0');
  return `0x${g}${c}${i}`;
}

function showEOJList(edt) {
  let offset = 0;
  if (edt.length % 3 === 1) {
    offset = 1;
  } else if (edt.length % 3 === 2) {
    offset = 2;
  }
  const list = [];
  for (let i = offset; i + 3 <= edt.length; i += 3) {
    const eoj = edt.slice(i, i + 3);
    const label = eojName(eoj);
    const isAC = eoj[0] === 0x01 && eoj[1] === 0x30;
    list.push({ label, isAC });
  }
  console.log(`  EOJ List (${list.length} objects):`);
  for (const e of list) {
    const marker = e.isAC ? '  ← Home Air Conditioner candidate' : '';
    console.log(`    ${e.label}${marker}`);
  }
}

function subnetIPs(localAddress) {
  const parts = localAddress.split('.');
  if (parts.length !== 4) return [];
  const prefix = parts.slice(0, 3).join('.');
  const self = parseInt(parts[3], 10);
  const ips = [];
  for (let i = 1; i <= 254; i++) {
    if (i !== self) ips.push(`${prefix}.${i}`);
  }
  return ips;
}

function run() {
  const { localAddress, target, scan, scanAll, scanInterval, timeout } = parseArgs();

  if (!localAddress) {
    console.error('error: --local-address is required (use --help for details)');
    process.exit(1);
  }
  warnNoInterface(localAddress);

  let isUnicast = !!target;
  let destAddr = target || MULTICAST_ADDR;
  let scanTargets = null;

  if (scan) {
    isUnicast = true;
    scanTargets = subnetIPs(localAddress);
    if (scanTargets.length === 0) {
      console.error('error: could not derive subnet from local address');
      process.exit(1);
    }
    destAddr = scanTargets[0];
  }

  console.log(`ECHONET Lite Probe`);
  console.log(`  Mode:      ${scan ? `Scan (${scanTargets.length} hosts, ${scanInterval}ms interval)` : isUnicast ? 'Unicast' : 'Multicast'}`);
  console.log(`  Target:    ${scan ? `${localAddress.replace(/\d+$/, '')}0/24` : `${destAddr}:${PORT}`}`);
  console.log(`  Source:    ${localAddress}`);
  console.log(`  Query:     Node Profile (0x0EF001) EPC 0xD6 (Instance List S)`);
  console.log('');

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let gotResponse = false;
  let req = buildGet(0xD6);

  function handleResponse(msg, rinfo) {
    if (rinfo.address === localAddress) return;
    gotResponse = true;
    const p = parseEL(msg);
    if (!p) return;

    console.log(`Response from ${rinfo.address}`);
    console.log(`  Raw Hex:  ${hex(msg)}`);
    console.log(`  SEOJ:     ${eojName(p.seoj)}`);
    console.log(`  DEOJ:     ${eojName(p.deoj)}`);
    console.log(`  ESV:      0x${p.esv.toString(16).padStart(2, '0')} (${esvName(p.esv)})`);
    for (const prop of p.props) {
      const edtHex = prop.edt.length ? hex(prop.edt) : '(empty)';
      console.log(`  EPC:      0x${prop.epc.toString(16).padStart(2, '0')}`);
      console.log(`  PDC:      ${prop.pdc}`);
      console.log(`  EDT:      ${edtHex}`);
      if (prop.epc === 0xD6 && prop.edt.length > 0) {
        showEOJList(prop.edt);
      }
    }
    console.log('');
  }

  sock.on('message', handleResponse);

  sock.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`error: port ${PORT} is already in use. close the other application and retry.`);
    } else {
      console.error(`socket error: ${err.message}`);
    }
    process.exit(1);
  });

  sock.bind(PORT, localAddress, () => {
    if (scan || !target) {
      sock.addMembership(MULTICAST_ADDR, localAddress);
    }
    sock.setMulticastLoopback(false);

    if (scan) {
      let idx = 0;
      function sendNext() {
        if (idx >= scanTargets.length) {
          finish();
          return;
        }
        if (!scanAll && gotResponse) {
          finish();
          return;
        }
        const ip = scanTargets[idx++];
        sock.send(req, 0, req.length, PORT, ip, (err) => {
          if (err) {
            console.error(`send error to ${ip}: ${err.message}`);
          }
        });
        setTimeout(sendNext, scanInterval);
      }
      console.log(`Scanning ${scanTargets.length} hosts...`);
      sendNext();
    } else {
      sock.send(req, 0, req.length, PORT, destAddr, (err) => {
        if (err) {
          console.error(`send error: ${err.message}`);
          sock.close();
          process.exit(1);
        }
        console.log(`Sent Get(EPC=0xD6) to ${destAddr}:${PORT}`);
      });
    }
  });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    sock.close();
    if (!gotResponse) {
      console.log('No ECHONET Lite responses received.');
      console.log('');
      if (scan) {
        console.log('Troubleshooting (scan):');
        console.log(`  1. No ECHONET Lite device found on the ${localAddress.replace(/\d+$/, '')}0/24 subnet`);
        console.log(`  2. Devices may be on a different subnet (check with ipconfig / arp -a)`);
        console.log(`  3. AP isolation (client isolation) may be blocking unicast too`);
        console.log(`  4. Windows Firewall on the target devices may block UDP/3610`);
        console.log(`  5. Device may not have HEMS/ECHONET Lite mode enabled`);
      } else if (isUnicast) {
        console.log(`Troubleshooting (unicast to ${target}):`);
        console.log(`  1. Confirm the target IP is correct and the device is online`);
        console.log(`     (try "ping ${target}" to verify)`);
        console.log(`  2. Windows Firewall on the target may block UDP/3610`);
        console.log(`  3. Device may not have ECHONET Lite mode enabled`);
        console.log('  4. Try multicast mode instead (omit --target)');
      } else {
        console.log('Troubleshooting (multicast):');
        console.log(`  1. Confirm that --local-address is your actual LAN IPv4 address`);
        console.log('     (run "ipconfig" to verify)');
        console.log('  2. Windows Firewall may be blocking inbound UDP/3610');
        console.log('     (try: netsh advfirewall firewall add rule name="EL-Probe"');
        console.log('            protocol=UDP dir=in localport=3610 action=allow)');
        console.log('  3. AP isolation (client isolation) on the Wi-Fi access point');
        console.log('     prevents device-to-device communication');
        console.log('  4. Device may not have HEMS/ECHONET Lite mode enabled');
        console.log('     (check OP-J03DZ settings)');
        console.log('  5. Device may be on a different VLAN/subnet');
        console.log('  6. Try unicast mode with --target <IP>');
        console.log('  7. Try running as Administrator (required on some Windows configs)');
      }
    }
    process.exit(0);
  }

  if (scan) {
    const totalScanTime = scanTargets.length * scanInterval + timeout;
    setTimeout(finish, totalScanTime);
  } else {
    setTimeout(finish, timeout);
  }
}

run();
