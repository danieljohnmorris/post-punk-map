import { useRef, useState, useCallback, useMemo } from "react"
import { Text } from "@react-three/drei"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import type { Band } from "../data/bands"

const S = 0.55
const POLAROID_W = 1.6 * S
const POLAROID_H = 2.0 * S
const PHOTO_W = 1.3 * S
const PHOTO_H = 1.2 * S
const BORDER = 0.15 * S
const BOTTOM = 0.45 * S
const PIN_Y = POLAROID_H / 2 - 0.05 * S

// Physics
const SWING_DAMPING = 0.985
const SWING_STIFFNESS = 0.015
const SWING_RESPONSE = 12.0
const GRAVITY = 0.008
const DRAG_LERP_SPEED = 0.05
const IDLE_BREEZE = 0.0003

// Darken a hex color by mixing with black
function darkenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const f = 1 - amount
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`
}

interface PolaroidProps {
  band: Band
  position: [number, number, number]
  rotation: number
  genreColor: string
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function Polaroid({ band, position, rotation, genreColor, onDragStart, onDragEnd }: PolaroidProps) {
  const pivotRef = useRef<THREE.Group>(null!)
  const cardRef = useRef<THREE.Group>(null!)

  const [hovered, setHovered] = useState(false)
  const draggingRef = useRef(false)
  const [, setDragTick] = useState(0)

  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const dragOffset = useRef(new THREE.Vector3())
  const targetPos = useRef(new THREE.Vector3())

  const swingAngle = useRef(0)
  const swingVelocity = useRef(0)

  const { raycaster } = useThree()

  // Pre-compute darkened color so we don't need an overlay plane
  const photoColor = useMemo(() => darkenColor(genreColor, 0.45), [genreColor])

  useFrame((state) => {
    if (!pivotRef.current || !cardRef.current) return
    const pos = pivotRef.current.position
    const t = state.clock.elapsedTime

    if (draggingRef.current) {
      const oldX = pos.x
      const oldY = pos.y

      pos.x = THREE.MathUtils.lerp(pos.x, targetPos.current.x, DRAG_LERP_SPEED)
      pos.y = THREE.MathUtils.lerp(pos.y, targetPos.current.y, DRAG_LERP_SPEED)
      pos.z = THREE.MathUtils.lerp(pos.z, 0.6, 0.08)

      const accelX = pos.x - oldX
      const accelY = pos.y - oldY
      swingVelocity.current += accelX * SWING_RESPONSE
      swingVelocity.current += accelY * SWING_RESPONSE * 0.4
    } else {
      const targetZ = hovered ? 0.25 : 0
      pos.z = THREE.MathUtils.lerp(pos.z, targetZ, 0.06)

      // Ambient breeze
      const phase = position[0] * 3.7 + position[1] * 2.3
      const breeze = Math.sin(t * 0.8 + phase) * IDLE_BREEZE
        + Math.sin(t * 1.3 + phase * 0.7) * IDLE_BREEZE * 0.5
      swingVelocity.current += breeze
    }

    // Pendulum physics
    swingVelocity.current -= swingAngle.current * SWING_STIFFNESS
    swingVelocity.current -= Math.sin(swingAngle.current) * GRAVITY
    swingVelocity.current *= SWING_DAMPING
    swingAngle.current += swingVelocity.current
    swingAngle.current = THREE.MathUtils.clamp(swingAngle.current, -0.8, 0.8)

    cardRef.current.rotation.z = rotation + swingAngle.current
  })

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation()
    draggingRef.current = true
    setDragTick((t) => t + 1)
    onDragStart?.()

    const pos = pivotRef.current.position
    dragOffset.current.set(pos.x - e.point.x, pos.y - e.point.y, 0)
    targetPos.current.set(pos.x, pos.y, pos.z)

    e.target?.setPointerCapture?.(e.pointerId)
    document.body.style.cursor = "grabbing"
  }, [onDragStart])

  const handlePointerMove = useCallback((e: any) => {
    if (!draggingRef.current) return
    e.stopPropagation()

    const intersection = new THREE.Vector3()
    raycaster.ray.intersectPlane(dragPlane.current, intersection)

    if (intersection) {
      targetPos.current.x = intersection.x + dragOffset.current.x
      targetPos.current.y = intersection.y + dragOffset.current.y
    }
  }, [raycaster])

  const handlePointerUp = useCallback((e: any) => {
    e.stopPropagation()
    draggingRef.current = false
    setDragTick((t) => t + 1)
    onDragEnd?.()
    document.body.style.cursor = hovered ? "grab" : "auto"
  }, [onDragEnd, hovered])

  const photoY = (POLAROID_H - PHOTO_H) / 2 - BORDER

  return (
    <group
      ref={pivotRef}
      position={[position[0], position[1] + PIN_Y, position[2]]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = draggingRef.current ? "grabbing" : "grab" }}
      onPointerOut={() => { if (!draggingRef.current) { setHovered(false); document.body.style.cursor = "auto" } }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <group ref={cardRef} rotation={[0, 0, rotation]}>
        <group position={[0, -PIN_Y, 0]}>
          {/* White polaroid card — single box, no separate planes fighting */}
          <mesh>
            <boxGeometry args={[POLAROID_W, POLAROID_H, 0.02]} />
            <meshStandardMaterial color="#f0ebe0" />
          </mesh>

          {/* Photo area — single plane, no overlay needed */}
          <mesh position={[0, photoY, 0.011]}>
            <planeGeometry args={[PHOTO_W, PHOTO_H]} />
            <meshStandardMaterial
              color={photoColor}
              polygonOffset
              polygonOffsetFactor={-1}
            />
          </mesh>

          {/* Band initial */}
          <Text
            position={[0, photoY, 0.02]}
            fontSize={0.35}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            font="/fonts/SpaceMono-Bold.woff"
            material-transparent
            material-opacity={0.15}
            material-depthWrite={false}
          >
            {band.name.charAt(0)}
          </Text>

          {/* Band name */}
          <Text
            position={[0, -POLAROID_H / 2 + BOTTOM / 2 + 0.01, 0.02]}
            fontSize={0.065}
            maxWidth={POLAROID_W - 0.12}
            color="#1a1a1a"
            anchorX="center"
            anchorY="middle"
            textAlign="center"
            font="/fonts/SpaceMono-Regular.woff"
            lineHeight={1.2}
            material-depthWrite={false}
          >
            {band.name}
          </Text>
        </group>
      </group>

      {/* Pin */}
      <mesh position={[0, 0, 0.03]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#cc3333" metalness={0.3} roughness={0.4} />
      </mesh>
    </group>
  )
}
