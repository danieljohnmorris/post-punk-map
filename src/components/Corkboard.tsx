import { useRef, useMemo } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"

export function Corkboard() {
  const meshRef = useRef<THREE.Mesh>(null!)

  const material = useMemo(() => {
    // Create a canvas texture for cork
    const canvas = document.createElement("canvas")
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext("2d")!

    // Base cork color
    ctx.fillStyle = "#8B6914"
    ctx.fillRect(0, 0, 1024, 1024)

    // Add noise/grain for cork texture
    for (let i = 0; i < 40000; i++) {
      const x = Math.random() * 1024
      const y = Math.random() * 1024
      const size = Math.random() * 3 + 0.5
      const brightness = Math.random() * 60 - 30
      const r = Math.min(255, Math.max(0, 139 + brightness))
      const g = Math.min(255, Math.max(0, 105 + brightness * 0.8))
      const b = Math.min(255, Math.max(0, 20 + brightness * 0.5))
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(x, y, size, size)
    }

    // Add some darker spots
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 1024
      const y = Math.random() * 1024
      const radius = Math.random() * 8 + 2
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(60, 40, 10, ${Math.random() * 0.3})`
      ctx.fill()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(4, 3)

    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.95,
      metalness: 0,
      bumpMap: texture,
      bumpScale: 0.02,
    })
  }, [])

  // Subtle breathing animation
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.z = -0.1 + Math.sin(state.clock.elapsedTime * 0.3) * 0.02
    }
  })

  return (
    <mesh ref={meshRef} position={[0, 0, -0.1]}>
      <planeGeometry args={[36, 24]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
