import { useRef, useState, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'

// ─── shared UI ───────────────────────────────────────────────────────────────
function ControlBar({ children }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Btn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 12px', fontSize: 12, fontWeight: 600,
      border: `1px solid ${active ? '#c75e1a' : '#d1d5db'}`,
      borderRadius: 6,
      background: active ? '#c75e1a' : '#f3f4f6',
      color: active ? '#fff' : '#374151',
      cursor: 'pointer', lineHeight: 1.4,
    }}>{children}</button>
  )
}

function SliderCtrl({ label, value, min, max, step = 0.01, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280' }}>
      {label}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: 90 }} />
    </label>
  )
}

function CanvasWrap({ children }) {
  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 380, width: '100%', background: '#e8e8f0' }}>
      <Canvas
        shadows
        camera={{ fov: 50, position: [0, 0, 8] }}
        gl={{ localClippingEnabled: true }}
      >
        {children}
      </Canvas>
    </div>
  )
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-5, 3, -5]} intensity={0.6} />
      <pointLight position={[0, 5, 0]} intensity={0.5} color="#fff5e0" />
    </>
  )
}

// Camera reset must live inside Canvas
function CameraResetter({ trigger }) {
  const { camera, controls } = useThree()
  const prev = useRef(null)
  useFrame(() => {
    if (trigger !== prev.current) {
      prev.current = trigger
      camera.position.set(0, 0, 8)
      camera.lookAt(0, 0, 0)
      if (controls) controls.target.set(0, 0, 0)
    }
  })
  return null
}

// ══════════════════════════════════════════════════════════════════════════════
// MODUL 1 — EXHAUST VIEWER
// ══════════════════════════════════════════════════════════════════════════════

const SEG_COLORS = ['#c75e1a', '#1d4ed8', '#15803d', '#d97706', '#6b7280']
const SEG_NAMES  = ['Header', 'Diffuser', 'Belly', 'Baffle', 'Stinger']

function BadgeStatus({ value, base }) {
  if (!base || base === 0) return null
  const pct = Math.abs((parseFloat(value) - base) / base) * 100
  const { bg, fg, text } =
    pct <= 10 ? { bg: '#dcfce7', fg: '#15803d', text: 'OK' } :
    pct <= 25 ? { bg: '#fef3c7', fg: '#b45309', text: 'MODIFIKASI' } :
               { bg: '#fee2e2', fg: '#b91c1c', text: 'PERHATIKAN' }
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 6,
      fontSize: 10, fontWeight: 700, background: bg, color: fg,
    }}>{text}</span>
  )
}

function initDims(data) {
  return {
    header:   { length: +data.L_header.toFixed(1) },
    diffuser: { length: +data.L_diffuser.toFixed(1) },
    belly:    { length: +Math.max(data.L_belly, 0).toFixed(1) },
    baffle:   { length: +data.L_baffle.toFixed(1) },
    stinger:  { length: +data.L_stinger.toFixed(1), id: +data.D_stinger.toFixed(1) },
  }
}

