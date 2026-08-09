"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import styles from "./FinnorHome.module.css";

const NODES = [
  { color: "#1dc7ad", label: "Customer" },
  { color: "#3488ff", label: "Work" },
  { color: "#f19a53", label: "Schedule" },
  { color: "#9d7cff", label: "Inventory" },
  { color: "#f3c84a", label: "Money" },
  { color: "#75c98d", label: "Policy" },
  { color: "#ff6f66", label: "Agents" },
  { color: "#74a5c9", label: "Evidence" },
] as const;

const TARGETS: Array<Array<[number, number, number]>> = [
  [
    [-4.8, 2.5, -1.8], [4.2, 2.8, -2.6], [-4.2, -2.5, -0.5], [4.8, -2.1, -2.2],
    [-0.6, 3.6, -3.4], [0.7, -3.5, -1.8], [-3.2, 0.2, 1.2], [3.1, 0.1, -1.2],
  ],
  [
    [-3.8, 2.1, -1], [3.7, 2.3, -1.4], [-3.5, -2.2, 0], [3.8, -2, -1.1],
    [-0.5, 3.1, -2], [0.6, -3, -0.6], [-2.4, 0, 1.2], [2.5, 0.2, -0.2],
  ],
  [
    [-2.9, 1.75, 0.1], [2.9, 1.75, 0], [-2.8, -1.7, 0.2], [2.8, -1.7, 0],
    [-0.65, 2.7, -0.2], [0.65, -2.65, 0], [-1.85, 0, 0.5], [1.85, 0, 0.25],
  ],
  [
    [-4.2, 1.2, -0.4], [-2.9, 1.2, 0], [-1.55, 1.2, 0.25], [-0.2, 1.2, 0.45],
    [1.2, 1.2, 0.15], [2.65, 1.2, -0.1], [4.1, 1.2, -0.4], [0.4, -2, 0.8],
  ],
  [
    [-3.8, 2.25, -0.6], [-1.25, 2.25, 0.1], [1.25, 2.25, 0.1], [3.8, 2.25, -0.6],
    [-3.8, -2.25, -0.4], [-1.25, -2.25, 0.1], [1.25, -2.25, 0.1], [3.8, -2.25, -0.4],
  ],
  [
    [-3.4, 1.8, -0.8], [-1.15, 1.8, 0], [1.15, 1.8, 0], [3.4, 1.8, -0.8],
    [-3.4, -1.8, -0.8], [-1.15, -1.8, 0], [1.15, -1.8, 0], [3.4, -1.8, -0.8],
  ],
];

const CAMERA_TARGETS: Array<[number, number, number]> = [
  [0, 0, 10.5],
  [-0.5, 0.1, 9.8],
  [0.2, 0, 8.9],
  [0.7, -0.1, 9.7],
  [0, 0, 10.7],
  [0, 0, 9.5],
];

const TARGET_VECTORS = TARGETS.map((target) => target.map((point) => new THREE.Vector3(...point)));
const ORIGIN = new THREE.Vector3(0, 0, 0);

function hash(index: number) {
  const value = Math.sin(index * 19.1987 + 4.711) * 43758.5453;
  return value - Math.floor(value);
}

function fibonacciSphere(count: number, radius: number, spread = 0.14) {
  const positions = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const noisyRadius = radius + (hash(index) - 0.5) * spread;
    positions[index * 3] = Math.cos(theta) * radial * noisyRadius;
    positions[index * 3 + 1] = y * noisyRadius;
    positions[index * 3 + 2] = Math.sin(theta) * radial * noisyRadius;
  }
  return positions;
}

