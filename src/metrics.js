const STALE_MS = 90000;

function renderMetrics(devices, latestStatus, now = Date.now()) {
    const lines = [];


    function esc(v) { return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`; }

    function labelStr(device) {
      return `id=${esc(device.id)},name=${esc(device.name)},room=${esc(device.room)},ip=${esc(device.ip)}`;
    }

    lines.push('# HELP nocria_ac_up Device reachability (1=up, 0=down)');
    lines.push('# TYPE nocria_ac_up gauge');
    lines.push('# HELP nocria_ac_stale Data is stale (>90s since last success)');
    lines.push('# TYPE nocria_ac_stale gauge');
    for (const device of devices) {
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
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const lsa = s.lastSuccessAt || 0;
      lines.push(`nocria_ac_last_success_timestamp_seconds{${labelStr(device)}} ${(lsa / 1000).toFixed(3)}`);
    }

    lines.push('# HELP nocria_ac_operation_status Operation status (1=ON, 0=OFF)');
    lines.push('# TYPE nocria_ac_operation_status gauge');
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x80];
      if (v && v.valid && /^(30|31)$/i.test(v.raw)) lines.push(`nocria_ac_operation_status{${labelStr(device)}} ${v.raw.toLowerCase() === '30' ? 1 : 0}`);
    }

    lines.push('# HELP nocria_ac_error_status Error status (1=fault, 0=normal)');
    lines.push('# TYPE nocria_ac_error_status gauge');
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x88];
      if (v && v.valid && /^(41|42)$/i.test(v.raw)) lines.push(`nocria_ac_error_status{${labelStr(device)}} ${v.raw.toLowerCase() === '41' ? 1 : 0}`);
    }

    lines.push('# HELP nocria_ac_instant_power_w Instantaneous power in watts');
    lines.push('# TYPE nocria_ac_instant_power_w gauge');
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x84];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_instant_power_w{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_total_energy_kwh Cumulative energy in kWh');
    lines.push('# TYPE nocria_ac_total_energy_kwh gauge');
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0x85];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_total_energy_kwh{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_set_temperature_c Set temperature in Celsius');
    lines.push('# TYPE nocria_ac_set_temperature_c gauge');
    lines.push('# HELP nocria_ac_set_temperature_valid Whether set temperature data is valid (1=valid, 0=auto/unavailable)');
    lines.push('# TYPE nocria_ac_set_temperature_valid gauge');
    for (const device of devices) {
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
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xBB];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_room_temperature_c{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_room_humidity_percent Room humidity in percent');
    lines.push('# TYPE nocria_ac_room_humidity_percent gauge');
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xBA];
      if (v && v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_room_humidity_percent{${labelStr(device)}} ${n}`); }
    }

    lines.push('# HELP nocria_ac_outdoor_temperature_c Outdoor temperature in Celsius');
    lines.push('# TYPE nocria_ac_outdoor_temperature_c gauge');
    lines.push('# HELP nocria_ac_outdoor_temperature_valid Whether outdoor temperature data is valid');
    lines.push('# TYPE nocria_ac_outdoor_temperature_valid gauge');
    for (const device of devices) {
      const s = latestStatus[device.ip];
      if (!s) continue;
      const v = s.values && s.values[0xBE];
      if (v) {
        lines.push(`nocria_ac_outdoor_temperature_valid{${labelStr(device)}} ${v.valid ? 1 : 0}`);
        if (v.valid) { const n = parseFloat(v.dec); if (!isNaN(n)) lines.push(`nocria_ac_outdoor_temperature_c{${labelStr(device)}} ${n}`); }
      }
    }

    lines.push('# HELP nocria_ac_operation_mode Operation mode (one-hot; independent of ON/OFF)');
    lines.push('# TYPE nocria_ac_operation_mode gauge');
    lines.push('# HELP nocria_ac_device_info Device identification and manufacturer code');
    lines.push('# TYPE nocria_ac_device_info gauge');
    for (const device of devices) {
      const values = latestStatus[device.ip]?.values || {};
      const mode = values[0xB0];
      const modes = { '41': 'auto', '42': 'cooling', '43': 'heating', '44': 'dehumidification', '45': 'fan', '46': 'other' };
      const selected = mode?.valid && modes[mode.raw.toLowerCase()];
      if (selected) {
        for (const name of Object.values(modes)) {
          lines.push(`nocria_ac_operation_mode{${labelStr(device)},mode=${esc(name)}} ${name === selected ? 1 : 0}`);
        }
      }
      const identification = values[0x83];
      const manufacturer = values[0x8A];
      if (identification?.valid && /^(?:[0-9a-f]{2} )*[0-9a-f]{2}$/i.test(identification.raw) &&
          manufacturer?.valid && /^[0-9a-f]{2} [0-9a-f]{2} [0-9a-f]{2}$/i.test(manufacturer.raw)) {
        lines.push(`nocria_ac_device_info{${labelStr(device)},identification=${esc(identification.raw)},manufacturer_code=${esc(manufacturer.raw)}} 1`);
      }
    }

    lines.push('');
    return lines.join('\n');
}

module.exports = { renderMetrics };
