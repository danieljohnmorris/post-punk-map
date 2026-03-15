import { useRef, useState } from "react"
import { Text, RoundedBox } from "@react-three/drei"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import type { Band } from "../data/bands"

const S = 0.55 // scale factor
const POLAROID_W = 1.6 * S
const POLAROID_H = 2.0 * S
const PHOTO_W = 1.3 * S
const PHOTO_H = 1.2 * S
const BORDER = 0.15 * S
const BOTTOM = 0.45 * S

interface PolaroidProps {
  band: Band
  position: [number, number, number]
  rotation: number
  genreColor: string
}

export function Polaroid({ band, position, rotation, genreColor }: PolaroidProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const [hovered, setHovered] = useState(false)
  const targetZ = hovered ? 0.4 : 0

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.z = THREE.MathUtils.lerp(
        groupRef.current.position.z,
        targetZ,
        0.1
      )
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, 0, rotation]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer" }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto" }}
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
