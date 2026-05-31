const PORT = 3610;
const EOJ_AC = 0x013001;

const EPC_NAME = {
  0x80: '動作状態 (Operating status)',
  0x83: '識別番号 (Identification number)',
  0x84: '瞬時消費電力 (Instantaneous power) [W]',
  0x85: '積算消費電力量 (Cumulative power) [0.001kWh]',
  0x88: '異常発生状態 (Error status)',
  0x8A: 'メーカーコード (Manufacturer code)',
  0xB0: '運転モード (Operation mode)',
  0xB3: '設定温度 (Set temperature)',
  0xBA: '室内湿度 (Indoor humidity)',
  0xBB: '室内温度 (Indoor temperature)',
  0xBE: '外気温度 (Outdoor temperature)',
};

function hex(buf) {
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function eojName(v) {
  const g = (v >> 16) & 0xFF;
  const c = (v >> 8) & 0xFF;
  const i = v & 0xFF;
  return `0x${g.toString(16).padStart(2, '0')}${c.toString(16).padStart(2, '0')}${i.toString(16).padStart(2, '0')}`;
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

function buildGet(deoj, epcOrList, tid) {
  const epcs = Array.isArray(epcOrList) ? epcOrList : [epcOrList];
  const b = Buffer.alloc(12 + epcs.length * 2);
  b[0] = 0x10;
  b[1] = 0x81;
  b.writeUInt16BE(tid, 2);
  b[4] = 0x0E; b[5] = 0xF0; b[6] = 0x01;
  b[7] = (deoj >> 16) & 0xFF;
  b[8] = (deoj >> 8) & 0xFF;
  b[9] = deoj & 0xFF;
  b[10] = 0x62;
  b[11] = epcs.length;
  for (let i = 0; i < epcs.length; i++) {
    b[12 + i * 2] = epcs[i];
    b[12 + i * 2 + 1] = 0x00;
  }
  return b;
}

function parseEL(msg) {
  if (msg.length < 12 || msg[0] !== 0x10 || msg[1] !== 0x81) return null;
  const tid = msg.readUInt16BE(2);
  const seoj = msg.readUIntBE(4, 3);
  const deoj = msg.readUIntBE(7, 3);
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
  return { tid, seoj, deoj, esv, props };
}

function parseBitmap(edt) {
  const codes = [];
  if (edt.length === 0) return codes;
  const first = edt[0];
  if (first < 16 && edt.length >= first + 1) {
    for (let i = 1; i <= first; i++) {
      codes.push(edt[i]);
    }
  } else {
    const bmp = edt.slice(1, 17);
    for (let byteIdx = 0; byteIdx < bmp.length; byteIdx++) {
      const b = bmp[byteIdx];
      for (let bit = 0; bit < 8; bit++) {
        if (b & (1 << bit)) {
          codes.push(0x80 + byteIdx + bit * 0x10);
        }
      }
    }
  }
  return codes.sort((a, b) => a - b);
}

function interpret(epc, edt) {
  const h = hex(edt);
  switch (epc) {
    case 0x80:
      if (edt.length >= 1) return edt[0] === 0x30 ? 'ON' : 'OFF';
      return h;
    case 0x83:
      return h;
    case 0x84:
      if (edt.length === 2) return `${edt.readUInt16BE(0)} W`;
      if (edt.length >= 4) return `${edt.readUInt32BE(0)} W`;
      return `${h} (?B)`;
    case 0x85:
      if (edt.length >= 4) return `${(edt.readUInt32BE(0) * 0.001).toFixed(3)} kWh`;
      if (edt.length === 2) return `${(edt.readUInt16BE(0) * 0.001).toFixed(3)} kWh`;
      return `${h} (?B)`;
    case 0x8A:
      return h;
    case 0x88:
      if (edt.length >= 1) return edt[0] === 0x41 ? '異常あり (Fault)' : '異常なし (Normal)';
      return h;
    case 0xB0:
      if (edt.length >= 1) {
        const modes = { 0x41: '自動', 0x42: '冷房', 0x43: '暖房', 0x44: '除湿', 0x45: '送風', 0x46: 'その他' };
        return modes[edt[0]] || `0x${edt[0].toString(16).padStart(2, '0')}`;
      }
      return h;
    case 0xB3:
      if (edt.length >= 2) return `${(edt.readInt16BE(0) / 10).toFixed(1)} °C`;
      if (edt.length === 1) {
        if (edt[0] >= 0xF0) return '自動制御';
        return `${edt[0]} °C`;
      }
      return `${h} (?B)`;
    case 0xBA:
      if (edt.length >= 1) return `${edt[0]} %`;
      return h;
    case 0xBB:
      if (edt.length >= 2) return `${(edt.readInt16BE(0) / 10).toFixed(1)} °C`;
      if (edt.length === 1) return `${edt[0]} °C`;
      return `${h} (?B)`;
    case 0xBE:
      if (edt.length >= 2) return `${(edt.readInt16BE(0) / 10).toFixed(1)} °C`;
      if (edt.length === 1) return `${edt[0]} °C`;
      return `${h} (?B)`;
    default:
      return h;
  }
}

const TEMP_SENTINEL = 0x7E; // 126 / 0x7E means "not available"

function isValidValue(epc, edt) {
  if (!edt || edt.length === 0) return false;
  const temps = [0xBB, 0xBE];
  if (temps.includes(epc) && edt.length === 1 && edt[0] >= TEMP_SENTINEL) return false;
  if (epc === 0xB3 && edt.length === 1 && edt[0] >= 0xF0) return false;
  return true;
}

module.exports = { PORT, EOJ_AC, EPC_NAME, hex, eojName, esvName, buildGet, parseEL, parseBitmap, interpret, isValidValue };
