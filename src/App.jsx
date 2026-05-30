import { useState } from 'react'
import { ExhaustViewer, PortViewer, ECUViewer } from './components/Viewer3D'

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n, dec = 1) => {
  if (n === null || n === undefined) return '—'
  if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return '—'
  return n.toFixed(dec)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const toRad = deg => deg * Math.PI / 180
const toDeg = rad => rad * 180 / Math.PI

// ─── calculation engines ────────────────────────────────────────────────────
function calcExhaustData(p) {
  const { rpm, cc, exDur, dPort, type, diffStages, sos } = p

  const L_total = ((360 - exDur) / 360) * (60 / rpm) * sos * 1000

  const headerMap = { roadrace: 266, motocross: 210, enduro: 220 }
  const L_header = headerMap[type] ?? 266

  const D_belly = dPort * 2.5

  // diffuser angle: last stage angle
  const diffAngleMap = {
    roadrace: { 1: [7], 2: [4.5, 7], 3: [4, 6, 8] },
    motocross: { 1: [4], 2: [3, 5], 3: [3, 5, 5] },
    enduro: { 1: [4], 2: [3, 5], 3: [3, 5, 5] },
  }
  const angles = diffAngleMap[type]?.[diffStages] ?? [7]
  const alpha_diff = angles[angles.length - 1]
  const L_diffuser = (D_belly - dPort) / (2 * Math.tan(toRad(alpha_diff)))

  const baffleAngleMap = { roadrace: 10.75, motocross: 9, enduro: 9 }
  const alpha_baffle = baffleAngleMap[type] ?? 10.75

  const stingerTable = [
    { maxCc: 80, len: 217, id: 18 },
    { maxCc: 100, len: 240, id: 20 },
    { maxCc: 125, len: 277, id: 23 },
    { maxCc: 175, len: 282, id: 26 },
    { maxCc: 250, len: 292, id: 27 },
    { maxCc: Infinity, len: 297, id: 28 },
  ]
  const stinger = stingerTable.find(s => cc <= s.maxCc) ?? stingerTable[stingerTable.length - 1]
  const L_stinger = type === 'roadrace' ? Math.min(stinger.len, 200) : stinger.len
  const D_stinger = stinger.id

  const L_baffle_total = (D_belly - D_stinger) / (2 * Math.tan(toRad(alpha_baffle)))
  const L_baffle = L_baffle_total / 2

  const L_belly = L_total - L_header - L_diffuser - L_baffle - L_stinger

  let bellyStatus = 'ok'
  let bellyMsg = ''
  if (L_belly < 0) { bellyStatus = 'danger'; bellyMsg = 'Belly negatif — RPM target terlalu tinggi atau exhaust duration terlalu pendek' }
  else if (L_belly < 20) { bellyStatus = 'warn'; bellyMsg = 'Belly sangat pendek — power band akan sempit' }

  return {
    L_total, L_header, L_diffuser, L_belly, L_baffle, L_stinger,
    D_belly, D_stinger, alpha_diff, alpha_baffle, diffAngles: angles,
    bellyStatus, bellyMsg,
  }
}

function calcPortData(p) {
  const { bore, stroke, conrod, E, C, Et, Vc, rpm } = p
  const R = stroke / 2

  const T = R + conrod + C - E
  const ratio = T / R
  let exDur = null, exDurValid = true
  if (Math.abs(ratio) > 1) { exDurValid = false }
  else { exDur = (180 - toDeg(Math.acos(ratio))) * 2 }

  const T_tr = R + conrod + C - Et
  const ratioTr = T_tr / R
  let trDur = null, trDurValid = true
  if (Math.abs(ratioTr) > 1) { trDurValid = false }
  else { trDur = (180 - toDeg(Math.acos(ratioTr))) * 2 }

  const blowdown = exDur !== null && trDur !== null ? exDur - trDur : null
  let blowdownStatus = 'ok'
  if (blowdown !== null) {
    if (blowdown < 20) blowdownStatus = 'danger'
    else if (blowdown > 40) blowdownStatus = 'warn'
  }

  const Vd = (Math.PI / 4) * bore * bore * stroke / 1000
  const Cr = Vc > 0 ? (Vd + Vc) / Vc : null
  let crStatus = 'ok'
  if (Cr !== null) {
    if (Cr > 14) crStatus = 'danger'
    else if (Cr > 13) crStatus = 'warn'
  }

  const Vp = 2 * stroke * rpm / 60 / 1000
  let vpStatus = 'ok'
  if (Vp > 20) vpStatus = 'danger'
  else if (Vp >= 15) vpStatus = 'warn'

  const EPO = exDur !== null ? 180 - exDur / 2 : null
  const EPC = exDur !== null ? 180 + exDur / 2 : null
  const TPO = trDur !== null ? 180 - trDur / 2 : null
  const TPC = trDur !== null ? 180 + trDur / 2 : null

  return {
    exDur, exDurValid, trDur, trDurValid,
    blowdown, blowdownStatus,
    Vd, Cr, crStatus,
    Vp, vpStatus,
    EPO, EPC, TPO, TPC,
  }
}

function calcECUData(p) {
  const { rpmCurrent, tps, map, temp, lambda, oktan, rpmPeak, cr } = p

  const rpm_ratio = rpmPeak > 0 ? rpmCurrent / rpmPeak : 0

  const failsafe = temp > 105 || map < 30 || lambda < 0.70

  const ign_base = 2.5 + (oktan - 87) * 0.08 + (cr - 10) * 0.15
  const delta_rpm = rpm_ratio < 0.6 ? -1.5 : rpm_ratio > 0.9 ? 0.5 : 0
  const delta_map = map < 70 ? -2.0 : map > 95 ? 1.0 : 0
  const delta_temp = temp > 90 ? -1.5 : temp < 40 ? -0.5 : 0
  const delta_tps = tps < 30 ? -1.0 : 0
  let ign_final = clamp(ign_base + delta_rpm + delta_map + delta_temp + delta_tps, 1.5, 4.0)
  if (failsafe) ign_final = 1.8

  const fuel_base = (rpmCurrent / rpmPeak) * 8 + 2
  const delta_lambda = lambda > 1.05 ? -0.8 : lambda < 0.90 ? 0.8 : lambda < 0.95 ? 0.4 : 0
  const delta_tps_fuel = tps > 80 ? 1.2 : tps < 20 ? -0.8 : 0
  let fuel_final = failsafe ? fuel_base : clamp(fuel_base + delta_lambda + delta_tps_fuel, 1.5, 12.0)

  const rpmZone =
    rpm_ratio < 0.60 ? 'Low RPM' :
    rpm_ratio < 0.80 ? 'Mid RPM' :
    rpm_ratio < 0.95 ? 'Power band' :
    rpm_ratio < 1.10 ? 'Peak power' : 'Over-rev'

  const lambdaStatus =
    lambda > 1.10 ? 'Lean — tambah fuel' :
    lambda > 1.05 ? 'Sedikit lean' :
    lambda >= 0.90 ? 'Stoikiometri ideal' :
    lambda >= 0.85 ? 'Rich — power optimal' :
    'Terlalu rich — emisi naik'

  const recs = []
  if (lambda > 1.05) recs.push(`Naikkan duty cycle injector ~${Math.round((lambda - 1) * 100)}%`)
  if (lambda < 0.90) recs.push(`Kurangi fuel pulse ~${fmt(Math.abs(delta_lambda), 1)} ms`)
  if (rpm_ratio > 1.05) recs.push(`Retard ignition 0.3mm per 500 RPM kelebihan`)
  if (temp > 90) recs.push('Naikkan fuel 5–8% untuk efek pendinginan')

  return {
    ign_final, fuel_final, rpmZone, lambdaStatus,
    rpm_ratio, failsafe, recs,
    fuel_base, ign_base,
  }
}

function calcGasFlow(port, exhaust, octane) {
  const { dur_ex = 196, dur_tr = 170, blowdown = 26, cr = 12, rpm = 11000 } = port
  const { L_header = 266, L_diffuser = 150, L_belly = 200, L_baffle = 80, L_stinger = 200,
          D_belly = 100, D_stinger = 23, dPort = 40, alpha_diff = 7 } = exhaust

  const T_exhaust_C = 450 + (octane - 87) * 8
  const T_exhaust_K = T_exhaust_C + 273
  const SOS_exhaust = 345 * Math.sqrt(T_exhaust_K / 293)

  const v_port_ms = SOS_exhaust * 0.85

  const A_port  = Math.PI / 4 * Math.pow(dPort / 1000, 2)
  const rho     = 0.45
  const mass_flow = rho * A_port * v_port_ms

  const t_total = (L_header + L_diffuser + Math.max(L_belly, 0) + L_baffle + L_stinger) / 1000 / SOS_exhaust
  const RPM_optimal = t_total > 0 ? ((360 - dur_ex) / 360 * 60) / t_total : rpm

  const blowdown_f = blowdown >= 20 && blowdown <= 40 ? 1.0 : blowdown < 20 ? 0.7 : 0.85
  const transfer_f = dur_tr >= 120 && dur_tr <= 142 ? 1.0 : 0.85
  const cr_f       = cr >= 10 && cr <= 14 ? 1.0 : 0.9
  const scav_eff   = blowdown_f * transfer_f * cr_f * 100
  const fuel_loss  = 25 * (1 + (20 - Math.max(20, blowdown)) / 20)

  const A_belly   = Math.PI / 4 * Math.pow(D_belly   / 1000, 2)
  const A_stinger = Math.PI / 4 * Math.pow(D_stinger / 1000, 2)
  const M_header  = v_port_ms / SOS_exhaust
  const M_belly   = A_belly   > 0 ? (mass_flow / rho / A_belly)   / (345 * Math.sqrt(T_exhaust_K * 0.75 / 293)) : 0
  const M_stinger = A_stinger > 0 ? (mass_flow / rho / A_stinger) / (345 * Math.sqrt(T_exhaust_K * 0.60 / 293)) : 0

  const P_header  = 1.8
  const P_belly   = D_belly   > 0 ? P_header * Math.pow(dPort / D_belly, 2)   : 0
  const P_stinger = D_stinger > 0 ? P_belly  * Math.pow(D_belly / D_stinger, 2) * 0.6 : 0

  const eddy_risk   = alpha_diff > 8 ? 'TINGGI' : alpha_diff > 6 ? 'SEDANG' : 'RENDAH'
  const pulse_match = Math.abs(RPM_optimal - rpm) < 300 ? 'OPTIMAL'
    : Math.abs(RPM_optimal - rpm) < 800 ? 'MENDEKATI' : 'PERLU PENYESUAIAN'

  return {
    SOS_exhaust: Math.round(SOS_exhaust), T_exhaust_C: Math.round(T_exhaust_C),
    v_port_ms: Math.round(v_port_ms), mass_flow_gs: Math.round(mass_flow * 1000),
    t_total_ms: (t_total * 1000).toFixed(2), RPM_optimal: Math.round(RPM_optimal),
    scav_eff: Math.round(scav_eff), fuel_loss: Math.round(fuel_loss),
    M_header: M_header.toFixed(3), M_belly: M_belly.toFixed(3), M_stinger: M_stinger.toFixed(3),
    P_header: P_header.toFixed(2), P_belly: P_belly.toFixed(2), P_stinger: P_stinger.toFixed(2),
    eddy_risk, diffuser_ang: alpha_diff, pulse_match,
  }
}

// ─── recommendation tables ───────────────────────────────────────────────────
const ENGINE_PRESETS = {
  50:  { bore: 38, stroke: 44, rod: 85,  rpm: 9500,  octane: 88, label: '50cc — skuter/mini bike' },
  60:  { bore: 43, stroke: 41, rod: 88,  rpm: 10000, octane: 88, label: '60cc' },
  65:  { bore: 44, stroke: 43, rod: 90,  rpm: 10500, octane: 90, label: '65cc — motocross junior' },
  80:  { bore: 47, stroke: 46, rod: 95,  rpm: 11000, octane: 90, label: '80cc — motocross' },
  100: { bore: 50, stroke: 51, rod: 100, rpm: 10500, octane: 90, label: '100cc' },
  125: { bore: 54, stroke: 54, rod: 105, rpm: 11000, octane: 92, label: '125cc — paling umum' },
  150: { bore: 57, stroke: 58, rod: 110, rpm: 10500, octane: 92, label: '150cc' },
  175: { bore: 62, stroke: 58, rod: 115, rpm: 9500,  octane: 92, label: '175cc' },
  200: { bore: 65, stroke: 60, rod: 118, rpm: 9000,  octane: 92, label: '200cc' },
  250: { bore: 70, stroke: 65, rod: 124, rpm: 8500,  octane: 92, label: '250cc — motocross' },
  300: { bore: 76, stroke: 66, rod: 128, rpm: 8000,  octane: 92, label: '300cc' },
  350: { bore: 80, stroke: 70, rod: 135, rpm: 7500,  octane: 95, label: '350cc' },
  500: { bore: 89, stroke: 80, rod: 150, rpm: 7000,  octane: 95, label: '500cc' },
}
const E_FACTOR = {
  6500: 0.30, 7000: 0.32, 7500: 0.32, 8000: 0.33, 8500: 0.33, 9000: 0.34,
  9500: 0.34, 10000: 0.35, 10500: 0.35, 11000: 0.36, 11500: 0.36,
  12000: 0.37, 13000: 0.38, 14000: 0.39,
}
const ET_OFFSET_FACTOR = 0.08
const CR_TARGETS = { roadrace: 13.5, motocross: 12.5, enduro: 12.0, trail: 11.0 }
const PORT_DIAMETER = {
  50:  { min: 22, max: 26, typical: 24 },
  80:  { min: 30, max: 32, typical: 31 },
  100: { min: 34, max: 37, typical: 35 },
  125: { min: 37, max: 40, typical: 38 },
  175: { min: 42, max: 46, typical: 44 },
  250: { min: 44, max: 48, typical: 46 },
  500: { min: 45, max: 50, typical: 47 },
}

function getRecommendations(cc, engineType = 'roadrace') {
  const keys = Object.keys(ENGINE_PRESETS).map(Number).sort((a, b) => a - b)
  const nearest = keys.reduce((prev, curr) =>
    Math.abs(curr - cc) < Math.abs(prev - cc) ? curr : prev)
  const preset = ENGINE_PRESETS[nearest]
  const cr_target = CR_TARGETS[engineType] ?? 12.5
  const vd = Math.PI / 4 * preset.bore * preset.bore * preset.stroke / 1000
  const vc_recommended = vd / (cr_target - 1)
  const rpmKeys = Object.keys(E_FACTOR).map(Number).sort((a, b) => a - b)
  const nearestRpm = rpmKeys.reduce((prev, curr) =>
    Math.abs(curr - preset.rpm) < Math.abs(prev - preset.rpm) ? curr : prev)
  const E_recommended = preset.stroke * E_FACTOR[nearestRpm]
  const Et_recommended = E_recommended + preset.stroke * ET_OFFSET_FACTOR
  const portKeys = Object.keys(PORT_DIAMETER).map(Number).sort((a, b) => a - b)
  const nearestPort = portKeys.reduce((prev, curr) =>
    Math.abs(curr - cc) < Math.abs(prev - cc) ? curr : prev)
  const dport = PORT_DIAMETER[nearestPort].typical
  return {
    bore: preset.bore, stroke: preset.stroke, rod: preset.rod,
    rpm: preset.rpm, octane: preset.octane,
    E: parseFloat(E_recommended.toFixed(1)),
    Et: parseFloat(Et_recommended.toFixed(1)),
    C: 0, vc: parseFloat(vc_recommended.toFixed(1)),
    dport, label: preset.label, cr_target, nearestPreset: nearest,
  }
}

// ─── base UI components ──────────────────────────────────────────────────────
const S = {
  ok: '#15803d', warn: '#b45309', danger: '#b91c1c',
  accent: '#c75e1a',
}

function Badge({ text, type = 'ok' }) {
  const bg = { ok: '#dcfce7', warn: '#fef3c7', danger: '#fee2e2', info: '#dbeafe' }
  const color = type === 'info' ? '#1d4ed8' : S[type] ?? S.ok
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 8,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      background: bg[type] ?? bg.ok, color,
    }}>{text}</span>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 6, fontSize: 11 }}>{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, step = 1, min, max }) {
  return (
    <input
      type="number" value={value} step={step} min={min} max={max}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
        borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
        fontFamily: 'system-ui', outline: 'none',
      }}
    />
  )
}

