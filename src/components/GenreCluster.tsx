import { Text } from "@react-three/drei"
import { Polaroid } from "./Polaroid"
import type { Genre } from "../data/bands"
import { useMemo } from "react"

// Deterministic pseudo-random from seed
function seededRandom(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 49297
  return x - Math.floor(x)
}

interface GenreClusterProps {
  genre: Genre
}

export function GenreCluster({ genre }: GenreClusterProps) {
  const placements = useMemo(() => {
    const cols = Math.ceil(Math.sqrt(genre.bands.length))
    return genre.bands.map((band, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      const seed = band.name.length * 17 + i * 31
      const jitterX = (seededRandom(seed) - 0.5) * 0.3
      const jitterY = (seededRandom(seed + 1) - 0.5) * 0.3
      const rotation = (seededRandom(seed + 2) - 0.5) * 0.15

      return {
        band,
        position: [
          col * 1.9 + jitterX,
          -row * 2.3 + jitterY,
          0.01 + i * 0.001, // slight z offset to avoid z-fighting
        ] as [number, number, number],
        rotation,
      }
    })
  }, [genre.bands])

  // Center the cluster
  const cols = Math.ceil(Math.sqrt(genre.bands.length))
  const rows = Math.ceil(genre.bands.length / cols)
  const offsetX = -((cols - 1) * 1.9) / 2
  const offsetY = ((rows - 1) * 2.3) / 2

  return (
    <group position={[genre.position[0], genre.position[1], 0]}>
      {/* Genre label */}
      <Text
        position={[0, offsetY + 1.5, 0.02]}
        fontSize={0.22}
        color={genre.color}
        anchorX="center"
        anchorY="middle"
        font="/fonts/SpaceMono-Bold.woff"
        outlineWidth={0.01}
        outlineColor="#2a1f14"
      >
        {genre.name.toUpperCase()}
      </Text>

      {/* Dashed border/area indicator */}
      <mesh position={[0, offsetY / 2 - ((rows - 1) * 2.3) / 4 + 0.3, -0.01]}>
        <planeGeometry args={[cols * 2.1 + 0.5, rows * 2.5 + 0.8]} />
        <meshStandardMaterial
          color={genre.color}
          transparent
          opacity={0.04}
        />
      </mesh>

      {/* Polaroids */}
      <group position={[offsetX, offsetY, 0]}>
        {placements.map(({ band, position, rotation }) => (
          <Polaroid
            key={band.name}
            band={band}
            position={position}
            rotation={rotation}
            genreColor={genre.color}
          />
        ))}
      </group>
    </group>
  )
}
