import { useRef, useState } from "react"
import { Text, RoundedBox } from "@react-three/drei"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import type { Band } from "../data/bands"

const POLAROID_W = 1.6
const POLAROID_H = 2.0
const PHOTO_W = 1.3
const PHOTO_H = 1.2
const BORDER = 0.15
const BOTTOM = 0.45

interface PolaroidProps {
  band: Band
  position: [number, number, number]
  rotation: number
  genreColor: string
}

export function Polaroid({ band, position, rotation, genreColor }: PolaroidProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const [hovered, setHovered] = useState(false)
  const targetZ = hovered ? 0.3 : 0

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
      <RoundedBox args={[POLAROID_W, POLAROID_H, 0.02]} radius={0.02} smoothness={4}>
        <meshStandardMaterial color="#f5f0e8" />
      </RoundedBox>

      {/* Photo area - dark with genre tint */}
      <mesh position={[0, (POLAROID_H - PHOTO_H) / 2 - BORDER, 0.011]}>
        <planeGeometry args={[PHOTO_W, PHOTO_H]} />
        <meshStandardMaterial color={genreColor} toneMapped={false} />
      </mesh>

      {/* Noise/grain overlay on photo */}
      <mesh position={[0, (POLAROID_H - PHOTO_H) / 2 - BORDER, 0.012]}>
        <planeGeometry args={[PHOTO_W, PHOTO_H]} />
        <meshStandardMaterial
          color="#000000"
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Band initial large letter */}
      <Text
        position={[0, (POLAROID_H - PHOTO_H) / 2 - BORDER, 0.015]}
        fontSize={0.7}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        font="/fonts/SpaceMono-Bold.woff"
        material-transparent
        material-opacity={0.15}
      >
        {band.name.charAt(0)}
      </Text>

      {/* Band name on white strip */}
      <Text
        position={[0, -POLAROID_H / 2 + BOTTOM / 2 + 0.02, 0.015]}
        fontSize={0.11}
        maxWidth={POLAROID_W - 0.3}
        color="#1a1a1a"
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        font="/fonts/SpaceMono-Regular.woff"
        lineHeight={1.2}
      >
        {band.name}
      </Text>

      {/* Year */}
      <Text
        position={[POLAROID_W / 2 - 0.15, -POLAROID_H / 2 + 0.1, 0.015]}
        fontSize={0.065}
        color="#999"
        anchorX="right"
        anchorY="bottom"
        font="/fonts/SpaceMono-Regular.woff"
      >
        {String(band.year)}
      </Text>

      {/* Pin/tack */}
      <mesh position={[0, POLAROID_H / 2 - 0.08, 0.05]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#cc3333" metalness={0.3} roughness={0.4} />
      </mesh>

      {/* Pin shadow */}
      <mesh position={[0.02, POLAROID_H / 2 - 0.1, 0.005]}>
        <circleGeometry args={[0.05, 12]} />
        <meshStandardMaterial color="#000" transparent opacity={0.15} />
      </mesh>
    </group>
  )
}
