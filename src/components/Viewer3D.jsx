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
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 420, width: '100%', background: '#1a1a2e' }}>
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

      {/* cap discs so ends don't show hollow */}
      {clip && (
        <>
          <mesh position={[length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <ringGeometry args={[r2 * 0.86, r2, 32]} />
            <meshStandardMaterial color="#8B4513" side={THREE.DoubleSide} clippingPlanes={[clip]} />
          </mesh>
          <mesh position={[-length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <ringGeometry args={[r1 * 0.86, r1, 32]} />
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

const PARTICLE_COUNT = 8
const initParticles = () =>
  Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    x: -3 + i * 0.78,
    speed: 0.022 + (i % 3) * 0.006,
  }))

function GasParticles({ active }) {
  const groupRef = useRef()
  const pts = useRef(initParticles())

  useFrame(() => {
    if (!active || !groupRef.current) return
    groupRef.current.children.forEach((mesh, i) => {
      pts.current[i].x += pts.current[i].speed
      if (pts.current[i].x > 3.1) pts.current[i].x = -3.0
      mesh.position.x = pts.current[i].x
      mesh.position.y = Math.sin(pts.current[i].x * 3.5) * 0.06
    })
  })

  if (!active) return null
  return (
    <group ref={groupRef}>
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color="#ff6600" emissive="#ff3300" emissiveIntensity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

// All hooks before any conditional logic
function ExhaustScene({ data, showLabels, showFlow, crossSection, crossValue, selected, onSelect }) {
  const { L_header, L_diffuser, L_belly, L_baffle, L_stinger, D_belly, D_stinger, dPort } = data

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

  const radii = [
    [rPort,  rPort],
    [rPort,  rBelly],
    [rBelly, rBelly],
    [rBelly, rSting],
    [rSting, rSting],
  ]

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
      <GasParticles active={showFlow} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </>
  )
}

export function ExhaustViewer({ data }) {
  const [showLabels, setShowLabels] = useState(false)
  const [showFlow, setShowFlow]     = useState(false)
  const [crossSection, setCross]    = useState(false)
  const [crossValue, setCrossVal]   = useState(0.5)
  const [selected, setSelected]     = useState(null)
  const [resetKey, setResetKey]     = useState(0)

  const merged = { ...data, dPort: data.dPort ?? data.D_belly / 2.5 }

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
          data={merged}
          showLabels={showLabels}
          showFlow={showFlow}
          crossSection={crossSection}
          crossValue={crossValue}
          selected={selected}
          onSelect={setSelected}
        />
      </CanvasWrap>

      {selected !== null && (
        <div style={{
          marginTop: 8, padding: '8px 14px', background: '#f9fafb',
          border: `2px solid ${SEG_COLORS[selected]}`, borderRadius: 8,
          fontSize: 12, color: '#374151',
        }}>
          <strong style={{ color: SEG_COLORS[selected] }}>{SEG_NAMES[selected]}</strong>
          {selected === 0 && ` — Panjang: ${Math.round(data.L_header)}mm | Ø: ${Math.round(merged.dPort)}mm (konstan)`}
          {selected === 1 && ` — Panjang: ${Math.round(data.L_diffuser)}mm | Ø: ${Math.round(merged.dPort)}→${Math.round(data.D_belly)}mm`}
          {selected === 2 && ` — Panjang: ${Math.round(Math.max(data.L_belly, 0))}mm | Ø: ${Math.round(data.D_belly)}mm (konstan)`}
          {selected === 3 && ` — Panjang: ${Math.round(data.L_baffle)}mm | Ø: ${Math.round(data.D_belly)}→${Math.round(data.D_stinger)}mm`}
          {selected === 4 && ` — Panjang: ${Math.round(data.L_stinger)}mm | Ø: ${Math.round(data.D_stinger)}mm (konstan)`}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODUL 2 — PORT & PISTON VIEWER
// ══════════════════════════════════════════════════════════════════════════════

function PortScene({ form, data, playing, speed, crossSection }) {
  const angleRef = useRef(0)
  const pistonRef  = useRef()
  const conrodRef  = useRef()
  const exPortRef  = useRef()
  const trPortRef  = useRef()
  const trPortRef2 = useRef()

  const { bore, stroke, conrod, E, Et } = form

  // scale so barrel height ~ 4 units
  const SCALE   = 4 / (stroke * 1.4)
  const boreR   = (bore / 2) * SCALE
  const wallT   = 9 * SCALE
  const barrelH = stroke * 1.2 * SCALE
  const pistonH = bore * 0.5 * SCALE
  const rodLen  = conrod * SCALE
  const halfS   = (stroke / 2) * SCALE

  // port Y positions relative to barrel center (barrel bottom = -barrelH/2)
  const exPortY = barrelH / 2 - E * SCALE
  const trPortY = barrelH / 2 - Et * SCALE

  const clipPlane = useMemo(() =>
    crossSection ? new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.01) : null,
  [crossSection])
  const clipArr = clipPlane ? [clipPlane] : []

  useFrame(() => {
    if (!playing) return
    angleRef.current += speed * 0.03

    const a = angleRef.current
    // piston Y from crank center (0,0): sin gives BDC at bottom, TDC at top
    const pistonY = halfS * Math.sin(a)
    const crankY  = 0  // crank center at world Y=0 (inside crankcase)
    const pistonWorldY = crankY + pistonY + rodLen * 0.5

    if (pistonRef.current) {
      pistonRef.current.position.y = pistonWorldY
    }

    if (conrodRef.current) {
      const midY = (pistonWorldY - pistonH / 2 + crankY) / 2
      const dx   = halfS * Math.cos(a) * 0.25
      conrodRef.current.position.y = midY
      conrodRef.current.position.x = dx * 0.3
      const dy = pistonWorldY - pistonH / 2 - crankY
      conrodRef.current.rotation.z = Math.atan2(dx * 0.3, dy)
    }

    // port glow: use angle mod 2π mapped to 0-360°
    const deg = ((a % (Math.PI * 2)) / (Math.PI * 2)) * 360
    const normDeg = ((deg % 360) + 360) % 360

    const exDur = data.exDur ?? 180
    const trDur = data.trDur ?? 160
    const EPO = 180 - exDur / 2, EPC = 180 + exDur / 2
    const TPO = 180 - trDur / 2, TPC = 180 + trDur / 2

    const exOpen = normDeg >= EPO && normDeg <= EPC
    const trOpen = normDeg >= TPO && normDeg <= TPC

    if (exPortRef.current?.material) {
      exPortRef.current.material.emissiveIntensity = exOpen ? 0.7 : 0.08
    }
    ;[trPortRef, trPortRef2].forEach(r => {
      if (r.current?.material) r.current.material.emissiveIntensity = trOpen ? 0.7 : 0.05
    })
  })

  return (
    <>
      <Lights />

      {/* crankcase box */}
      <mesh position={[0, -barrelH / 2 - barrelH * 0.22, 0]} receiveShadow>
        <boxGeometry args={[boreR * 3.6, barrelH * 0.42, boreR * 3.0]} />
        <meshStandardMaterial color="#8a8a8a" metalness={0.6} roughness={0.4} clippingPlanes={clipArr} />
      </mesh>

      {/* barrel outer */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[boreR + wallT, boreR + wallT, barrelH, 48]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.55} roughness={0.35} clippingPlanes={clipArr} />
      </mesh>

      {/* bore inner — dark back-face so bore looks hollow */}
      <mesh>
        <cylinderGeometry args={[boreR, boreR, barrelH + 0.02, 48]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.1} roughness={0.9} side={THREE.BackSide} clippingPlanes={clipArr} />
      </mesh>

      {/* exhaust port block */}
      <mesh ref={exPortRef} position={[boreR + wallT * 0.6, exPortY - barrelH / 2 + barrelH / 2, 0]} castShadow>
        <boxGeometry args={[wallT * 1.1, 11 * SCALE, boreR * 0.85]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff2200" emissiveIntensity={0.1} clippingPlanes={clipArr} />
      </mesh>

      {/* transfer port +Z */}
      <mesh ref={trPortRef} position={[0, trPortY - barrelH / 2 + barrelH / 2, boreR + wallT * 0.6]}>
        <boxGeometry args={[boreR * 0.75, 9 * SCALE, wallT * 1.1]} />
        <meshStandardMaterial color="#3377ff" emissive="#1155ff" emissiveIntensity={0.05} clippingPlanes={clipArr} />
      </mesh>

      {/* transfer port -Z */}
      <mesh ref={trPortRef2} position={[0, trPortY - barrelH / 2 + barrelH / 2, -(boreR + wallT * 0.6)]}>
        <boxGeometry args={[boreR * 0.75, 9 * SCALE, wallT * 1.1]} />
        <meshStandardMaterial color="#3377ff" emissive="#1155ff" emissiveIntensity={0.05} clippingPlanes={clipArr} />
      </mesh>

      {/* piston group */}
      <group ref={pistonRef} position={[0, halfS, 0]}>
        {/* piston body */}
        <mesh castShadow>
          <cylinderGeometry args={[boreR * 0.972, boreR * 0.972, pistonH, 32]} />
          <meshStandardMaterial color="#e2e2e2" metalness={0.88} roughness={0.1} clippingPlanes={clipArr} />
        </mesh>
        {/* ring 1 */}
        <mesh position={[0, pistonH * 0.22, 0]}>
          <torusGeometry args={[boreR * 0.975, 0.016, 8, 32]} />
          <meshStandardMaterial color="#777" metalness={0.95} roughness={0.08} clippingPlanes={clipArr} />
        </mesh>
        {/* ring 2 */}
        <mesh position={[0, pistonH * 0.05, 0]}>
          <torusGeometry args={[boreR * 0.975, 0.016, 8, 32]} />
          <meshStandardMaterial color="#777" metalness={0.95} roughness={0.08} clippingPlanes={clipArr} />
        </mesh>
        {/* gudgeon pin */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.028, boreR * 1.7, 12]} />
          <meshStandardMaterial color="#ddd" metalness={1} roughness={0.04} clippingPlanes={clipArr} />
        </mesh>
      </group>

      {/* con rod */}
      <mesh ref={conrodRef} position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, rodLen, 8]} />
        <meshStandardMaterial color="#aaa" metalness={0.8} roughness={0.25} clippingPlanes={clipArr} />
      </mesh>

      {/* crank web (half-arc) */}
      <mesh position={[0, -barrelH / 2 - halfS * 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[halfS * 0.75, 0.05, 8, 32, Math.PI]} />
        <meshStandardMaterial color="#888" metalness={0.82} roughness={0.22} clippingPlanes={clipArr} />
      </mesh>

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </>
  )
}

export function PortViewer({ data, form }) {
  const [playing, setPlaying]     = useState(true)
  const [speed, setSpeed]         = useState(1)
  const [crossSection, setCross]  = useState(false)
  const [resetKey, setResetKey]   = useState(0)

  if (!form) return null

  return (
    <div>
      <ControlBar>
        <Btn onClick={() => setResetKey(k => k + 1)}>🔄 Reset View</Btn>
        <Btn active={playing} onClick={() => setPlaying(v => !v)}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </Btn>
        <SliderCtrl label="⚡ Speed:" value={speed} min={0.5} max={3} step={0.1} onChange={setSpeed} />
        <Btn active={crossSection} onClick={() => setCross(v => !v)}>
          🔍 Cross-Section: {crossSection ? 'ON' : 'OFF'}
        </Btn>
      </ControlBar>
      <CanvasWrap>
        <CameraResetter trigger={resetKey} />
        <PortScene
          form={form}
          data={data}
          playing={playing}
          speed={speed}
          crossSection={crossSection}
        />
      </CanvasWrap>
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
