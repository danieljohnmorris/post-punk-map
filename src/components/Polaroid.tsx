import { useRef, useState, useCallback } from "react"
import { Text, RoundedBox } from "@react-three/drei"
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

const DRAG_LERP = 0.12       // how fast the card catches up (lower = more lag)
const ROTATION_DRAG = 0.08   // how fast rotation settles
const VELOCITY_TILT = 0.15   // how much velocity tilts the card

interface PolaroidProps {
  band: Band
  position: [number, number, number]
  rotation: number
  genreColor: string
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function Polaroid({ band, position, rotation, genreColor, onDragStart, onDragEnd }: PolaroidProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const [hovered, setHovered] = useState(false)
  const draggingRef = useRef(false)
  const [, setDragTick] = useState(0) // force re-render for cursor

  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const dragOffset = useRef(new THREE.Vector3())
  const targetPos = useRef(new THREE.Vector3())
  const prevPos = useRef(new THREE.Vector3())
  const velocity = useRef(new THREE.Vector2(0, 0))
  const baseRotation = useRef(rotation)

  const { raycaster } = useThree()

  useFrame(() => {
    if (!groupRef.current) return
    const pos = groupRef.current.position

    if (draggingRef.current) {
      // Lerp position toward target (creates the lag)
      const oldX = pos.x
      const oldY = pos.y
      pos.x = THREE.MathUtils.lerp(pos.x, targetPos.current.x, DRAG_LERP)
      pos.y = THREE.MathUtils.lerp(pos.y, targetPos.current.y, DRAG_LERP)

      // Track velocity for tilt
      velocity.current.set(pos.x - oldX, pos.y - oldY)

      // Tilt based on horizontal velocity
      const tiltTarget = baseRotation.current - velocity.current.x * VELOCITY_TILT
      groupRef.current.rotation.z = THREE.MathUtils.lerp(
        groupRef.current.rotation.z,
        tiltTarget,
        ROTATION_DRAG
      )

      // Lift up
      pos.z = THREE.MathUtils.lerp(pos.z, 0.5, 0.15)
    } else {
      // Settle rotation back
      groupRef.current.rotation.z = THREE.MathUtils.lerp(
        groupRef.current.rotation.z,
        baseRotation.current,
        0.08
      )

      // Z hover / settle
      const targetZ = hovered ? 0.3 : 0
      pos.z = THREE.MathUtils.lerp(pos.z, targetZ, 0.12)

      // Decay velocity
      velocity.current.multiplyScalar(0.9)
    }
  })

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation()
    draggingRef.current = true
    setDragTick((t) => t + 1)
    onDragStart?.()

    const pos = groupRef.current.position
    dragOffset.current.set(pos.x - e.point.x, pos.y - e.point.y, 0)
    targetPos.current.set(pos.x, pos.y, pos.z)
    prevPos.current.copy(pos)

    e.target?.setPointerCapture?.(e.pointerId)
    document.body.style.cursor = "grabbing"
  }, [onDragStart])

  const handlePointerMove = useCallback((e: any) => {
    if (!draggingRef.current) return
    e.stopPropagation()

    const intersection = new THREE.Vector3()
    raycaster.ray.intersectPlane(dragPlane.current, intersection)

    if (intersection) {
      // Update target — the useFrame lerp will chase it
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

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, 0, rotation]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = draggingRef.current ? "grabbing" : "grab" }}
      onPointerOut={() => { if (!draggingRef.current) { setHovered(false); document.body.style.cursor = "auto" } }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* White polaroid frame */}
      <RoundedBox args={[POLAROID_W, POLAROID_H, 0.02]} radius={0.015} smoothness={4}>
        <meshStandardMaterial color="#f5f0e8" />
      </RoundedBox>

      {/* Photo area */}
      <mesh position={[0, (POLAROID_H - PHOTO_H) / 2 - BORDER, 0.011]}>
        <planeGeometry args={[PHOTO_W, PHOTO_H]} />
        <meshStandardMaterial color={genreColor} toneMapped={false} />
      </mesh>

      {/* Darker overlay */}
      <mesh position={[0, (POLAROID_H - PHOTO_H) / 2 - BORDER, 0.012]}>
        <planeGeometry args={[PHOTO_W, PHOTO_H]} />
        <meshStandardMaterial color="#000000" transparent opacity={0.45} />
      </mesh>

      {/* Band initial */}
      <Text
        position={[0, (POLAROID_H - PHOTO_H) / 2 - BORDER, 0.015]}
        fontSize={0.4}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        font="/fonts/SpaceMono-Bold.woff"
        material-transparent
        material-opacity={0.2}
      >
        {band.name.charAt(0)}
      </Text>

      {/* Band name */}
      <Text
        position={[0, -POLAROID_H / 2 + BOTTOM / 2 + 0.01, 0.015]}
        fontSize={0.065}
        maxWidth={POLAROID_W - 0.12}
        color="#1a1a1a"
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        font="/fonts/SpaceMono-Regular.woff"
        lineHeight={1.2}
      >
        {band.name}
      </Text>

      {/* Pin */}
      <mesh position={[0, POLAROID_H / 2 - 0.05, 0.04]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial color="#cc3333" metalness={0.3} roughness={0.4} />
      </mesh>
    </group>
  )
}