function ExhaustSegment({ r1, r2, length, color, posX, infoLabel, clip, selected, onClick }) {
  const [hovered, setHovered] = useState(false)
  const labelY = Math.max(r1, r2) + 0.25

  return (
    <group position={[posX, 0, 0]}>
      {/* outer shell */}
      <mesh
        rotation={[0, 0, Math.PI / 2]}
        scale={selected ? [1, 1.08, 1.08] : [1, 1, 1]}
        onClick={e => { e.stopPropagation(); onClick() }}
        onPointerEnter={e => { e.stopPropagation(); setHovered(true) }}
        onPointerLeave={() => setHovered(false)}
        castShadow
      >
        <cylinderGeometry args={[r2, r1, length, 32, 1, false]} />
        <meshStandardMaterial
          color={selected ? '#f0f0f0' : color}
          emissive={hovered && !selected ? color : '#000000'}
          emissiveIntensity={hovered && !selected ? 0.35 : 0}
          metalness={0.75}
          roughness={0.2}
          clippingPlanes={clip ? [clip] : []}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* interior bronze — only when clip active */}
      {clip && (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[r2 * 0.86, r1 * 0.86, length, 32, 1, false]} />
          <meshStandardMaterial
            color="#8B4513"
            metalness={0.3}
            roughness={0.65}
            clippingPlanes={[clip]}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {/* cap discs — RIGHT end uses r1, LEFT end uses r2 */}
      {clip && (
        <>
          <mesh position={[length / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <ringGeometry args={[r1 * 0.86, r1, 32]} />
            <meshStandardMaterial color="#8B4513" side={THREE.DoubleSide} clippingPlanes={[clip]} />
          </mesh>
          <mesh position={[-length / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <ringGeometry args={[r2 * 0.86, r2, 32]} />
            <meshStandardMaterial color="#8B4513" side={THREE.DoubleSide} clippingPlanes={[clip]} />
          </mesh>
        </>
      )}

      {(hovered || selected) && (
        <Html center position={[0, labelY, 0]}>
          <div style={{
            background: 'rgba(0,0,0,0.82)', color: '#fff',
            fontSize: 11, padding: '3px 8px', borderRadius: 4,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            {infoLabel}
          </div>
        </Html>
      )}
    </group>
  )
}

const GAS_COLORS = ['#ff4400', '#ff8800', '#ffaa00', '#ffcc44', '#88ccff']
const GAS_SIZES  = [0.04, 0.06, 0.10, 0.07, 0.03]
const GAS_SPEEDS = [0.025, 0.018, 0.010, 0.018, 0.030]
const PARTICLE_COUNT = 10

function GasParticles({ active, lens }) {
  const groupRef = useRef()
  const pts = useRef(
    Array.from({ length: PARTICLE_COUNT }, (_, i) => ({ x: -3 + (i / PARTICLE_COUNT) * 6 }))
  )

  const getSegFor = (x, bounds) => {
    for (let i = 0; i < 4; i++) { if (x < bounds[i + 1]) return i }
    return 4
  }

  useFrame(() => {
    if (!active || !groupRef.current) return
    const bounds = [-3]
    let cur = -3
    const src = lens ?? [1.2, 1.2, 1.2, 1.2, 1.2]
    src.forEach(l => { cur += l; bounds.push(cur) })

    groupRef.current.children.forEach((mesh, i) => {
      const seg = getSegFor(pts.current[i].x, bounds)
      pts.current[i].x += GAS_SPEEDS[seg]
      if (pts.current[i].x > 3) pts.current[i].x = -3
      mesh.position.x = pts.current[i].x
      mesh.position.y = Math.sin(pts.current[i].x * 3.5) * 0.06
      mesh.scale.setScalar(GAS_SIZES[seg] / 0.05)
      if (mesh.material) {
        mesh.material.color.set(GAS_COLORS[seg])
        mesh.material.emissive.set(GAS_COLORS[seg])
      }
    })
  })

  if (!active) return null
  return (
    <group ref={groupRef}>
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color={GAS_COLORS[i % 5]} emissive={GAS_COLORS[i % 5]} emissiveIntensity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function PulseWave({ active }) {
  const ringRef = useRef()
  const progress = useRef(0.5)

  useFrame(() => {
    if (!active || !ringRef.current) return
    progress.current -= 0.012
    if (progress.current < 0) progress.current = 1.0
    ringRef.current.position.x = (progress.current - 0.5) * 6
    const t = progress.current
    const opacity = t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1
    if (ringRef.current.material) ringRef.current.material.opacity = opacity * 0.6
  })

  if (!active) return null
  return (
    <mesh ref={ringRef} rotation={[0, Math.PI / 2, 0]}>
      <torusGeometry args={[0.12, 0.015, 8, 32]} />
      <meshStandardMaterial color="#88ccff" emissive="#4499ff" emissiveIntensity={0.8} transparent opacity={0.6} />
    </mesh>
  )
}

function DragHandle({ posX, segKey, dimValue, onDimChange, mmPerUnit, handleY, controlsRef }) {
  const { camera, size } = useThree()
  const dragging = useRef(false)
  const startX = useRef(0)
  const startVal = useRef(0)
  const [hovered, setHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [tooltip, setTooltip] = useState(null)

  const getPxPerUnit = () => {
    const a = new THREE.Vector3(-3, 0, 0).project(camera)
    const b = new THREE.Vector3(3, 0, 0).project(camera)
    return Math.max(1, Math.abs((b.x - a.x) * size.width / 2)) / 6
  }

  const active = hovered || isDragging

  return (
    <group position={[posX, 0, 0]}>
      <mesh
        position={[0, handleY, 0]}
        onPointerDown={e => {
          e.stopPropagation()
          e.target.setPointerCapture(e.pointerId)
          dragging.current = true
          setIsDragging(true)
          startX.current = e.clientX
          startVal.current = dimValue
          if (controlsRef.current) controlsRef.current.enabled = false
          setTooltip(`${Math.round(dimValue)} mm`)
        }}
        onPointerMove={e => {
          if (!dragging.current) return
          const dx = e.clientX - startX.current
          const newVal = Math.max(5, startVal.current + dx * (mmPerUnit / getPxPerUnit()))
          onDimChange(segKey, newVal)
          setTooltip(`${Math.round(newVal)} mm`)
        }}
        onPointerUp={e => {
          e.target.releasePointerCapture(e.pointerId)
          dragging.current = false
          setIsDragging(false)
          setTooltip(null)
          setHovered(false)
          if (controlsRef.current) controlsRef.current.enabled = true
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => { if (!dragging.current) setHovered(false) }}
      >
        <sphereGeometry args={[0.1, 12, 8]} />
        <meshStandardMaterial
          color={active ? '#c75e1a' : '#f0f0f0'}
          emissive={active ? '#c75e1a' : '#000000'}
          emissiveIntensity={active ? 0.6 : 0}
          metalness={0.8}
          roughness={0.15}
        />
      </mesh>
      {(active || tooltip) && (
        <Html center position={[0, handleY + 0.35, 0]}>
          <div style={{
            background: 'rgba(0,0,0,0.8)', color: '#fff',
            fontSize: 11, padding: '3px 8px', borderRadius: 4,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            {tooltip ?? '↔ Drag'}
          </div>
        </Html>
      )}
    </group>
  )
}

// All hooks before any conditional logic
function ExhaustScene({ data, showLabels, showFlow, crossSection, crossValue, selected, onSelect, onDimChange }) {
  const { L_header, L_diffuser, L_belly, L_baffle, L_stinger, D_belly, D_stinger, dPort } = data
  const controlsRef = useRef()

  const L_total = L_header + L_diffuser + Math.max(L_belly, 0) + L_baffle + L_stinger

  // scale so total visual width = 6 Three.js units
  const scale = L_total > 0 ? 6 / L_total : 1
  const rPort  = (dPort / 2) * scale
  const rBelly = (D_belly / 2) * scale
  const rSting = (D_stinger / 2) * scale

  const lens = useMemo(() => [
    Math.max(L_header, 0) * scale,
    Math.max(L_diffuser, 0) * scale,
    Math.max(L_belly, 0) * scale,
    Math.max(L_baffle, 0) * scale,
    Math.max(L_stinger, 0) * scale,
  ], [L_header, L_diffuser, L_belly, L_baffle, L_stinger, scale])

  const positions = useMemo(() => {
    const pos = []
    let cursor = -3
    lens.forEach(len => { pos.push(cursor + len / 2); cursor += len })
    return pos
  }, [lens])

  // r1 = RIGHT end radius, r2 = LEFT end radius
  // (cylinder rotation [0,0,π/2] maps radiusTop→LEFT, radiusBottom→RIGHT)
  const radii = [
    [rPort,  rPort ],  // Header: constant
    [rBelly, rPort ],  // Diffuser: LEFT=small, RIGHT=large → grows left→right ✓
    [rBelly, rBelly],  // Belly: constant large
    [rSting, rBelly],  // Baffle: LEFT=large, RIGHT=small → shrinks left→right ✓
    [rSting, rSting],  // Stinger: constant
  ]

  const segKeys = ['header', 'diffuser', 'belly', 'baffle', 'stinger']
  const mmPerUnit = L_total > 0 ? L_total / 6 : 1

  const boundaries = useMemo(() => {
    const b = []
    let cursor = -3
    for (let i = 0; i < lens.length - 1; i++) {
      cursor += lens[i]
      b.push(cursor)
    }
    return b
  }, [lens])

  const clipPlane = useMemo(() => {
    if (!crossSection) return null
    // constant shifts from +rBelly (no cut) down to -rBelly (full cut)
    const constant = rBelly - crossValue * rBelly * 2
    return new THREE.Plane(new THREE.Vector3(0, -1, 0), constant)
  }, [crossSection, crossValue, rBelly])

  const infoLabels = [
    `Header — ${Math.round(L_header)}mm | Ø${Math.round(dPort)}mm`,
    `Diffuser — ${Math.round(L_diffuser)}mm | Ø${Math.round(dPort)}→${Math.round(D_belly)}mm`,
    `Belly — ${Math.round(Math.max(L_belly, 0))}mm | Ø${Math.round(D_belly)}mm`,
    `Baffle — ${Math.round(L_baffle)}mm | Ø${Math.round(D_belly)}→${Math.round(D_stinger)}mm`,
    `Stinger — ${Math.round(L_stinger)}mm | Ø${Math.round(D_stinger)}mm`,
  ]

  if (L_total <= 0) return null

  return (
    <>
      <Lights />
      {lens.map((len, i) =>
        len > 0.005 ? (
          <ExhaustSegment
            key={i}
            r1={radii[i][0]}
            r2={radii[i][1]}
            length={len}
            color={SEG_COLORS[i]}
            posX={positions[i]}
            infoLabel={showLabels ? infoLabels[i] : SEG_NAMES[i]}
            clip={clipPlane}
            selected={selected === i}
            onClick={() => onSelect(selected === i ? null : i)}
          />
        ) : null
      )}
      <GasParticles active={showFlow} lens={lens} />
      <PulseWave active={showFlow} />
      {onDimChange && boundaries.map((bx, i) =>
        lens[i] > 0.005 && lens[i + 1] > 0.005 ? (
          <DragHandle
            key={i}
            posX={bx}
            segKey={segKeys[i]}
            dimValue={[L_header, L_diffuser, Math.max(L_belly, 0), L_baffle, L_stinger][i]}
            onDimChange={onDimChange}
            mmPerUnit={mmPerUnit}
            handleY={rBelly + 0.22}
            controlsRef={controlsRef}
          />
        ) : null
      )}
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.1} />
    </>
  )
}

export function ExhaustViewer({ data, dims: externalDims, onDimChange }) {
  const [showLabels, setShowLabels] = useState(false)
  const [showFlow, setShowFlow]     = useState(false)
  const [crossSection, setCross]    = useState(false)
  const [crossValue, setCrossVal]   = useState(0.5)
  const [selected, setSelected]     = useState(null)
  const [resetKey, setResetKey]     = useState(0)

  const merged = { ...data, dPort: data.dPort ?? data.D_belly / 2.5 }

  const [editedDims, setEditedDims] = useState(() => initDims(merged))
  const [prevData, setPrevData]     = useState(data)

  // Reset edits when a new calculation arrives (update-during-render pattern)
  if (data !== prevData) {
    setPrevData(data)
    setEditedDims(initDims(merged))
    setSelected(null)
  }

  const updateDim = (seg, key, raw) => {
    const n = parseFloat(raw)
    if (isNaN(n) || n < 0) return
    setEditedDims(prev => ({ ...prev, [seg]: { ...prev[seg], [key]: n } }))
  }

  const resetDims = () => setEditedDims(initDims(merged))

  // External dims (from App.jsx sliders/drag) take priority over internal edits
  const displayData = {
    ...merged,
    L_header:   externalDims?.header   ?? editedDims.header.length,
    L_diffuser: externalDims?.diffuser ?? editedDims.diffuser.length,
    L_belly:    externalDims?.belly    ?? editedDims.belly.length,
    L_baffle:   externalDims?.baffle   ?? editedDims.baffle.length,
    L_stinger:  externalDims?.stinger  ?? editedDims.stinger.length,
    D_stinger:  editedDims.stinger.id,
  }

  const dimRow = (label, seg, key, unit, base) => (
    <div key={`${seg}-${key}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#374151', minWidth: 110 }}>{label}</span>
      <input
        type="number"
        value={editedDims[seg][key]}
        step="0.5"
        min="0"
        onChange={e => updateDim(seg, key, e.target.value)}
        style={{
          width: 78, padding: '4px 8px', border: '1px solid #d1d5db',
          borderRadius: 6, fontSize: 13, fontFamily: 'system-ui',
        }}
      />
      <span style={{ fontSize: 11, color: '#9ca3af' }}>{unit}</span>
      <BadgeStatus value={editedDims[seg][key]} base={base} />
    </div>
  )

  const editFields = {
    0: [dimRow('Panjang', 'header',   'length', 'mm', data.L_header)],
    1: [dimRow('Panjang', 'diffuser', 'length', 'mm', data.L_diffuser)],
    2: [dimRow('Panjang', 'belly',    'length', 'mm', Math.max(data.L_belly, 0))],
    3: [dimRow('Panjang', 'baffle',   'length', 'mm', data.L_baffle)],
    4: [
      dimRow('Panjang',     'stinger', 'length', 'mm', data.L_stinger),
      dimRow('Diameter ID', 'stinger', 'id',     'mm', data.D_stinger),
    ],
  }

  return (
    <div>
      <ControlBar>
        <Btn onClick={() => setResetKey(k => k + 1)}>🔄 Reset View</Btn>
        <Btn active={crossSection} onClick={() => setCross(v => !v)}>
          ✂️ Cross-Section: {crossSection ? 'ON' : 'OFF'}
        </Btn>
        <Btn active={showFlow} onClick={() => setShowFlow(v => !v)}>
          💨 Gas Flow: {showFlow ? 'ON' : 'OFF'}
        </Btn>
        <Btn active={showLabels} onClick={() => setShowLabels(v => !v)}>
          🏷️ Labels: {showLabels ? 'ON' : 'OFF'}
        </Btn>
        {crossSection && (
          <SliderCtrl label="Potong:" value={crossValue} min={0} max={1} onChange={setCrossVal} />
        )}
      </ControlBar>

      <CanvasWrap>
        <CameraResetter trigger={resetKey} />
        <ExhaustScene
          data={displayData}
          showLabels={showLabels}
          showFlow={showFlow}
          crossSection={crossSection}
          crossValue={crossValue}
          selected={selected}
          onSelect={setSelected}
          onDimChange={onDimChange}
        />
      </CanvasWrap>

      {selected !== null && (
        <div style={{
          marginTop: 8, padding: '12px 16px', background: '#f9fafb',
          border: `1px solid #e5e7eb`,
          borderLeft: `4px solid ${SEG_COLORS[selected]}`,
          borderRadius: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Edit Dimensi — <span style={{ color: SEG_COLORS[selected] }}>{SEG_NAMES[selected]}</span>
            </span>
            <button onClick={resetDims} style={{
              fontSize: 11, padding: '3px 10px', border: '1px solid #d1d5db',
              borderRadius: 6, background: '#fff', color: '#374151', cursor: 'pointer',
            }}>↩ Reset ke kalkulasi</button>
          </div>
          {editFields[selected]}
          <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
            Badge warna menunjukkan deviasi dari nilai kalkulasi: ≤10% OK · 10–25% MODIFIKASI · &gt;25% PERHATIKAN
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODUL 2 — PORT & PISTON VIEWER (rebuilt)
// ══════════════════════════════════════════════════════════════════════════════

function PhaseIndicator({ angle }) {
  const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360
  const phase = deg < 90  ? 'Kompresi'
    : deg < 180 ? 'Pembakaran / Power'
    : deg < 270 ? 'Exhaust'
    : 'Transfer / Scavenging'
  const color = deg < 90  ? '#1d4ed8'
    : deg < 180 ? '#dc2626'
    : deg < 270 ? '#d97706'
    : '#15803d'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8,
      padding:'6px 14px', borderRadius:8, marginTop:6,
      background:'#f9fafb', border:'1px solid #e5e7eb' }}>
      <div style={{ width:10, height:10, borderRadius:'50%', background:color, flexShrink:0 }} />
      <span style={{ fontSize:12, fontWeight:500, color }}>Fase: {phase}</span>
      <span style={{ fontSize:11, color:'#9ca3af', marginLeft:'auto' }}>
        {deg.toFixed(0)}° kruk as
      </span>
    </div>
  )
}

function EngineAssembly({ data, form, isPlaying, speed, showCross, onAngleUpdate }) {
  const angleRef   = useRef(0)
  const crankRef   = useRef()
  const pistonRef  = useRef()
  const rodRef     = useRef()
  const exPortRef  = useRef()
  const trPort1Ref = useRef()
  const trPort2Ref = useRef()
  const headGlowRef = useRef()
  const sparkRef   = useRef()

  const bore   = form?.bore   || 54
  const stroke = form?.stroke || 54
  const rod    = form?.rod    || 105

  const sc = 2.0 / bore          // bore = 2.0 visual units
  const R  = (stroke / 2) * sc   // crank radius
  const L  = rod * sc            // con rod length
  const B  = (bore / 2) * sc     // bore radius = 1.0

  // Bell E_bell values from calculated data
  const E_vis  = (data?.E_bell  != null ? data.E_bell  : R / sc * 0.17) * sc
  const Et_vis = (data?.Et_bell != null ? data.Et_bell : R / sc * (-0.07)) * sc

  const crankCenterY = -(R + 0.5)
  const pistonH      = B * 0.8

  // Piston Y at TDC and BDC (crank at top/bottom, crankX≈0)
  const pistonY_TDC = crankCenterY + R + L
  const pistonY_BDC = crankCenterY - R + L
  const barrelCenterY = (pistonY_TDC + pistonY_BDC) / 2   // = crankCenterY + L
  const barrelH = 2 * R + pistonH + 0.9

  // Port top Y in world space — derived from Bell kinematics:
  // at port-open angle, crankPinY = crankCenterY + E_vis,
  // pistonY ≈ crankCenterY + E_vis + sqrt(L²-R²+E_vis²)
  const exPortY = crankCenterY + E_vis  + Math.sqrt(Math.max(0.01, L*L - R*R + E_vis*E_vis))
  const trPortY = crankCenterY + Et_vis + Math.sqrt(Math.max(0.01, L*L - R*R + Et_vis*Et_vis))

  const clipPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.05), [])
  const clip = showCross ? [clipPlane] : []

  const headY = pistonY_TDC + pistonH / 2 + 0.25

  useFrame((_, delta) => {
    if (!isPlaying) return
    angleRef.current += delta * speed * 6
    onAngleUpdate(angleRef.current)

    if (crankRef.current) crankRef.current.rotation.z = angleRef.current

    const a = angleRef.current
    const crankPinX = R * Math.sin(a)
    const crankPinY = crankCenterY + R * Math.cos(a)
    const pistonY   = crankPinY + Math.sqrt(Math.max(0.01, L*L - crankPinX*crankPinX))

    if (pistonRef.current) pistonRef.current.position.y = pistonY

    if (rodRef.current) {
      rodRef.current.position.set(crankPinX / 2, (crankPinY + pistonY) / 2, 0)
      rodRef.current.rotation.z = -Math.atan2(crankPinX, pistonY - crankPinY)
    }

    // Port open/close from crank angle
    const deg = ((a * 180 / Math.PI) % 360 + 360) % 360
    const epo = data?.epo ?? 80,  epc = data?.epc ?? 280
    const tpo = data?.tpo ?? 94,  tpc = data?.tpc ?? 266
    const exOpen = deg >= epo && deg <= epc
    const trOpen = deg >= tpo && deg <= tpc

    if (exPortRef.current?.material) {
      exPortRef.current.material.emissiveIntensity = exOpen ? 0.95 : 0.15
      exPortRef.current.material.color.set(exOpen ? '#ff4400' : '#cc2200')
    }
    ;[trPort1Ref, trPort2Ref].forEach(r => {
      if (r.current?.material) {
        r.current.material.emissiveIntensity = trOpen ? 0.85 : 0.12
        r.current.material.color.set(trOpen ? '#2266ff' : '#1144cc')
      }
    })

    // Head combustion glow near TDC
    const nearTDC = deg < 35 || deg > 325
    if (headGlowRef.current?.material)
      headGlowRef.current.material.emissiveIntensity = nearTDC ? 0.75 : 0.05
    if (sparkRef.current?.material)
      sparkRef.current.material.emissiveIntensity = (deg < 8 || deg > 352) ? 1.0 : 0.0
  })

  return (
    <group>

      {/* ── CRANKSHAFT (rotating group) ── */}
      <group ref={crankRef} position={[0, crankCenterY, 0]}>
        {/* main journal — axis along Z */}
        <mesh rotation={[Math.PI/2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.15, 0.5, 16]} />
          <meshStandardMaterial color="#e0e0e0" metalness={1.0} roughness={0.05} clippingPlanes={clip} />
        </mesh>
        {/* two crank webs (flat discs in XY plane at Z=±0.18) */}
        {[-0.18, 0.18].map((z, i) => (
          <mesh key={i} position={[0, 0, z]} rotation={[Math.PI/2, 0, 0]}>
            <cylinderGeometry args={[R*0.9, R*0.9, 0.08, 32]} />
            <meshStandardMaterial color="#444" metalness={0.7} roughness={0.3} clippingPlanes={clip} />
          </mesh>
        ))}
        {/* crank pin at local Y=R (orbits with group rotation) */}
        <mesh position={[0, R, 0]} rotation={[Math.PI/2, 0, 0]}>
          <cylinderGeometry args={[0.10, 0.10, 0.40, 16]} />
          <meshStandardMaterial color="#e0e0e0" metalness={1.0} roughness={0.05} clippingPlanes={clip} />
        </mesh>
        {/* counterweight (opposite side of crank pin) */}
        <mesh position={[0, -R*0.65, 0]}>
          <boxGeometry args={[R*0.8, R*0.5, 0.16]} />
          <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} clippingPlanes={clip} />
        </mesh>
      </group>

      {/* ── CON ROD ── */}
      <group ref={rodRef} position={[0, barrelCenterY, 0]}>
        <mesh>
          <cylinderGeometry args={[0.055, 0.055, L, 8]} />
          <meshStandardMaterial color="#888" metalness={0.8} roughness={0.15} clippingPlanes={clip} />
        </mesh>
        {/* big end (bottom, connects to crank pin) */}
        <mesh position={[0, -L/2, 0]} rotation={[Math.PI/2, 0, 0]}>
          <torusGeometry args={[0.10, 0.04, 8, 24]} />
          <meshStandardMaterial color="#999" metalness={0.8} roughness={0.2} clippingPlanes={clip} />
        </mesh>
        {/* small end (top, connects to piston pin) */}
        <mesh position={[0, L/2, 0]} rotation={[Math.PI/2, 0, 0]}>
          <torusGeometry args={[0.08, 0.035, 8, 24]} />
          <meshStandardMaterial color="#999" metalness={0.8} roughness={0.2} clippingPlanes={clip} />
        </mesh>
      </group>

      {/* ── PISTON ── */}
      <group ref={pistonRef} position={[0, pistonY_TDC, 0]}>
        {/* main body */}
        <mesh>
          <cylinderGeometry args={[B-0.05, B-0.05, pistonH, 32]} />
          <meshStandardMaterial color="#d0d0d0" metalness={0.7} roughness={0.2} clippingPlanes={clip} />
        </mesh>
        {/* crown dome */}
        <mesh position={[0, pistonH/2, 0]}>
          <sphereGeometry args={[B-0.05, 32, 16, 0, Math.PI*2, 0, Math.PI/5]} />
          <meshStandardMaterial color="#c8c8c8" metalness={0.8} roughness={0.15} clippingPlanes={clip} />
        </mesh>
        {/* three piston rings */}
        {[-pistonH*0.05, -pistonH*0.18, -pistonH*0.31].map((y, i) => (
          <mesh key={i} position={[0, y, 0]}>
            <torusGeometry args={[B-0.04, 0.025, 8, 32]} />
            <meshStandardMaterial color="#555" metalness={0.9} roughness={0.1} clippingPlanes={clip} />
          </mesh>
        ))}
        {/* gudgeon pin */}
        <mesh rotation={[Math.PI/2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, B*1.3, 16]} />
          <meshStandardMaterial color="#e0e0e0" metalness={1.0} roughness={0.05} clippingPlanes={clip} />
        </mesh>
        {/* skirt */}
        <mesh position={[0, -pistonH*0.38, 0]}>
          <cylinderGeometry args={[B-0.06, B-0.06, pistonH*0.45, 32]} />
          <meshStandardMaterial color="#b8b8b8" metalness={0.6} roughness={0.3} clippingPlanes={clip} />
        </mesh>
      </group>

      {/* ── CYLINDER BARREL ── */}
      {/* outer wall */}
      <mesh position={[0, barrelCenterY, 0]}>
        <cylinderGeometry args={[B+0.25, B+0.25, barrelH, 32]} />
        <meshStandardMaterial color="#909090" metalness={0.5} roughness={0.4} clippingPlanes={clip} />
      </mesh>
      {/* bore interior (BackSide = visible from inside) */}
      <mesh position={[0, barrelCenterY, 0]}>
        <cylinderGeometry args={[B, B, barrelH+0.1, 32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} side={THREE.BackSide} clippingPlanes={clip} />
      </mesh>
      {/* 7 cooling fins evenly distributed */}
      {Array.from({length: 7}, (_, i) => (
        <mesh key={i} position={[0, barrelCenterY - barrelH/2 + barrelH * (i+0.5)/7, 0]}>
          <torusGeometry args={[B+0.30, 0.04, 4, 32]} />
          <meshStandardMaterial color="#a8a8a8" metalness={0.5} roughness={0.4} clippingPlanes={clip} />
        </mesh>
      ))}

      {/* ── EXHAUST PORT (right side +X) ── */}
      <mesh ref={exPortRef} position={[B+0.20, exPortY, 0]}>
        <boxGeometry args={[0.32, 0.18, B*0.75]} />
        <meshStandardMaterial color="#cc2200" emissive="#880000" emissiveIntensity={0.15}
          clippingPlanes={clip} />
      </mesh>
      <Html position={[B+0.65, exPortY + 0.10, 0]}>
        <div style={{ fontSize:10, color:'#ff6644', fontWeight:700, whiteSpace:'nowrap',
          background:'rgba(0,0,0,0.72)', padding:'2px 6px', borderRadius:4, pointerEvents:'none' }}>
          Exhaust Port
        </div>
      </Html>

      {/* ── TRANSFER PORTS (front +Z and back -Z) ── */}
      {[1, -1].map((side, i) => (
        <mesh key={i} ref={i === 0 ? trPort1Ref : trPort2Ref}
          position={[0, trPortY, side*(B+0.18)]}
          rotation={[0, side * (-Math.PI/6), 0]}
        >
          <boxGeometry args={[B*0.55, 0.14, 0.30]} />
          <meshStandardMaterial color="#1144cc" emissive="#001188" emissiveIntensity={0.12}
            clippingPlanes={clip} />
        </mesh>
      ))}
      <Html position={[B+0.65, trPortY + 0.10, 0]}>
        <div style={{ fontSize:10, color:'#6699ff', fontWeight:700, whiteSpace:'nowrap',
          background:'rgba(0,0,0,0.72)', padding:'2px 6px', borderRadius:4, pointerEvents:'none' }}>
          Transfer Port
        </div>
      </Html>

      {/* ── CRANKCASE ── */}
      <mesh position={[0, crankCenterY - R*0.3, 0]}>
        <cylinderGeometry args={[B+0.50, B+0.40, R*1.8, 32]} />
        <meshStandardMaterial color="#707070" metalness={0.4} roughness={0.5} clippingPlanes={clip} />
      </mesh>
      {/* interior glow (BackSide so blue shows inside) */}
      <mesh position={[0, crankCenterY - R*0.3, 0]}>
        <cylinderGeometry args={[B+0.36, B+0.36, R*1.65, 32]} />
        <meshStandardMaterial color="#001a4d" emissive="#002299" emissiveIntensity={0.18}
          transparent opacity={0.65} side={THREE.BackSide} clippingPlanes={clip} />
      </mesh>
      <Html position={[0, crankCenterY - R*0.3, 0]}>
        <div style={{ fontSize:10, color:'#4488ff', fontWeight:600, textAlign:'center',
          background:'rgba(0,0,0,0.72)', padding:'2px 7px', borderRadius:4,
          whiteSpace:'nowrap', pointerEvents:'none' }}>
          CrankCase / Ruang Bilas
        </div>
      </Html>

      {/* ── CYLINDER HEAD ── */}
      {/* head body */}
      <mesh position={[0, headY + 0.22, 0]}>
        <cylinderGeometry args={[B+0.20, B+0.15, 0.42, 32]} />
        <meshStandardMaterial color="#808080" metalness={0.6} roughness={0.3} clippingPlanes={clip} />
      </mesh>
      {/* combustion chamber dome */}
      <mesh ref={headGlowRef} position={[0, headY, 0]}>
        <sphereGeometry args={[B*0.58, 32, 16, 0, Math.PI*2, 0, Math.PI/2]} />
        <meshStandardMaterial color="#cc4400" emissive="#882200" emissiveIntensity={0.05}
          clippingPlanes={clip} />
      </mesh>
      {/* spark plug body */}
      <mesh position={[0, headY + 0.44, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.30, 8]} />
        <meshStandardMaterial color="#888" metalness={0.7} clippingPlanes={clip} />
      </mesh>
      {/* spark electrode (flashes at TDC) */}
      <mesh ref={sparkRef} position={[0, headY + 0.25, 0]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#ffdd00" emissive="#ffaa00" emissiveIntensity={0.0} />
      </mesh>

      {/* ── TMA / TMB REFERENCE LINES & LABELS ── */}
      {/* TMA line */}
      <mesh position={[0, pistonY_TDC, 0]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.007, 0.007, (B+0.38)*2, 4]} />
        <meshStandardMaterial color="#22cc22" transparent opacity={0.55} />
      </mesh>
      <Html position={[B+0.52, pistonY_TDC, 0]}>
        <div style={{ fontSize:11, color:'#22cc22', fontWeight:700, whiteSpace:'nowrap',
          background:'rgba(0,0,0,0.65)', padding:'2px 6px', borderRadius:4, pointerEvents:'none' }}>
          ← TMA
        </div>
      </Html>

      {/* TMB line */}
      <mesh position={[0, pistonY_BDC, 0]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.007, 0.007, (B+0.38)*2, 4]} />
        <meshStandardMaterial color="#ffaa00" transparent opacity={0.55} />
      </mesh>
      <Html position={[B+0.52, pistonY_BDC, 0]}>
        <div style={{ fontSize:11, color:'#ffaa00', fontWeight:700, whiteSpace:'nowrap',
          background:'rgba(0,0,0,0.65)', padding:'2px 6px', borderRadius:4, pointerEvents:'none' }}>
          ← TMB
        </div>
      </Html>

    </group>
  )
}

export function PortViewer({ data, form }) {
  const [isPlaying, setIsPlaying] = useState(true)
  const [speed, setSpeed]         = useState(1.0)
  const [showCross, setShowCross] = useState(true)
  const [currentAngle, setCurrentAngle] = useState(0)
  const [resetKey, setResetKey]   = useState(0)

  if (!form) return null

  return (
    <div>
      <ControlBar>
        <Btn onClick={() => setResetKey(k => k+1)}>🔄 Reset View</Btn>
        <Btn active={isPlaying} onClick={() => setIsPlaying(v => !v)}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </Btn>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:11, color:'#6b7280' }}>Speed:</span>
          <input type="range" min={0.2} max={3} step={0.1} value={speed}
            onChange={e => setSpeed(parseFloat(e.target.value))}
            style={{ width:80, accentColor:'#c75e1a' }} />
          <span style={{ fontSize:11, color:'#6b7280' }}>{speed.toFixed(1)}×</span>
        </div>
        <Btn active={showCross} onClick={() => setShowCross(v => !v)}>
          ✂️ Cross-Section: {showCross ? 'ON' : 'OFF'}
        </Btn>
      </ControlBar>

      <div style={{ borderRadius:12, overflow:'hidden', height:460, background:'#e8e8f0' }}>
        <Canvas
          camera={{ position:[3.5, 1.0, 6.5], fov:45 }}
          gl={{ localClippingEnabled: true }}
          shadows
        >
          <CameraResetter trigger={resetKey} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 5, 3]} intensity={1.2} castShadow />
          <directionalLight position={[-3, 3, -3]} intensity={0.5} />
          <pointLight position={[0, 3, 0]} intensity={0.4} color="#fff5e0" />

          <EngineAssembly
            data={data}
            form={form}
            isPlaying={isPlaying}
            speed={speed}
            showCross={showCross}
            onAngleUpdate={setCurrentAngle}
          />

          <OrbitControls enableDamping dampingFactor={0.08} minDistance={2} maxDistance={14} />
          <gridHelper args={[8, 16, '#cccccc', '#e5e5e5']} position={[0, -3.2, 0]} />
        </Canvas>
      </div>

      <PhaseIndicator angle={currentAngle} />

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginTop:8 }}>
        {[
          { label:'EPO', value: data?.epo, color:'#dc2626' },
          { label:'EPC', value: data?.epc, color:'#dc2626' },
          { label:'TPO', value: data?.tpo, color:'#1d4ed8' },
          { label:'TPC', value: data?.tpc, color:'#1d4ed8' },
        ].map(item => (
          <div key={item.label} style={{ background:'#f9fafb', borderRadius:6,
            padding:'6px 10px', borderLeft:`3px solid ${item.color}` }}>
            <div style={{ fontSize:10, color:'#9ca3af' }}>{item.label}</div>
            <div style={{ fontSize:14, fontWeight:600, color:item.color }}>
              {item.value != null ? item.value.toFixed(1) + '°' : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODUL 3 — ECU DASHBOARD VIEWER
// ══════════════════════════════════════════════════════════════════════════════

function ArcGauge({ label, value, min, max, color, failsafe, unit, position }) {
  const needleRef = useRef()
  const hubRef    = useRef()
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))

  useFrame(({ clock }) => {
    if (!needleRef.current) return
    // map t [0,1] to angle [-0.7π, +0.7π]
    const targetAngle = (t - 0.5) * Math.PI * 1.4
    needleRef.current.rotation.z = -targetAngle

    if (hubRef.current && failsafe) {
      hubRef.current.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(clock.elapsedTime * 6)) * 0.5
    }
  })

  return (
    <group position={position}>
      {/* background track */}
      <mesh rotation={[0, 0, Math.PI * 0.7]}>
        <torusGeometry args={[0.72, 0.05, 8, 48, Math.PI * 1.4]} />
        <meshStandardMaterial color="#2a2a3e" metalness={0.2} roughness={0.8} />
      </mesh>
      {/* filled segment */}
      <mesh rotation={[0, 0, Math.PI * 0.7]}>
        <torusGeometry args={[0.72, 0.07, 8, 48, Math.PI * 1.4 * t]} />
        <meshStandardMaterial
          color={failsafe ? '#ef4444' : color}
          emissive={failsafe ? '#ef4444' : color}
          emissiveIntensity={0.5}
        />
      </mesh>
      {/* needle */}
      <group ref={needleRef}>
        <mesh position={[0, 0.36, 0.01]}>
          <boxGeometry args={[0.028, 0.72, 0.025]} />
          <meshStandardMaterial
            color={failsafe ? '#ef4444' : '#f0f0f0'}
            metalness={0.9}
            roughness={0.1}
          />
        </mesh>
      </group>
      {/* hub */}
      <mesh ref={hubRef}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial
          color={failsafe ? '#ef4444' : '#444'}
          emissive={failsafe ? '#ff0000' : '#000'}
          emissiveIntensity={0}
          metalness={0.9}
        />
      </mesh>
      <Html center position={[0, -1.05, 0]}>
        <div style={{
          textAlign: 'center', fontSize: 11,
          background: 'rgba(0,0,0,0.72)', color: '#fff',
          padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700, color: failsafe ? '#f87171' : color, fontSize: 13 }}>
            {value.toFixed(2)} {unit}
          </div>
          <div style={{ color: '#9ca3af', marginTop: 1 }}>{label}</div>
        </div>
      </Html>
    </group>
  )
}

const ZONE_COLORS = {
  'Low RPM':   '#3b82f6',
  'Mid RPM':   '#10b981',
  'Power band':'#f59e0b',
  'Peak power':'#ef4444',
  'Over-rev':  '#7c3aed',
}
const ZONES = ['Low RPM', 'Mid RPM', 'Power band', 'Peak power', 'Over-rev']

function RPMBars({ zone }) {
  const meshRefs = useRef([])
  const activeIdx = ZONES.indexOf(zone)

  useFrame(({ clock }) => {
    meshRefs.current.forEach((mesh, i) => {
      if (!mesh?.material) return
      if (i < activeIdx) {
        mesh.material.emissiveIntensity = 0.22
      } else if (i === activeIdx) {
        mesh.material.emissiveIntensity = 0.35 + Math.abs(Math.sin(clock.elapsedTime * 3.5)) * 0.35
      } else {
        mesh.material.emissiveIntensity = 0
      }
    })
  })

  return (
    <group position={[-3.2, -1.1, 0]}>
      {ZONES.map((z, i) => (
        <group key={z} position={[0, i * 0.58, 0]}>
          <mesh ref={el => { meshRefs.current[i] = el }}>
            <boxGeometry args={[1.5, 0.44, 0.18]} />
            <meshStandardMaterial
              color={ZONE_COLORS[z]}
              emissive={ZONE_COLORS[z]}
              emissiveIntensity={i <= activeIdx ? 0.2 : 0}
              metalness={0.3}
              roughness={0.55}
            />
          </mesh>
          <Html position={[0.85, 0, 0.12]} center>
            <div style={{
              fontSize: 9, whiteSpace: 'nowrap',
              color: i <= activeIdx ? '#fff' : '#555',
              fontWeight: i === activeIdx ? 700 : 400,
            }}>{z}</div>
          </Html>
        </group>
      ))}
    </group>
  )
}

function ShieldIndicator({ failsafe }) {
  const meshRef = useRef()
  useFrame(({ clock }) => {
    if (!meshRef.current?.material) return
    meshRef.current.material.emissiveIntensity = failsafe
      ? 0.5 + Math.abs(Math.sin(clock.elapsedTime * 7)) * 0.5
      : 0.08 + Math.sin(clock.elapsedTime * 1.2) * 0.04
  })

  return (
    <group position={[3.4, -0.3, 0]}>
      <mesh ref={meshRef} castShadow>
        <boxGeometry args={[0.85, 1.15, 0.18]} />
        <meshStandardMaterial
          color={failsafe ? '#ef4444' : '#22c55e'}
          emissive={failsafe ? '#ef4444' : '#22c55e'}
          emissiveIntensity={0.08}
          metalness={0.4}
          roughness={0.4}
        />
      </mesh>
      <Html center position={[0, -0.82, 0]}>
        <div style={{
          fontSize: 10, fontWeight: 700, textAlign: 'center',
          color: failsafe ? '#fca5a5' : '#86efac',
          background: 'rgba(0,0,0,0.7)', padding: '2px 7px', borderRadius: 4,
          whiteSpace: 'nowrap',
        }}>
          {failsafe ? '⚠ FAIL-SAFE' : '✓ Normal'}
        </div>
      </Html>
    </group>
  )
}

function ECUScene({ data }) {
  const { ign_final = 2.5, fuel_final = 4, rpmZone = 'Mid RPM', failsafe = false } = data
  return (
    <>
      <Lights />
      <ArcGauge
        label="Ignition"
        value={ign_final}
        min={1.5} max={4.0}
        unit="mm BTDC"
        color="#f59e0b"
        failsafe={failsafe}
        position={[-1.6, 1.1, 0]}
      />
      <ArcGauge
        label="Fuel PW"
        value={fuel_final}
        min={1.5} max={12.0}
        unit="ms"
        color="#3b82f6"
        failsafe={false}
        position={[1.6, 1.1, 0]}
      />
      <RPMBars zone={rpmZone} />
      <ShieldIndicator failsafe={failsafe} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </>
  )
}

export function ECUViewer({ data }) {
  const [resetKey, setResetKey] = useState(0)
  return (
    <div>
      <ControlBar>
        <Btn onClick={() => setResetKey(k => k + 1)}>🔄 Reset View</Btn>
      </ControlBar>
      <CanvasWrap>
        <CameraResetter trigger={resetKey} />
        <ECUScene data={data} />
      </CanvasWrap>
    </div>
  )
}
