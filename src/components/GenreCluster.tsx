import { Text } from "@react-three/drei"
import { Polaroid } from "./Polaroid"
import type { Genre } from "../data/bands"
import { MIN_YEAR, MAX_YEAR, genres } from "../data/bands"
import { useMemo } from "react"

export const BOARD_W = 50
const MARGIN_X = 3
const MARGIN_TOP = 2
const ROW_COUNT = genres.length
const ROW_H = 4.5  // fixed row height — generous for 12 rows
const BOARD_H = MARGIN_TOP + ROW_COUNT * ROW_H

export { BOARD_H }

function seededRandom(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 49297
  return x - Math.floor(x)
}

export function yearToX(year: number): number {
  const t = (year - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)
  return -BOARD_W / 2 + MARGIN_X + t * (BOARD_W - MARGIN_X * 2)
}

interface GenreClusterProps {
  genre: Genre
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function GenreCluster({ genre, onDragStart, onDragEnd }: GenreClusterProps) {
  const rowY = BOARD_H / 2 - MARGIN_TOP - genre.row * ROW_H - ROW_H / 2

  const placements = useMemo(() => {
    const sorted = [...genre.bands].sort((a, b) => a.year - b.year)

    // Track occupied slots to stagger same-year bands
    const yearGroups = new Map<number, number>()

    return sorted.map((band, i) => {
      const baseX = yearToX(band.year)
      const seed = band.name.length * 17 + i * 31

      const count = yearGroups.get(band.year) ?? 0
      yearGroups.set(band.year, count + 1)

      // Spread same-year bands in a small grid pattern
      const col = Math.floor(count / 2)
      const row = count % 2
      const offsetX = col * 1.1
      const offsetY = (row - 0.5) * 1.2

      const jitterX = (seededRandom(seed) - 0.5) * 0.2
      const jitterY = (seededRandom(seed + 1) - 0.5) * 0.15
      const rotation = (seededRandom(seed + 2) - 0.5) * 0.12

      return {
        band,
        position: [
          baseX + offsetX + jitterX,
          rowY + offsetY + jitterY,
          0.01 + i * 0.001,
        ] as [number, number, number],
        rotation,
      }
    })
  }, [genre.bands, rowY])

  const labelX = -BOARD_W / 2 + 0.3

  return (
    <group>
      {/* Genre label */}
      <Text
        position={[labelX, rowY + 0.1, 0.02]}
        fontSize={0.2}
        color={genre.color}
        anchorX="left"
        anchorY="middle"
        font="/fonts/SpaceMono-Bold.woff"
        outlineWidth={0.008}
        outlineColor="#2a1f14"
        maxWidth={3.5}
        lineHeight={1.1}
      >
        {genre.name.toUpperCase()}
      </Text>

      {/* Row divider */}
      <mesh position={[0, rowY + ROW_H / 2, -0.02]}>
        <planeGeometry args={[BOARD_W - 1, 0.004]} />
        <meshStandardMaterial color="#5a4520" transparent opacity={0.2} />
      </mesh>

      {placements.map(({ band, position, rotation }) => (
        <Polaroid
          key={band.name}
          band={band}
          position={position}
          rotation={rotation}
          genreColor={genre.color}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      ))}
    </group>
  )
}
