import { useMemo } from "react"
import { Line } from "@react-three/drei"
import * as THREE from "three"
import { genres } from "../data/bands"

export function StringConnections() {
  const connections = useMemo(() => {
    const pairs: [number, number][] = [
      [0, 3], // Early Post-Punk <-> No Wave
      [0, 1], // Early Post-Punk <-> Gothic
      [0, 2], // Early Post-Punk <-> Synth
      [1, 4], // Gothic <-> Revival
      [2, 5], // Synth <-> Modern
      [3, 5], // No Wave <-> Modern
      [4, 5], // Revival <-> Modern
    ]

    return pairs.map(([a, b]) => {
      const from = genres[a].position
      const to = genres[b].position
      const mid: [number, number, number] = [
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        -0.05,
      ]
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(from[0], from[1], 0),
        new THREE.Vector3(mid[0], mid[1], mid[2]),
        new THREE.Vector3(to[0], to[1], 0)
      )
      return curve.getPoints(20).map((p) => [p.x, p.y, p.z] as [number, number, number])
    })
  }, [])

  return (
    <group position={[0, 0, -0.05]}>
      {connections.map((points, i) => (
        <Line
          key={i}
          points={points}
          color="#cc3333"
          lineWidth={1}
          transparent
          opacity={0.15}
        />
      ))}
    </group>
  )
}
