import { useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { MapControls, Text } from "@react-three/drei"
import { Corkboard } from "./Corkboard"
import { GenreCluster } from "./GenreCluster"
import { Timeline } from "./Timeline"
import { genres } from "../data/bands"
import type { MapControls as MapControlsImpl } from "three/addons/controls/MapControls.js"

function Board() {
  const controlsRef = useRef<MapControlsImpl>(null!)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = () => {
    setIsDragging(true)
    if (controlsRef.current) controlsRef.current.enabled = false
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    if (controlsRef.current) controlsRef.current.enabled = true
  }

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 10]} intensity={0.8} />
      <pointLight position={[-5, 3, 5]} intensity={0.3} color="#ffcc88" />

      <Corkboard />
      <Timeline />

      {genres.map((genre) => (
        <GenreCluster
          key={genre.name}
          genre={genre}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      ))}

      {/* Title */}
      <Text
        position={[0, 12.2, 0.1]}
        fontSize={0.7}
        color="#f5f0e8"
        anchorX="center"
        anchorY="middle"
        font="/fonts/SpaceMono-Bold.woff"
        letterSpacing={0.2}
        outlineWidth={0.02}
        outlineColor="#1a1510"
      >
        POST-PUNK MAP
      </Text>

      <MapControls
        ref={controlsRef}
        enableRotate={false}
        minDistance={3}
        maxDistance={35}
        panSpeed={1.5}
        zoomSpeed={1.2}
        enableDamping
        dampingFactor={0.1}
      />
    </>
  )
}

export function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 1, 24], fov: 50 }}
      style={{ background: "#0f0d0a" }}
      gl={{ antialias: true }}
    >
      <Board />
    </Canvas>
  )
}
