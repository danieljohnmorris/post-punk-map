import { Text } from "@react-three/drei"
import { Polaroid } from "./Polaroid"
import type { Genre } from "../data/bands"
import { MIN_YEAR, MAX_YEAR } from "../data/bands"
import { useMemo } from "react"

const BOARD_W = 34
const BOARD_H = 22
const MARGIN_X = 2.5
const MARGIN_TOP = 2.5
const ROW_COUNT = 6
const ROW_H = (BOARD_H - MARGIN_TOP) / ROW_COUNT

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
}

export function GenreCluster({ genre }: GenreClusterProps) {
  const rowY = BOARD_H / 2 - MARGIN_TOP - genre.row * ROW_H - ROW_H / 2

  const placements = useMemo(() => {
    const sorted = [...genre.bands].sort((a, b) => a.year - b.year)

    // Group bands by year to stagger vertically
    const yearGroups = new Map<number, number>()

    return sorted.map((band, i) => {
      const baseX = yearToX(band.year)
      const seed = band.name.length * 17 + i * 31

      const count = yearGroups.get(band.year) ?? 0
      yearGroups.set(band.year, count + 1)

      const jitterX = (seededRandom(seed) - 0.5) * 0.3
      // Stagger same-year bands vertically
      const staggerY = count * 0.5 * (count % 2 === 0 ? 1 : -1)
      const jitterY = (seededRandom(seed + 1) - 0.5) * 0.15
      const rotation = (seededRandom(seed + 2) - 0.5) * 0.12

      return {
        band,
        position: [
          baseX + jitterX,
          rowY + staggerY + jitterY,
          0.01 + i * 0.002,
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
        position={[labelX, rowY + ROW_H / 2 - 0.3, 0.02]}
        fontSize={0.16}
        color={genre.color}
        anchorX="left"
        anchorY="middle"
        font="/fonts/SpaceMono-Bold.woff"
        outlineWidth={0.006}
        outlineColor="#2a1f14"
        maxWidth={3}
      >
        {genre.name.toUpperCase()}
      </Text>

      {/* Row divider */}
      <mesh position={[0, rowY + ROW_H / 2, -0.02]}>
        <planeGeometry args={[BOARD_W - 1, 0.004]} />
        <meshStandardMaterial color="#5a4520" transparent opacity={0.25} />
      </mesh>

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
  )
}
