import { Text } from "@react-three/drei"
import { yearToX } from "./GenreCluster"
import { MIN_YEAR, MAX_YEAR } from "../data/bands"

const BOARD_H = 22
const TICK_Y = BOARD_H / 2 - 1.2

export function Timeline() {
  // Major ticks every 5 years, minor every year
  const majorYears: number[] = []
  const minorYears: number[] = []

  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) {
    if (y % 5 === 0) {
      majorYears.push(y)
    } else {
      minorYears.push(y)
    }
  }

  return (
    <group>
      {/* Axis line */}
      <mesh position={[0, TICK_Y, 0.01]}>
        <planeGeometry args={[30, 0.008]} />
        <meshStandardMaterial color="#c0b090" transparent opacity={0.5} />
      </mesh>

      {/* Major year labels */}
      {majorYears.map((year) => {
        const x = yearToX(year)
        return (
          <group key={year}>
            <Text
              position={[x, TICK_Y + 0.35, 0.02]}
              fontSize={0.2}
              color="#d4c4a0"
              anchorX="center"
              anchorY="middle"
              font="/fonts/SpaceMono-Bold.woff"
            >
              {String(year)}
            </Text>
            {/* Tick mark */}
            <mesh position={[x, TICK_Y - 0.15, 0.01]}>
              <planeGeometry args={[0.008, 0.3]} />
              <meshStandardMaterial color="#c0b090" transparent opacity={0.4} />
            </mesh>
          </group>
        )
      })}

      {/* Minor tick marks */}
      {minorYears.map((year) => {
        const x = yearToX(year)
        return (
          <mesh key={year} position={[x, TICK_Y - 0.08, 0.01]}>
            <planeGeometry args={[0.004, 0.15]} />
            <meshStandardMaterial color="#c0b090" transparent opacity={0.2} />
          </mesh>
        )
      })}
    </group>
  )
}
