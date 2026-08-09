"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./FinnorHome.module.css";

const NODE_COUNT = 9;

const PHASES: Array<Array<[number, number, number]>> = [
  [
    [-4.2, 2.3, -0.6],
    [3.7, 2.4, 0.3],
    [-3.5, -2.2, 0.2],
    [4.1, -1.8, -0.4],
    [-0.2, 2.9, -0.8],
    [1.2, -3, 0.4],
    [-1.2, -0.2, 0.7],
    [2.1, 0.1, -0.2],
    [-2.4, 0.9, -0.3],
  ],
  [
    [-2.6, 1.45, 0],
    [2.6, 1.45, 0],
    [-2.6, -1.45, 0],
    [2.6, -1.45, 0],
    [0, 2.15, 0],
    [0, -2.15, 0],
    [0, 0, 0.7],
    [1.4, 0, 0],
    [-1.4, 0, 0],
  ],
  [
    [-3.25, 1.55, 0],
    [-1.65, 1.55, 0],
    [0, 1.55, 0],
    [1.65, 1.55, 0],
    [3.25, 1.55, 0],
    [-2.35, -1.15, 0],
    [-0.8, -1.15, 0.55],
    [0.8, -1.15, 0],
    [2.35, -1.15, 0],
  ],
  [
    [-3.8, 0.8, 0],
    [-2.7, 0.8, 0],
    [-1.6, 0.8, 0],
    [-0.5, 0.8, 0],
    [0.6, 0.8, 0.5],
    [1.7, 0.8, 0],
    [2.8, 0.8, 0],
    [3.8, 0.8, 0],
    [0.6, -1.35, 0],
  ],
  [
    [-3.2, 1.4, 0],
    [-3.2, 0, 0],
    [-3.2, -1.4, 0],
    [-1.05, 1.4, 0],
    [-1.05, 0, 0.5],
    [1.05, 1.4, 0],
    [1.05, 0, 0],
    [3.2, 1.4, 0],
    [3.2, 0, 0],
  ],
  [
    [-3.15, 1.2, 0],
    [-1.05, 1.2, 0],
    [1.05, 1.2, 0],
    [3.15, 1.2, 0],
    [-3.15, -1.2, 0],
    [-1.05, -1.2, 0],
    [1.05, -1.2, 0],
    [3.15, -1.2, 0],
    [0, 0, 0.75],
  ],
];

const PHASE_VECTORS = PHASES.map((phase) =>
  phase.map((point) => new THREE.Vector3(...point)),
);

const NODE_COLORS = [
  "#167a9f",
  "#167a9f",
  "#167a9f",
  "#167a9f",
  "#e27639",
  "#167a9f",
  "#e27639",
  "#167a9f",
  "#55aa74",
];

function Topology({ phase }: { phase: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const nodeRefs = useRef<Array<THREE.Mesh | null>>([]);
  const lineRef = useRef<THREE.LineSegments>(null);
  const current = useRef(PHASE_VECTORS[0].map((point) => point.clone()));
  const target = PHASE_VECTORS[Math.min(Math.max(phase, 0), PHASES.length - 1)];
  const linePositions = useMemo(
    () => new Float32Array((NODE_COUNT - 1) * 2 * 3),
    [],
  );

  useFrame((state, delta) => {
    const eased = 1 - Math.exp(-delta * 4.8);
    for (let index = 0; index < NODE_COUNT; index += 1) {
      current.current[index].lerp(target[index], eased);
      const mesh = nodeRefs.current[index];
      if (mesh) {
        mesh.position.copy(current.current[index]);
        const emphasis = index === 6 || index === 8 ? 1.12 : 1;
        const scale = THREE.MathUtils.lerp(mesh.scale.x, emphasis, eased);
        mesh.scale.setScalar(scale);
      }
    }

    const anchor = phase === 5 ? current.current[8] : current.current[6];
    let cursor = 0;
    for (let index = 0; index < NODE_COUNT; index += 1) {
      if (index === (phase === 5 ? 8 : 6)) continue;
      const point = current.current[index];
      linePositions[cursor++] = anchor.x;
      linePositions[cursor++] = anchor.y;
      linePositions[cursor++] = anchor.z;
      linePositions[cursor++] = point.x;
      linePositions[cursor++] = point.y;
      linePositions[cursor++] = point.z;
    }
    const attribute = lineRef.current?.geometry.getAttribute("position");
    if (attribute) attribute.needsUpdate = true;

    if (groupRef.current) {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        state.pointer.x * 0.05,
        eased * 0.35,
      );
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x,
        state.pointer.y * -0.035,
        eased * 0.35,
      );
    }
  });

  return (
    <group ref={groupRef}>
      <lineSegments ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#8ea3aa" transparent opacity={0.26} />
      </lineSegments>
      {Array.from({ length: NODE_COUNT }, (_, index) => (
        <mesh
          key={index}
          ref={(node) => {
            nodeRefs.current[index] = node;
          }}
          position={PHASES[0][index]}
        >
          <boxGeometry args={[index === 6 || index === 8 ? 0.44 : 0.31, index === 6 || index === 8 ? 0.44 : 0.31, 0.22]} />
          <meshStandardMaterial
            color={NODE_COLORS[index]}
            roughness={0.34}
            metalness={0.12}
          />
        </mesh>
      ))}
    </group>
  );
}

function StaticTopology({ phase }: { phase: number }) {
  return (
    <div className={styles.topologyFallback} aria-hidden="true">
      {PHASES[phase].map(([x, y], index) => (
        <span
          key={index}
          style={{
            left: `${50 + x * 10}%`,
            top: `${50 - y * 14}%`,
            background: NODE_COLORS[index],
          }}
        />
      ))}
    </div>
  );
}

export default function OperationsTopology({ phase }: { phase: number }) {
  const [canRender, setCanRender] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const probe = document.createElement("canvas");
    const hasWebGL = Boolean(
      probe.getContext("webgl2") || probe.getContext("webgl"),
    );
    setCanRender(hasWebGL && !reduced);
  }, []);

  if (!canRender) return <StaticTopology phase={phase} />;

  return (
    <Canvas
      dpr={[1, 1.55]}
      camera={{ position: [0, 0, 8.2], fov: 43 }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={1.4} />
      <directionalLight position={[3, 5, 6]} intensity={2.2} color="#d9f2ff" />
      <directionalLight position={[-4, -2, 3]} intensity={1.1} color="#ffd8bd" />
      <Topology phase={phase} />
    </Canvas>
  );
}
