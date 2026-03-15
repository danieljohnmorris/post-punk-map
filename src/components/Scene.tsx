import { Canvas } from "@react-three/fiber"
import { MapControls, Text } from "@react-three/drei"
import { Corkboard } from "./Corkboard"
import { Frame } from "./Frame"
import { GenreCluster } from "./GenreCluster"
import { StringConnections } from "./StringConnections"
import { genres } from "../data/bands"

export function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 1, 24], fov: 50 }}
      style={{ background: "#0f0d0a" }}
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 10]} intensity={0.8} />
      <pointLight position={[-5, 3, 5]} intensity={0.3} color="#ffcc88" />

      <Corkboard />
      <Frame />
      <StringConnections />

      {genres.map((genre) => (
        <GenreCluster key={genre.name} genre={genre} />
      ))}

      {/* Title - pinned to top of corkboard */}
      <Text
        position={[0, 11, 0.1]}
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

      <Text
        position={[0, 10.2, 0.1]}
        fontSize={0.2}
        color="#c0b090"
        anchorX="center"
        anchorY="middle"
        font="/fonts/SpaceMono-Regular.woff"
      >
        {"1976 \u2014 present"}
      </Text>

      <MapControls
        enableRotate={false}
        minDistance={5}
        maxDistance={30}
        panSpeed={1.5}
      />
    </Canvas>
  )
}