function InputWithNotice({ value, onChange, step, min, max, warn, danger }) {
  const num = parseFloat(value) || 0
  const isDanger = danger != null && num >= danger
  const isWarn   = !isDanger && warn != null && num >= warn
  const borderColor = isDanger ? '#b91c1c' : isWarn ? '#b45309' : '#d1d5db'
  const notice = isDanger
    ? `⚠ Melebihi batas aman (max ${danger})`
    : isWarn
    ? `Mendekati batas maksimal (${warn})`
    : null
  return (
    <div>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '7px 10px', boxSizing: 'border-box',
          border: `1px solid ${borderColor}`,
          borderRadius: 8, fontSize: 14, fontFamily: 'system-ui', outline: 'none',
          background: isDanger ? '#fff1f1' : isWarn ? '#fffbeb' : '#fff',
          color: '#111',
        }}
      />
      {notice && (
        <div style={{ fontSize: 11, marginTop: 3, color: isDanger ? '#b91c1c' : '#b45309' }}>
          {notice}
        </div>
      )}
    </div>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
        borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
        fontFamily: 'system-ui', background: '#fff', outline: 'none',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Metric({ label, value, unit = '', status }) {
  const color = status ? S[status] : '#111827'
  return (
    <div style={{
      background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  )
}

function Card({ title, children, accent }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
      padding: '18px 20px', marginBottom: 16,
      borderLeft: accent ? `4px solid ${S.accent}` : undefined,
    }}>
      {title && <div style={{ fontSize: 13, fontWeight: 700, color: S.accent, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>{title}</div>}
      {children}
    </div>
  )
}

function Grid({ cols = 2, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
      {children}
    </div>
  )
}

function MetricGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      {children}
    </div>
  )
}

function CalcBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '11px 0', background: S.accent, color: '#fff',
      border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700,
      cursor: 'pointer', marginTop: 6, letterSpacing: 0.3,
    }}>Hitung</button>
  )
}

// ─── Slider helpers ──────────────────────────────────────────────────────────
function SliderRow({ label, color, hint, value, baseValue, min, max, onChange }) {
  const pct = baseValue > 0 ? ((value - baseValue) / baseValue) * 100 : 0
  const abs = Math.abs(pct)
  const status = abs < 10 ? 'ok' : abs < 25 ? 'warn' : 'danger'
  const sBg = status === 'ok' ? '#dcfce7' : status === 'warn' ? '#fef3c7' : '#fee2e2'
  const sFg = status === 'ok' ? '#15803d' : status === 'warn' ? '#b45309' : '#b91c1c'
  const sLabel = status === 'ok'
    ? 'Sesuai kalkulasi'
    : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%${status === 'danger' ? ' ⚠' : ''}`
  const markerPct = Math.max(0, Math.min(100, ((baseValue - min) / (max - min)) * 100))

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{hint}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: sBg, color: sFg, whiteSpace: 'nowrap' }}>
            {sLabel}
          </span>
          <input
            type="number" value={Math.round(value)}
            onChange={e => onChange(e.target.value)}
            style={{ width: 68, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, textAlign: 'right', fontFamily: 'system-ui' }}
          />
          <span style={{ fontSize: 11, color: '#9ca3af' }}>mm</span>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="range" min={min} max={max} step={1}
          value={Math.round(value)}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', accentColor: color, cursor: 'pointer', display: 'block' }}
        />
        <div style={{
          position: 'absolute', left: `${markerPct}%`, top: 0,
          width: 2, height: 20, background: '#94a3b8', borderRadius: 1,
          pointerEvents: 'none', transform: 'translateX(-50%)',
        }} />
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 2 }}>
        Kalkulasi awal: {Math.round(baseValue)} mm
      </div>
    </div>
  )
}

function RPMImpactDisplay({ dims, targetTotal, rpmNum }) {
  const currentTotal = Object.values(dims).reduce((a, b) => a + b, 0)
  if (Math.abs(currentTotal - targetTotal) < 5) return null
  const rpmShift = Math.round(rpmNum * (targetTotal / currentTotal) - rpmNum)
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0f9ff', borderRadius: 6, fontSize: 12, color: '#0369a1' }}>
      📊 Estimasi: power peak bergeser{' '}
      <strong>{rpmShift > 0 ? '+' : ''}{rpmShift} RPM</strong>
      {' '}({rpmShift > 0 ? 'naik — pipa lebih pendek' : 'turun — pipa lebih panjang'})
    </div>
  )
}

// ─── Modul 1: Exhaust Tab ────────────────────────────────────────────────────
function ExhaustTab({ masterParams, onDone }) {
  const [rpm, setRpm] = useState('11000')
  const [cc, setCc] = useState('125')
  const [exDur, setExDur] = useState('196')
  const [dPort, setDPort] = useState('40')
  const [type, setType] = useState('roadrace')
  const [diffStages, setDiffStages] = useState('1')
  const [sos, setSos] = useState('345')
  const [result, setResult] = useState(null)
  const [dims, setDims] = useState(null)
  const [isModified, setIsModified] = useState(false)
  const [syncOverride, setSyncOverride] = useState(false)
  const [prevMaster, setPrevMaster] = useState(masterParams)

  if (masterParams !== prevMaster) {
    setPrevMaster(masterParams)
    setSyncOverride(false)
  }

  const p = v => parseFloat(v) || 0

  const synced   = !!masterParams && !syncOverride
  const effRpm   = synced ? masterParams.rpm    : p(rpm)
  const effExDur = synced ? (masterParams.dur_ex ?? p(exDur)) : p(exDur)

  const calc = () => {
    const res = calcExhaustData({
      rpm: effRpm, cc: p(cc), exDur: effExDur, dPort: p(dPort),
      type, diffStages: parseInt(diffStages), sos: p(sos),
    })
    setResult({ ...res, dPort: p(dPort) })
    setDims({
      header: res.L_header,
      diffuser: res.L_diffuser,
      belly: Math.max(0, res.L_belly),
      baffle: res.L_baffle,
      stinger: res.L_stinger,
    })
    setIsModified(false)
    onDone?.()
  }

  const updateDimProportional = (changedKey, newValue) => {
    if (!dims || !result) return
    const newVal = Math.max(5, parseFloat(newValue) || 0)
    const keys = ['header', 'diffuser', 'belly', 'baffle', 'stinger']
    const otherKeys = keys.filter(k => k !== changedKey)
    const currentOtherTotal = otherKeys.reduce((a, k) => a + dims[k], 0)
    const targetOtherTotal = result.L_total - newVal
    if (targetOtherTotal < otherKeys.length * 5) return
    const scale = currentOtherTotal > 0 ? targetOtherTotal / currentOtherTotal : 1
    const newDims = { ...dims, [changedKey]: newVal }
    otherKeys.forEach(k => { newDims[k] = Math.max(5, dims[k] * scale) })
    const actualTotal = Object.values(newDims).reduce((a, b) => a + b, 0)
    newDims.belly = Math.max(5, newDims.belly + (result.L_total - actualTotal))
    setDims(newDims)
    setIsModified(true)
  }

  const resetToCalc = () => {
    if (!result) return
    setDims({
      header: result.L_header,
      diffuser: result.L_diffuser,
      belly: Math.max(0, result.L_belly),
      baffle: result.L_baffle,
      stinger: result.L_stinger,
    })
    setIsModified(false)
  }

  const segColors = ['#c75e1a', '#eab308', '#3b82f6', '#ef4444', '#6b7280']
  const segNames = ['Header', 'Diffuser', 'Belly', 'Baffle', 'Stinger']

  const sosHint = (() => {
    const t = 450 + ((masterParams?.octane ?? 92) - 87) * 8
    return `Estimasi SOS gas buang: ${Math.round(345 * Math.sqrt((t + 273) / 293))} m/s @ ${Math.round(t)}°C`
  })()

  return (
    <div>
      {synced && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>
              ✅ Parameter port tersinkron — klik Hitung untuk optimasi knalpot otomatis
            </span>
            <button onClick={() => setSyncOverride(true)} style={{
              fontSize: 11, padding: '3px 10px', border: '1px solid #86efac',
              borderRadius: 6, background: '#fff', color: '#15803d', cursor: 'pointer',
              fontFamily: 'system-ui', marginLeft: 8, flexShrink: 0,
            }}>🔓 Lepas sinkronisasi</button>
          </div>
        </div>
      )}
      <Card title="Parameter Input" accent>
        <Grid cols={2}>
          <Field label="RPM Target" hint="Puncak RPM yang ingin dicapai mesin">
            <div style={{ position: 'relative' }}>
              <input
                type="number" value={synced ? effRpm : rpm} disabled={synced}
                onChange={e => setRpm(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                  border: `1px solid ${synced ? '#86efac' : '#d1d5db'}`, borderRadius: 8,
                  fontSize: 14, fontFamily: 'system-ui', outline: 'none',
                  background: synced ? '#f0fdf4' : '#fff', color: '#111',
                  paddingRight: synced ? 110 : undefined,
                }}
              />
              {synced && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#15803d', pointerEvents: 'none' }}>🔗 Port & Stroke</span>}
            </div>
          </Field>
          <Field label="Displacement (cc)" hint="Volume silinder kerja mesin">
            <InputWithNotice value={cc} onChange={setCc} step={5} warn={450} danger={550} />
          </Field>
          <Field label="Exhaust Duration (°)" hint="Lama port buang terbuka dalam satu siklus">
            <div style={{ position: 'relative' }}>
              <input
                type="number" value={synced ? effExDur.toFixed(1) : exDur} disabled={synced}
                onChange={e => setExDur(e.target.value)} step={0.5}
                style={{
                  width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                  border: `1px solid ${synced ? '#86efac' : '#d1d5db'}`, borderRadius: 8,
                  fontSize: 14, fontFamily: 'system-ui', outline: 'none',
                  background: synced ? '#f0fdf4' : '#fff', color: '#111',
                  paddingRight: synced ? 110 : undefined,
                }}
              />
              {synced && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#15803d', pointerEvents: 'none' }}>🔗 Port & Stroke</span>}
            </div>
          </Field>
          <Field label="Diameter Port (mm)" hint="Diameter dalam lubang buang di silinder">
            <InputWithNotice value={dPort} onChange={setDPort} step={0.5} warn={55} danger={65} />
          </Field>
          <Field label="Tipe Mesin" hint="Karakter penggunaan mesin — menentukan sudut diffuser dan baffle">
            <Select value={type} onChange={setType} options={[
              { value: 'roadrace', label: 'Road Race' },
              { value: 'motocross', label: 'Motocross' },
              { value: 'enduro', label: 'Enduro' },
            ]} />
          </Field>
          <Field label="Tahap Diffuser" hint="Makin banyak tahap, power band makin lebar dan halus">
            <Select value={diffStages} onChange={setDiffStages} options={[
              { value: '1', label: '1 tahap' },
              { value: '2', label: '2 tahap' },
              { value: '3', label: '3 tahap' },
            ]} />
          </Field>
        </Grid>
        <Field label="Speed of Sound (m/s)" hint="Kecepatan rambat gelombang tekanan — naik seiring suhu gas, default 345 m/s @ 20°C">
          <InputWithNotice value={sos} onChange={setSos} step={1} warn={400} danger={450} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{sosHint}</div>
        </Field>
        <CalcBtn onClick={calc} />
      </Card>

      {result && (() => {
        const { L_total, L_header, L_diffuser, L_belly, L_baffle, L_stinger,
          D_belly, D_stinger, alpha_diff, alpha_baffle, diffAngles,
          bellyStatus, bellyMsg } = result

        const segs = dims
          ? [dims.header, dims.diffuser, Math.max(dims.belly, 0), dims.baffle, dims.stinger]
          : [L_header, L_diffuser, Math.max(L_belly, 0), L_baffle, L_stinger]
        const totalVis = segs.reduce((a, b) => a + b, 0)

        const isMobile = typeof window !== 'undefined' && window.innerWidth < 640

        return (
          <>
            {bellyMsg && (
              <div style={{
                background: bellyStatus === 'danger' ? '#fee2e2' : '#fef3c7',
                border: `1px solid ${bellyStatus === 'danger' ? '#fca5a5' : '#fcd34d'}`,
                borderRadius: 10, padding: '10px 14px', marginBottom: 12,
                color: S[bellyStatus], fontSize: 13, fontWeight: 600,
              }}>⚠ {bellyMsg}</div>
            )}

            {/* Baris 1: Dimensi Segmen — full width */}
            <Card title="Dimensi Segmen">
              <MetricGrid>
                <Metric label="Header" value={fmt(L_header)} unit="mm" />
                <Metric label="Diffuser" value={fmt(L_diffuser)} unit="mm" />
                <Metric label="Belly" value={fmt(L_belly)} unit="mm" status={bellyStatus !== 'ok' ? bellyStatus : undefined} />
                <Metric label="Baffle" value={fmt(L_baffle)} unit="mm" />
                <Metric label="Stinger" value={fmt(L_stinger)} unit="mm" />
                <Metric label="Total" value={fmt(L_total)} unit="mm" />
              </MetricGrid>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>Proporsi segmen</div>
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 22 }}>
                  {segs.map((seg, i) => (
                    <div key={i} title={`${segNames[i]}: ${fmt(seg)}mm`} style={{
                      flex: seg / totalVis, background: segColors[i],
                      minWidth: seg > 0 ? 2 : 0,
                    }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                  {segNames.map((n, i) => (
                    <span key={n} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: segColors[i], display: 'inline-block' }} />
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            </Card>

            {/* Gas Flow Analysis */}
            {(() => {
              const portForGf = masterParams
                ? { dur_ex: masterParams.dur_ex ?? effExDur, dur_tr: masterParams.dur_tr ?? effExDur - 26, blowdown: masterParams.blowdown ?? 26, cr: masterParams.cr ?? 12, rpm: masterParams.rpm ?? effRpm }
                : { dur_ex: effExDur, dur_tr: effExDur - 26, blowdown: 26, cr: 12, rpm: effRpm }
              const gf = calcGasFlow(portForGf, result, masterParams?.octane ?? 92)
              return (
                <Card title="Analisis Gas Flow & Aerodinamika">
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>Kondisi gas buang</div>
                  <MetricGrid>
                    <Metric label="Suhu gas buang" value={gf.T_exhaust_C} unit="°C" />
                    <Metric label="SOS gas panas" value={gf.SOS_exhaust} unit="m/s" />
                    <Metric label="Kecepatan di port" value={gf.v_port_ms} unit="m/s" />
                    <Metric label="Mass flow rate" value={gf.mass_flow_gs} unit="g/s" />
                  </MetricGrid>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, marginTop: 12 }}>Efisiensi sistem</div>
                  <MetricGrid>
                    <Metric label="Scavenging efficiency" value={gf.scav_eff} unit="%"
                      status={gf.scav_eff > 85 ? 'ok' : gf.scav_eff > 70 ? 'warn' : 'danger'} />
                    <Metric label="Estimasi fuel loss" value={gf.fuel_loss} unit="%"
                      status={gf.fuel_loss < 25 ? 'ok' : gf.fuel_loss < 35 ? 'warn' : 'danger'} />
                    <Metric label="RPM optimal pipa" value={gf.RPM_optimal} unit="RPM" />
                    <Metric label="Pulse match" value={gf.pulse_match}
                      status={gf.pulse_match === 'OPTIMAL' ? 'ok' : gf.pulse_match === 'MENDEKATI' ? 'warn' : 'danger'} />
                  </MetricGrid>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, marginTop: 12 }}>Mach number & tekanan per segmen</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f9fafb' }}>
                          {['Segmen', 'Mach (M)', 'Tekanan (bar)', 'Status'].map(h => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { name: 'Header',  M: gf.M_header,  P: gf.P_header,  col: '#c75e1a' },
                          { name: 'Belly',   M: gf.M_belly,   P: gf.P_belly,   col: '#15803d' },
                          { name: 'Stinger', M: gf.M_stinger, P: gf.P_stinger, col: '#6b7280' },
                        ].map(row => (
                          <tr key={row.name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: row.col, display: 'inline-block' }} />{row.name}
                              </span>
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>
                              {row.M}
                              {parseFloat(row.M) > 0.8 && <span style={{ color: '#b91c1c', marginLeft: 4 }}>⚠ near choked</span>}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{row.P}</td>
                            <td style={{ padding: '6px 10px' }}>
                              {parseFloat(row.M) > 0.8 ? <Badge text="Turbulensi tinggi" type="danger" />
                                : parseFloat(row.M) > 0.5 ? <Badge text="Aliran baik" type="warn" />
                                : <Badge text="Aliran laminar" type="ok" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#f9fafb', borderRadius: 8, fontSize: 12 }}>
                    <span style={{ color: '#6b7280' }}>Risiko turbulensi diffuser: </span>
                    <Badge
                      text={`${gf.eddy_risk} — sudut ${gf.diffuser_ang}°`}
                      type={gf.eddy_risk === 'RENDAH' ? 'ok' : gf.eddy_risk === 'SEDANG' ? 'warn' : 'danger'}
                    />
                    {gf.eddy_risk === 'TINGGI' && (
                      <div style={{ marginTop: 4, color: '#b91c1c', fontSize: 11 }}>
                        Sudut diffuser &gt;8° menyebabkan eddying — kurangi tahap atau gunakan 3-stage diffuser (ref: Graham Bell Fig. 3.14)
                      </div>
                    )}
                  </div>
                </Card>
              )
            })()}

            {/* Baris 2: Slider + 3D — side by side */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '40% 60%',
              gap: 12,
              marginBottom: 12,
              alignItems: 'start',
            }}>
              {/* Kolom kiri: Panel slider */}
              <div style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: '16px 18px',
                position: 'sticky',
                top: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Sesuaikan Dimensi
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isModified && (
                      <span style={{ fontSize: 10, color: '#b45309', background: '#fef3c7', padding: '2px 6px', borderRadius: 4 }}>
                        ✏️ Dimodifikasi
                      </span>
                    )}
                    <button onClick={resetToCalc} style={{
                      fontSize: 10, padding: '3px 8px', border: '1px solid #d1d5db',
                      borderRadius: 6, background: '#f9fafb', cursor: 'pointer',
                      color: '#374151', fontFamily: 'system-ui',
                    }}>↺ Reset</button>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
                  Geser slider — segmen lain menyesuaikan proporsional
                </div>
                {dims && [
                  { key: 'header',   label: 'Header',   color: segColors[0], hint: 'Pipa awal' },
                  { key: 'diffuser', label: 'Diffuser', color: segColors[1], hint: 'Kerucut melebar' },
                  { key: 'belly',    label: 'Belly',    color: segColors[2], hint: 'Silinder tengah' },
                  { key: 'baffle',   label: 'Baffle',   color: segColors[3], hint: 'Kerucut mengecil' },
                  { key: 'stinger',  label: 'Stinger',  color: segColors[4], hint: 'Pipa keluar' },
                ].map(({ key, label, color, hint }) => (
                  <SliderRow
                    key={key}
                    label={label}
                    color={color}
                    hint={hint}
                    value={dims[key]}
                    baseValue={result[`L_${key}`] ?? 0}
                    min={5}
                    max={Math.round(result.L_total * 0.7)}
                    onChange={v => updateDimProportional(key, v)}
                  />
                ))}
                {dims && <RPMImpactDisplay dims={dims} targetTotal={result.L_total} rpmNum={p(rpm)} />}
              </div>

              {/* Kolom kanan: Visualisasi 3D */}
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>Visualisasi 3D</span>
                  <span style={{ color: '#9ca3af' }}>— drag rotate, scroll zoom</span>
                </div>
                <ExhaustViewer data={result} dims={dims} onDimChange={updateDimProportional} />
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, textAlign: 'center' }}>
                  💡 Drag handle putih antar segmen untuk ubah dimensi
                </div>
              </div>
            </div>

            {/* Baris 3: Diameter & Sudut — full width */}
            <Card title="Diameter & Sudut">
              <MetricGrid>
                <Metric label="D Belly" value={fmt(D_belly)} unit="mm" />
                <Metric label="D Stinger ID" value={fmt(D_stinger)} unit="mm" />
                <Metric label="Sudut Diffuser" value={fmt(alpha_diff, 1)} unit="°" />
                <Metric label="Sudut Baffle" value={fmt(alpha_baffle, 2)} unit="°" />
              </MetricGrid>
              <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                Sudut diffuser per tahap: {diffAngles.map(a => a + '°').join(' → ')}
              </div>
            </Card>

            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
              Ref: Graham Bell Performance Tuning — Tabel 4.4, 4.5, 4.6
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ─── AutoRecommendPanel ──────────────────────────────────────────────────────
function AutoRecommendPanel({ rec, onApply }) {
  if (!rec) return null
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>🎯 Rekomendasi Otomatis</div>
          <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>{rec.label} — preset terdekat: {rec.nearestPreset}cc</div>
        </div>
        <button onClick={() => onApply(rec)} style={{
          padding: '6px 14px', background: '#15803d', color: '#fff', border: 'none',
          borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>Terapkan Semua</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>① Geometri Dasar</div>
          <div style={{ fontSize: 12, lineHeight: 1.9, color: '#374151' }}>
            <div>Bore: <strong>{rec.bore} mm</strong></div>
            <div>Stroke: <strong>{rec.stroke} mm</strong></div>
            <div>Con Rod: <strong>{rec.rod} mm</strong></div>
            <div>RPM Peak: <strong>{rec.rpm}</strong></div>
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>② Port Timing</div>
          <div style={{ fontSize: 12, lineHeight: 1.9, color: '#374151' }}>
            <div>E (exhaust): <strong>{rec.E} mm</strong></div>
            <div>Et (transfer): <strong>{rec.Et} mm</strong></div>
            <div>C (clearance): <strong>{rec.C} mm</strong></div>
            <div>Port ⌀: <strong>{rec.dport} mm</strong></div>
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>③ Ruang Bakar</div>
          <div style={{ fontSize: 12, lineHeight: 1.9, color: '#374151' }}>
            <div>CR target: <strong>{rec.cr_target}:1</strong></div>
            <div>Vc: <strong>{rec.vc} cc</strong></div>
            <div>Oktan: <strong>{rec.octane}</strong></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modul 2: Port & Stroke Tab ──────────────────────────────────────────────
function PortTab({ onMasterUpdate, onDone }) {
  const [form, setForm] = useState({
    bore: '54', stroke: '54', conrod: '105',
    E: '17.5', C: '0', Et: '25', Vc: '8.5',
    rpm: '11000', octane: '92', cc: '125', engineType: 'roadrace',
  })
  const [result, setResult] = useState(null)
  const [formSnap, setFormSnap] = useState(null)

  const p = v => parseFloat(v) || 0
  const set = key => val => setForm(f => ({ ...f, [key]: val }))

  const rodRatio = p(form.stroke) > 0 ? p(form.conrod) / p(form.stroke) : 0
  const rodWarn  = rodRatio > 0 && (rodRatio < 1.8 || rodRatio > 2.2)
  const etWarn   = p(form.Et) > 0 && p(form.E) > 0 && p(form.Et) <= p(form.E)

  const rec = p(form.cc) > 0 ? getRecommendations(p(form.cc), form.engineType) : null

  const applyRec = r => setForm(f => ({
    ...f,
    bore: String(r.bore), stroke: String(r.stroke), conrod: String(r.rod),
    rpm: String(r.rpm), octane: String(r.octane),
    E: String(r.E), Et: String(r.Et), Vc: String(r.vc),
  }))

  const calc = () => {
    const f = {
      bore: p(form.bore), stroke: p(form.stroke), conrod: p(form.conrod),
      E: p(form.E), C: p(form.C), Et: p(form.Et), Vc: p(form.Vc), rpm: p(form.rpm),
    }
    setFormSnap({ ...f, octane: p(form.octane) })
    const res = calcPortData(f)
    setResult(res)
    onMasterUpdate?.({
      bore: f.bore, stroke: f.stroke, rod: f.conrod, E: f.E, C: f.C, Et: f.Et, vc: f.Vc, rpm: f.rpm,
      octane: p(form.octane),
      dur_ex: res.exDur, dur_tr: res.trDur, blowdown: res.blowdown,
      cr: res.Cr, vd: res.Vd, piston_speed: res.Vp,
      epo: res.EPO, epc: res.EPC, tpo: res.TPO, tpc: res.TPC,
      calculatedAt: Date.now(),
    })
    onDone?.()
  }

  return (
    <div>
      {rec && <AutoRecommendPanel rec={rec} onApply={applyRec} />}
      <Card title="Parameter Input" accent>
        <Grid cols={2}>
          <Field label="Displacement (cc)" hint="Digunakan untuk rekomendasi otomatis">
            <NumInput value={form.cc} onChange={set('cc')} step={5} min={40} />
          </Field>
          <Field label="Tipe Mesin" hint="Karakteristik penggunaan mesin">
            <Select value={form.engineType} onChange={set('engineType')} options={[
              { value: 'roadrace', label: 'Road Race' },
              { value: 'motocross', label: 'Motocross' },
              { value: 'enduro', label: 'Enduro' },
              { value: 'trail', label: 'Trail' },
            ]} />
          </Field>
        </Grid>
        <Grid cols={3}>
          <Field label="Bore (mm)" hint="Diameter dalam silinder">
            <InputWithNotice value={form.bore} onChange={set('bore')} step={0.5} warn={90} danger={105} />
          </Field>
          <Field label="Stroke (mm)" hint="Jarak tempuh piston dari TMA ke TMB">
            <InputWithNotice value={form.stroke} onChange={set('stroke')} step={0.5} warn={90} danger={105} />
          </Field>
          <Field label="Con Rod (mm)" hint="Jarak center-to-center pena piston ke kruk as">
            <InputWithNotice value={form.conrod} onChange={set('conrod')} step={0.5} warn={220} danger={260} />
          </Field>
          <Field label="E — exhaust port (mm)" hint="Tinggi port buang dari bibir atas barrel">
            <InputWithNotice value={form.E} onChange={set('E')} step={0.5} warn={25} danger={35} />
          </Field>
          <Field label="C — deck clearance (mm)" hint="Jarak piston ke bibir atas barrel saat TMA">
            <NumInput value={form.C} onChange={set('C')} step={0.1} />
          </Field>
          <Field label="Et — transfer port (mm)" hint="Tinggi port transfer dari bibir atas barrel">
            <NumInput value={form.Et} onChange={set('Et')} step={0.5} />
          </Field>
          <Field label="Vc clearance volume (cc)" hint="Volume ruang bakar saat piston di TMA">
            <NumInput value={form.Vc} onChange={set('Vc')} step={0.1} />
          </Field>
          <Field label="Target RPM" hint="RPM acuan untuk analisis piston speed">
            <NumInput value={form.rpm} onChange={set('rpm')} step={100} />
          </Field>
          <Field label="Oktan Bahan Bakar" hint="Ketahanan bahan bakar terhadap detonasi">
            <InputWithNotice value={form.octane} onChange={set('octane')} step={1} min={80} max={102} warn={98} danger={102} />
          </Field>
        </Grid>
        {rodWarn && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: '#fef3c7', borderRadius: 6, fontSize: 12, color: '#b45309' }}>
            ⚠ Rasio rod/stroke {fmt(rodRatio, 2)} di luar rentang ideal 1.8–2.2 — pertimbangkan ubah panjang con rod
          </div>
        )}
        {etWarn && (
          <div style={{ marginTop: 4, padding: '6px 10px', background: '#fee2e2', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
            ⚠ Et harus lebih besar dari E agar transfer port terbuka setelah exhaust port
          </div>
        )}
        <CalcBtn onClick={calc} />
      </Card>

      {result && (() => {
        const { exDur, exDurValid, trDur, trDurValid, blowdown, blowdownStatus,
          Vd, Cr, crStatus, Vp, vpStatus, EPO, EPC, TPO, TPC } = result

        const blowLabel = blowdownStatus === 'ok' ? 'OK' : blowdownStatus === 'warn' ? 'WARN' : 'DANGER'
        const crLabel = crStatus === 'ok' ? 'OK' : crStatus === 'warn' ? 'WARN — stress tinggi' : 'DANGER — detonasi'
        const vpLabel = vpStatus === 'ok' ? 'OK' : vpStatus === 'warn' ? 'WARN' : 'DANGER — stress kritis'

        // bar chart 360° cycle
        const exAngle = exDur ?? 0
        const trAngle = trDur ?? 0
        const compAngle = 360 - exAngle
        const barSegs = [
          { label: 'Kompresi', angle: compAngle, color: '#3b82f6' },
          { label: 'Exhaust', angle: exAngle, color: '#ef4444' },
          { label: 'Transfer', angle: trAngle, color: '#22c55e' },
        ]

        return (
          <>
            {(!exDurValid || !trDurValid) && (
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 12, color: S.danger, fontSize: 13, fontWeight: 600 }}>
                ⚠ Nilai tidak valid — cek input dimensi (T/R di luar range ±1)
              </div>
            )}

            <Card title="Timing Port">
              <MetricGrid>
                <Metric label="Exhaust Duration" value={exDurValid ? fmt(exDur) : '—'} unit="°" />
                <Metric label="Transfer Duration" value={trDurValid ? fmt(trDur) : '—'} unit="°" />
                <Metric label="Blowdown" value={blowdown !== null ? fmt(blowdown) : '—'} unit="°" status={blowdownStatus} />
              </MetricGrid>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>Blowdown:</span>
                <Badge text={blowLabel} type={blowdownStatus} />
                {blowdownStatus === 'danger' && <span style={{ fontSize: 12, color: S.danger }}>Transfer buka sebelum gas buang tuntas</span>}
                {blowdownStatus === 'warn' && <span style={{ fontSize: 12, color: S.warn }}>Efisiensi scavenging menurun</span>}
              </div>
            </Card>

            <Card title="Port Timing (° dari TMA)">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      {['Event', 'Derajat'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['EPO — Exhaust Port Open', EPO],
                      ['EPC — Exhaust Port Close', EPC],
                      ['TPO — Transfer Port Open', TPO],
                      ['TPC — Transfer Port Close', TPC],
                    ].map(([label, val]) => (
                      <tr key={label} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 500 }}>{label}</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{val !== null ? fmt(val) + '°' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>Distribusi siklus 360°</div>
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 22 }}>
                  {barSegs.map(s => (
                    <div key={s.label} title={`${s.label}: ${fmt(s.angle)}°`} style={{
                      flex: s.angle / 360, background: s.color, minWidth: s.angle > 0 ? 2 : 0,
                    }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                  {barSegs.map(s => (
                    <span key={s.label} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                      {s.label} ({fmt(s.angle)}°)
                    </span>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Mekanis Mesin">
              <MetricGrid>
                <Metric label="Displacement" value={fmt(Vd, 2)} unit="cc" />
                <Metric label="Compression Ratio" value={Cr !== null ? fmt(Cr, 2) : '—'} unit=":1" status={crStatus} />
                <Metric label="Mean Piston Speed" value={fmt(Vp, 2)} unit="m/s" status={vpStatus} />
              </MetricGrid>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge text={crLabel} type={crStatus} />
                <Badge text={vpLabel} type={vpStatus} />
              </div>
              {Cr !== null && Cr > 13 && (
                <div style={{ marginTop: 8, fontSize: 12, color: S.warn }}>
                  ⚠ Perhatikan TMA/TMB stress pada Cr &gt; 13:1
                </div>
              )}
            </Card>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                Visualisasi 3D Interaktif
                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>— drag untuk rotate, scroll untuk zoom</span>
              </div>
              <PortViewer data={result} form={formSnap} />
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ─── Modul 3: ECU Tab ────────────────────────────────────────────────────────
function ECUTab({ masterParams, onDone }) {
  const [rpmCurrent, setRpmCurrent] = useState('9500')
  const [tps, setTps] = useState('85')
  const [map, setMap] = useState('90')
  const [temp, setTemp] = useState('75')
  const [lambda, setLambda] = useState('0.95')
  const [oktan, setOktan] = useState('92')
  const [rpmPeak, setRpmPeak] = useState('11000')
  const [exDur, setExDur] = useState('196')
  const [cr, setCr] = useState('12.5')
  const [result, setResult] = useState(null)
  const [prevMasterEcu, setPrevMasterEcu] = useState(masterParams)

  if (masterParams !== prevMasterEcu) {
    setPrevMasterEcu(masterParams)
    if (masterParams) {
      if (masterParams.rpm)    setRpmPeak(String(masterParams.rpm))
      if (masterParams.dur_ex) setExDur(masterParams.dur_ex.toFixed(1))
      if (masterParams.cr)     setCr(masterParams.cr.toFixed(1))
      if (masterParams.octane) setOktan(String(masterParams.octane))
    }
  }

  const p = v => parseFloat(v) || 0

  const calc = () => {
    setResult(calcECUData({
      rpmCurrent: p(rpmCurrent), tps: p(tps), map: p(map),
      temp: p(temp), lambda: p(lambda), oktan: p(oktan),
      rpmPeak: p(rpmPeak), exDur: p(exDur), cr: p(cr),
    }))
    onDone?.()
  }

  const zoneColor = z => {
    if (z === 'Low RPM') return '#6b7280'
    if (z === 'Mid RPM') return '#3b82f6'
    if (z === 'Power band') return '#22c55e'
    if (z === 'Peak power') return S.accent
    return S.danger
  }

  return (
    <div>
      <Card title="Sensor Real-Time" accent>
        <Grid cols={2}>
          <Field label="RPM Saat Ini" hint="Putaran mesin aktual yang sedang dioperasikan">
            <NumInput value={rpmCurrent} onChange={setRpmCurrent} step={100} />
          </Field>
          <Field label="TPS (%)" hint="Posisi bukaan gas — 0 tutup penuh, 100 buka penuh">
            <NumInput value={tps} onChange={setTps} step={1} min={0} max={100} />
          </Field>
          <Field label="MAP (kPa)" hint="Tekanan udara di intake manifold — indikator beban mesin">
            <NumInput value={map} onChange={setMap} step={1} />
          </Field>
          <Field label="Suhu Mesin (°C)" hint="Suhu operasi — mempengaruhi timing dan risiko detonasi">
            <InputWithNotice value={temp} onChange={setTemp} step={1} warn={90} danger={105} />
          </Field>
          <Field label="Lambda λ" hint="Rasio campuran udara-bahan bakar — 1.0 = stoikiometri ideal">
            <InputWithNotice value={lambda} onChange={setLambda} step={0.01} warn={1.10} danger={1.20} />
          </Field>
          <Field label="Oktan Bahan Bakar" hint="Ketahanan bahan bakar terhadap detonasi — makin tinggi makin tahan">
            <NumInput value={oktan} onChange={setOktan} step={1} />
          </Field>
        </Grid>
      </Card>

      <Card title="Parameter Mesin">
        <Grid cols={3}>
          <Field label="RPM Power Peak" hint="Sesuaikan dengan hasil kalkulasi modul Knalpot">
            <NumInput value={rpmPeak} onChange={setRpmPeak} step={100} />
          </Field>
          <Field label="Exhaust Duration (°)" hint="Sesuaikan dengan hasil kalkulasi modul Port &amp; Stroke">
            <NumInput value={exDur} onChange={setExDur} step={0.5} />
          </Field>
          <Field label="Compression Ratio" hint="Sesuaikan dengan hasil kalkulasi modul Port &amp; Stroke">
            <NumInput value={cr} onChange={setCr} step={0.1} />
          </Field>
        </Grid>
        <CalcBtn onClick={calc} />
      </Card>

      {result && (() => {
        const { ign_final, fuel_final, rpmZone, lambdaStatus, rpm_ratio, failsafe, recs } = result

        return (
          <>
            {failsafe && (
              <div style={{
                background: '#fee2e2', border: '1px solid #f87171', borderRadius: 10,
                padding: '12px 16px', marginBottom: 12, color: S.danger, fontWeight: 700, fontSize: 13,
              }}>
                FAIL-SAFE AKTIF — ECU mundur ke mapping konservatif
              </div>
            )}

            <Card title="Output ECU">
              <MetricGrid>
                <Metric label="Ignition Timing" value={fmt(ign_final, 2)} unit="mm BTDC" status={failsafe ? 'danger' : undefined} />
                <Metric label="Fuel Pulse Width" value={fmt(fuel_final, 2)} unit="ms" />
                <Metric label="RPM vs Peak" value={fmt(rpm_ratio * 100, 1)} unit="%" />
              </MetricGrid>
            </Card>

            <Card title="Status">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#6b7280', minWidth: 100 }}>Zona RPM</span>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: 8,
                    background: zoneColor(rpmZone) + '22', color: zoneColor(rpmZone),
                    fontWeight: 700, fontSize: 13,
                  }}>{rpmZone}</span>
                  {rpmZone === 'Over-rev' && <Badge text="WARN" type="warn" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#6b7280', minWidth: 100 }}>Lambda λ</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{lambdaStatus}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#6b7280', minWidth: 100 }}>Fail-safe</span>
                  <Badge text={failsafe ? 'AKTIF' : 'Normal'} type={failsafe ? 'danger' : 'ok'} />
                </div>
              </div>
            </Card>

            {recs.length > 0 && (
              <Card title="Rekomendasi Adaptive">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {recs.map((r, i) => (
                    <li key={i} style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>{r}</li>
                  ))}
                </ul>
              </Card>
            )}

            {masterParams && (() => {
              const bd = masterParams.blowdown ?? 26
              const tr = masterParams.dur_tr    ?? 130
              const crv = masterParams.cr       ?? 12
              const bf = bd >= 20 && bd <= 40 ? 1.0 : bd < 20 ? 0.7 : 0.85
              const tf = tr >= 120 && tr <= 142 ? 1.0 : 0.85
              const cf = crv >= 10 && crv <= 14 ? 1.0 : 0.9
              const se = Math.round(bf * tf * cf * 100)
              const fl = Math.round(25 * (1 + (20 - Math.max(20, bd)) / 20))
              const fl_tc = -(fl - 25) * 0.02
              const se_fc = (85 - se) * 0.05
              const oct_tc = (parseFloat(oktan) - 87) * 0.08
              return (
                <Card title="Koreksi berbasis gas flow">
                  <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.9 }}>
                    <div>Scavenging efficiency: <strong style={{ color: se > 85 ? S.ok : se > 70 ? S.warn : S.danger }}>{se}%</strong></div>
                    <div>Estimasi fuel loss: <strong>{fl}%</strong></div>
                    <div>Koreksi timing dari fuel loss:
                      <strong> {fl_tc > 0 ? '+' : ''}{fl_tc.toFixed(2)} mm BTDC</strong>
                    </div>
                    <div>Koreksi fuel dari scavenging:
                      <strong> {se_fc > 0 ? '+' : ''}{se_fc.toFixed(2)} ms</strong>
                    </div>
                    <div>Koreksi timing dari oktan {oktan}:
                      <strong> {oct_tc > 0 ? '+' : ''}{oct_tc.toFixed(2)} mm BTDC</strong>
                    </div>
                  </div>
                </Card>
              )
            })()}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                Visualisasi 3D Interaktif
                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>— drag untuk rotate, scroll untuk zoom</span>
              </div>
              <ECUViewer data={result} />
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ─── App shell ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'port',    label: 'Port & Stroke',  icon: '⚙️',  step: 1 },
  { id: 'exhaust', label: 'Knalpot',         icon: '🔥',  step: 2 },
  { id: 'ecu',     label: 'ECU Optimizer',   icon: '💡',  step: 3 },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('port')
  const [masterParams, setMasterParams] = useState(null)
  const [hasResult, setHasResult] = useState({ port: false, exhaust: false, ecu: false })

  const markDone = id => setHasResult(prev => ({ ...prev, [id]: true }))

  return (
    <div style={{
      maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1rem',
      fontFamily: 'system-ui, sans-serif', color: '#111827',
    }}>
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: S.accent, letterSpacing: -0.5 }}>
          2-Stroke Calc
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
          Expansion Chamber · Port Timing · ECU Mapping
        </div>
      </div>

      {/* Workflow banner */}
      <div style={{
        background: '#fdf0e8', border: '1px solid #e8a070', borderRadius: 8,
        padding: '8px 14px', marginBottom: 8, fontSize: 12, color: '#92400e',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600 }}>Alur input data:</span>
        <span>① Isi Port &amp; Stroke terlebih dahulu</span>
        <span style={{ color: S.accent }}>→</span>
        <span>② Hitung Knalpot optimal</span>
        <span style={{ color: S.accent }}>→</span>
        <span>③ Evaluasi dengan ECU Optimizer</span>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 20, gap: 4,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '9px 16px', border: 'none', background: 'none',
            cursor: 'pointer', fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
            color: activeTab === t.id ? S.accent : '#6b7280',
            borderBottom: activeTab === t.id ? `2px solid ${S.accent}` : '2px solid transparent',
            marginBottom: -2, borderRadius: '4px 4px 0 0', transition: 'color 0.15s',
            display: 'inline-flex', alignItems: 'center',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: '50%',
              background: activeTab === t.id ? S.accent : '#e5e7eb',
              color: activeTab === t.id ? '#fff' : '#6b7280',
              fontSize: 10, fontWeight: 700, marginRight: 6, flexShrink: 0,
            }}>{t.step}</span>
            {t.icon} {t.label}
            {hasResult[t.id] && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#15803d', marginLeft: 6, display: 'inline-block', flexShrink: 0,
              }} />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'exhaust' && <ExhaustTab masterParams={masterParams} onDone={() => markDone('exhaust')} />}
      {activeTab === 'port' && <PortTab onMasterUpdate={setMasterParams} onDone={() => markDone('port')} />}
      {activeTab === 'ecu' && <ECUTab masterParams={masterParams} onDone={() => markDone('ecu')} />}

      <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 16 }}>
        Ref: Graham Bell 'Performance Tuning in a Weekend' · 2s-tools.abdurrahman.sbs
      </div>
    </div>
  )
}
