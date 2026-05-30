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
function ExhaustTab() {
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

  const p = v => parseFloat(v) || 0

  const calc = () => {
    const res = calcExhaustData({
      rpm: p(rpm), cc: p(cc), exDur: p(exDur), dPort: p(dPort),
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

  return (
    <div>
      <Card title="Parameter Input" accent>
        <Grid cols={2}>
          <Field label="RPM Target" hint="Puncak RPM yang ingin dicapai mesin">
            <InputWithNotice value={rpm} onChange={setRpm} step={100} warn={14000} danger={16000} />
          </Field>
          <Field label="Displacement (cc)" hint="Volume silinder kerja mesin">
            <InputWithNotice value={cc} onChange={setCc} step={5} warn={450} danger={550} />
          </Field>
          <Field label="Exhaust Duration (°)" hint="Lama port buang terbuka dalam satu siklus">
            <InputWithNotice value={exDur} onChange={setExDur} step={0.5} warn={210} danger={220} />
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

            {dims && (
              <Card title="Sesuaikan Dimensi">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    Geser slider — segmen lain menyesuaikan proporsional
                  </div>
                  {isModified && (
                    <button onClick={resetToCalc} style={{
                      padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db',
                      borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'system-ui',
                      color: '#374151', flexShrink: 0, marginLeft: 8,
                    }}>↺ Reset</button>
                  )}
                </div>
                {[
                  { key: 'header',   label: 'Header',   color: segColors[0], hint: 'Pipa sebelum diffuser' },
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
                <RPMImpactDisplay dims={dims} targetTotal={result.L_total} rpmNum={p(rpm)} />
              </Card>
            )}

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

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                Visualisasi 3D Interaktif
                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>— drag untuk rotate, scroll untuk zoom</span>
              </div>
              <ExhaustViewer data={result} dims={dims} onDimChange={updateDimProportional} />
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ─── Modul 2: Port & Stroke Tab ──────────────────────────────────────────────
function PortTab() {
  const [bore, setBore] = useState('54')
  const [stroke, setStroke] = useState('54')
  const [conrod, setConrod] = useState('105')
  const [E, setE] = useState('17.5')
  const [C, setC] = useState('0')
  const [Et, setEt] = useState('25')
  const [Vc, setVc] = useState('8.5')
  const [rpm, setRpm] = useState('11000')
  const [result, setResult] = useState(null)
  const [formSnap, setFormSnap] = useState(null)

  const p = v => parseFloat(v) || 0

  const calc = () => {
    const f = { bore: p(bore), stroke: p(stroke), conrod: p(conrod), E: p(E), C: p(C), Et: p(Et), Vc: p(Vc), rpm: p(rpm) }
    setFormSnap(f)
    setResult(calcPortData(f))
  }

  return (
    <div>
      <Card title="Parameter Input" accent>
        <Grid cols={2}>
          <Field label="Bore (mm)" hint="Diameter dalam silinder">
            <InputWithNotice value={bore} onChange={setBore} step={0.5} warn={90} danger={105} />
          </Field>
          <Field label="Stroke (mm)" hint="Jarak tempuh piston dari TMA ke TMB">
            <InputWithNotice value={stroke} onChange={setStroke} step={0.5} warn={90} danger={105} />
          </Field>
          <Field label="Panjang Con Rod (mm)" hint="Jarak center-to-center pena piston ke pena kruk as — biasanya 1.8–2× stroke">
            <InputWithNotice value={conrod} onChange={setConrod} step={0.5} warn={220} danger={260} />
          </Field>
          <Field label="E — exhaust port ke atas barrel (mm)" hint="Menentukan kapan port buang mulai terbuka">
            <InputWithNotice value={E} onChange={setE} step={0.5} warn={25} danger={35} />
          </Field>
          <Field label="C — deck clearance TDC (mm)" hint="Jarak piston ke bibir atas barrel saat di TMA — 0 jika flush">
            <NumInput value={C} onChange={setC} step={0.1} />
          </Field>
          <Field label="Et — transfer port ke atas barrel (mm)" hint="Menentukan kapan port transfer mulai terbuka">
            <NumInput value={Et} onChange={setEt} step={0.5} />
          </Field>
          <Field label="Volume Clearance Vc (cc)" hint="Volume ruang bakar saat piston di TMA">
            <NumInput value={Vc} onChange={setVc} step={0.1} />
          </Field>
          <Field label="Target RPM" hint="RPM acuan untuk analisis piston speed">
            <NumInput value={rpm} onChange={setRpm} step={100} />
          </Field>
        </Grid>
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
function ECUTab() {
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

  const p = v => parseFloat(v) || 0

  const calc = () => {
    setResult(calcECUData({
      rpmCurrent: p(rpmCurrent), tps: p(tps), map: p(map),
      temp: p(temp), lambda: p(lambda), oktan: p(oktan),
      rpmPeak: p(rpmPeak), exDur: p(exDur), cr: p(cr),
    }))
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
  { id: 'exhaust', label: '🔩 Knalpot' },
  { id: 'port', label: '⚙ Port & Stroke' },
  { id: 'ecu', label: '💡 ECU Optimizer' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('exhaust')

  return (
    <div style={{
      maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem',
      fontFamily: 'system-ui, sans-serif', color: '#111827',
    }}>
      <div style={{ marginBottom: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: S.accent, letterSpacing: -0.5 }}>
          2-Stroke Calc
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
          Expansion Chamber · Port Timing · ECU Mapping
        </div>
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
          }}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'exhaust' && <ExhaustTab />}
      {activeTab === 'port' && <PortTab />}
      {activeTab === 'ecu' && <ECUTab />}

      <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 16 }}>
        Ref: Graham Bell 'Performance Tuning in a Weekend' · 2s-tools.abdurrahman.sbs
      </div>
    </div>
  )
}