function World({ phase }: { phase: number }) {
  const world = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Group>(null);
  const beams = useRef<THREE.LineSegments>(null);
  const nodeRefs = useRef<Array<THREE.Mesh | null>>([]);
  const packetRefs = useRef<Array<THREE.Mesh | null>>([]);
  const currentNodes = useRef(TARGETS[0].map((point) => new THREE.Vector3(...point)));
  const beamPositions = useMemo(() => new Float32Array(NODES.length * 6), []);
  const innerSphere = useMemo(() => fibonacciSphere(5200, 1.55, 0.2), []);
  const outerSphere = useMemo(() => fibonacciSphere(1800, 2.05, 0.85), []);
  const dust = useMemo(() => {
    const points = new Float32Array(1700 * 3);
    for (let index = 0; index < 1700; index += 1) {
      points[index * 3] = (hash(index * 2.3) - 0.5) * 17;
      points[index * 3 + 1] = (hash(index * 3.7 + 1) - 0.5) * 11;
      points[index * 3 + 2] = (hash(index * 5.1 + 2) - 0.5) * 9;
    }
    return points;
  }, []);
  const { camera, pointer } = useThree();

  useFrame((state, delta) => {
    const targetPhase = Math.min(Math.max(phase, 0), TARGETS.length - 1);
    const ease = 1 - Math.exp(-delta * 3.2);
    const targets = TARGET_VECTORS[targetPhase];

    currentNodes.current.forEach((point, index) => {
      point.lerp(targets[index], ease);
      const mesh = nodeRefs.current[index];
      if (mesh) {
        mesh.position.copy(point);
        const targetScale = targetPhase === 2 || targetPhase === 4 ? 1.12 : 0.9;
        mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, targetScale, ease));
      }
    });

    const anchor = targetPhase === 3 ? currentNodes.current[7] : ORIGIN;
    let cursor = 0;
    currentNodes.current.forEach((point) => {
      beamPositions[cursor++] = anchor.x;
      beamPositions[cursor++] = anchor.y;
      beamPositions[cursor++] = anchor.z;
      beamPositions[cursor++] = point.x;
      beamPositions[cursor++] = point.y;
      beamPositions[cursor++] = point.z;
    });
    const positionAttribute = beams.current?.geometry.getAttribute("position");
    if (positionAttribute) positionAttribute.needsUpdate = true;

    packetRefs.current.forEach((packet, index) => {
      if (!packet) return;
      const nodeIndex = index % NODES.length;
      const endpoint = currentNodes.current[nodeIndex];
      const direction = targetPhase === 0 ? -1 : 1;
      const progress = (state.clock.elapsedTime * (0.18 + (index % 4) * 0.035) + index * 0.17) % 1;
      const value = direction > 0 ? progress : 1 - progress;
      packet.position.lerpVectors(anchor, endpoint, value);
      packet.scale.setScalar(0.52 + Math.sin(progress * Math.PI) * 0.55);
    });

    const [cx, cy, cz] = CAMERA_TARGETS[targetPhase];
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, cx + pointer.x * 0.28, ease * 0.45);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, cy + pointer.y * 0.2, ease * 0.45);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, cz, ease * 0.6);
    camera.lookAt(0, 0, 0);

    if (world.current) {
      world.current.rotation.y += delta * (0.018 + targetPhase * 0.002);
      world.current.rotation.x = THREE.MathUtils.lerp(world.current.rotation.x, pointer.y * -0.035, ease * 0.25);
    }
    if (core.current) {
      core.current.rotation.y += delta * (targetPhase === 1 ? 0.28 : 0.08);
      core.current.rotation.z -= delta * 0.025;
      const targetCoreScale = targetPhase === 0 ? 0.62 : targetPhase === 2 ? 1.12 : targetPhase === 5 ? 0.84 : 0.94;
      core.current.scale.setScalar(THREE.MathUtils.lerp(core.current.scale.x, targetCoreScale, ease));
    }
    if (rings.current) {
      rings.current.rotation.x += delta * 0.055;
      rings.current.rotation.z -= delta * 0.035;
    }
  });

  return (
    <group ref={world}>
      <points rotation={[0.2, 0, 0]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#5e90aa" size={0.018} transparent opacity={0.3} depthWrite={false} />
      </points>

      <group ref={core}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[innerSphere, 3]} />
          </bufferGeometry>
          <pointsMaterial color="#4edbc8" size={0.021} transparent opacity={0.78} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
        <points rotation={[0.7, 0.3, 0.2]}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[outerSphere, 3]} />
          </bufferGeometry>
          <pointsMaterial color="#4f8fff" size={0.016} transparent opacity={0.3} depthWrite={false} />
        </points>
        <mesh>
          <sphereGeometry args={[1.25, 48, 48]} />
          <meshPhysicalMaterial color="#071d28" roughness={0.25} metalness={0.1} transparent opacity={0.86} />
        </mesh>
        <group ref={rings}>
          {[2.05, 2.42, 2.77].map((radius, index) => (
            <mesh key={radius} rotation={[index * 0.6, index * 0.4, index * 0.9]}>
              <torusGeometry args={[radius, index === 1 ? 0.018 : 0.009, 8, 180]} />
              <meshBasicMaterial color={index === 1 ? "#f2a35c" : "#6ccabd"} transparent opacity={index === 1 ? 0.48 : 0.28} />
            </mesh>
          ))}
        </group>
      </group>

      <lineSegments ref={beams}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[beamPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#6a9db2" transparent opacity={phase === 0 ? 0.14 : 0.42} />
      </lineSegments>

      {NODES.map((node, index) => (
        <group key={node.label}>
          <mesh
            ref={(mesh) => {
              nodeRefs.current[index] = mesh;
            }}
            position={TARGETS[0][index]}
          >
            <icosahedronGeometry args={[index === 7 ? 0.32 : 0.24, 1]} />
            <meshStandardMaterial color={node.color} emissive={node.color} emissiveIntensity={0.34} roughness={0.24} metalness={0.25} />
          </mesh>
          {[0, 1, 2].map((packetIndex) => (
            <mesh
              key={packetIndex}
              ref={(mesh) => {
                packetRefs.current[index * 3 + packetIndex] = mesh;
              }}
            >
              <sphereGeometry args={[0.055, 10, 10]} />
              <meshBasicMaterial color={node.color} transparent opacity={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function StaticWorld({ phase }: { phase: number }) {
  return (
    <div className={styles.staticWorld} data-phase={phase} aria-hidden="true">
      <div className={styles.staticCore} />
      {NODES.map((node) => (
        <span key={node.label} style={{ "--node-color": node.color } as CSSProperties} />
      ))}
    </div>
  );
}

export default function CinematicOperationsWorld({ phase }: { phase: number }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const probe = document.createElement("canvas");
    const supported = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(supported && !reduced);
  }, []);

  if (!enabled) return <StaticWorld phase={phase} />;

  return (
    <Canvas
      camera={{ position: CAMERA_TARGETS[0], fov: 42, near: 0.1, far: 60 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
    >
      <fog attach="fog" args={["#071419", 11, 27]} />
      <ambientLight intensity={0.62} />
      <pointLight position={[2, 3, 5]} intensity={18} color="#79d9d0" distance={18} />
      <pointLight position={[-4, -2, 3]} intensity={12} color="#f39a58" distance={16} />
      <World phase={phase} />
    </Canvas>
  );
}
