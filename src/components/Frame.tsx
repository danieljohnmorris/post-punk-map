import { useMemo } from "react"
import * as THREE from "three"

const BOARD_W = 36
const BOARD_H = 24
const FRAME_DEPTH = 0.15
const FRAME_WIDTH = 0.4

export function Frame() {
  const woodMaterial = useMemo(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext("2d")!

    // Dark wood base
    ctx.fillStyle = "#3d2b1f"
    ctx.fillRect(0, 0, 256, 256)

    // Wood grain
    for (let y = 0; y < 256; y++) {
      const brightness = Math.sin(y * 0.3) * 8 + Math.sin(y * 0.7) * 4
      const r = Math.min(255, Math.max(0, 61 + brightness))
      const g = Math.min(255, Math.max(0, 43 + brightness * 0.7))
      const b = Math.min(255, Math.max(0, 31 + brightness * 0.5))
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(0, y, 256, 1)
    }

    const texture = new THREE.CanvasTexture(canvas)
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0.1,
    })
  }, [])

  const halfW = BOARD_W / 2 + FRAME_WIDTH / 2
  const halfH = BOARD_H / 2 + FRAME_WIDTH / 2

  return (
    <group position={[0, 0, 0]}>
      {/* Top */}
      <mesh position={[0, halfH, FRAME_DEPTH / 2]}>
        <boxGeometry args={[BOARD_W + FRAME_WIDTH * 2, FRAME_WIDTH, FRAME_DEPTH]} />
        <primitive object={woodMaterial} attach="material" />
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -halfH, FRAME_DEPTH / 2]}>
        <boxGeometry args={[BOARD_W + FRAME_WIDTH * 2, FRAME_WIDTH, FRAME_DEPTH]} />
        <primitive object={woodMaterial} attach="material" />
      </mesh>
      {/* Left */}
      <mesh position={[-halfW, 0, FRAME_DEPTH / 2]}>
        <boxGeometry args={[FRAME_WIDTH, BOARD_H, FRAME_DEPTH]} />
        <primitive object={woodMaterial} attach="material" />
      </mesh>
      {/* Right */}
      <mesh position={[halfW, 0, FRAME_DEPTH / 2]}>
        <boxGeometry args={[FRAME_WIDTH, BOARD_H, FRAME_DEPTH]} />
        <primitive object={woodMaterial} attach="material" />
      </mesh>
    </group>
  )
}
