"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";

import styles from "./FinnorHome.module.css";

type WorldVariant = "hero" | "story" | "final";

type IndustrialExecutionWorldProps = {
  phase: number;
  variant?: WorldVariant;
  onCanvasReady?: () => void;
};

const SOURCE_POSITIONS: Array<[number, number, number]> = [
  [-4.35, 2.15, -0.35],
  [-4.55, -0.55, 0.15],
  [4.3, 2.1, -0.15],
  [4.65, 0, 0.35],
  [4.2, -2.1, -0.1],
  [0, 3.45, -0.75],
];

const SOURCE_COLORS = ["#7ccbff", "#1958e8", "#8b76ff", "#39ddff", "#4fdb9d", "#ffb05c"];

const DEEP_BLUE = "#041126";
const PANEL_BLUE = "#0a2447";
const ELECTRIC = "#7ccbff";
const COBALT = "#1958e8";
const AMBER = "#ffb05c";

function Pipe({
  points,
  color,
  active,
  radius = 0.035,
  opacity = 0.52,
}: {
  points: Array<[number, number, number]>;
  color: string;
  active: boolean;
  radius?: number;
  opacity?: number;
}) {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))),
    [points],
  );

  return (
    <mesh>
      <tubeGeometry args={[curve, 32, radius, 6, false]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={active ? 2.4 : 0.16}
        metalness={0.34}
        opacity={active ? opacity : 0.17}
        roughness={0.28}
        transparent
      />
    </mesh>
  );
}

function FlowPacket({
  points,
  color,
  enabled,
  offset,
  speed = 0.18,
}: {
  points: Array<[number, number, number]>;
  color: string;
  enabled: boolean;
  offset: number;
  speed?: number;
}) {
  const packet = useRef<THREE.Mesh>(null);
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))),
    [points],
  );

  useFrame((state) => {
    if (!packet.current) return;
    const progress = (state.clock.elapsedTime * speed + offset) % 1;
    packet.current.position.copy(curve.getPoint(progress));
    const scale = enabled ? 0.8 + Math.sin(progress * Math.PI) * 0.55 : 0;
    packet.current.scale.setScalar(THREE.MathUtils.lerp(packet.current.scale.x, scale, 0.12));
  });

  return (
    <mesh ref={packet}>
      <octahedronGeometry args={[0.09, 0]} />
      <meshBasicMaterial color={color} transparent opacity={0.98} />
    </mesh>
  );
}

function ModuleGlyph({ index, color, active }: { index: number; color: string; active: boolean }) {
  const material = <meshBasicMaterial color={active ? "#effaff" : color} transparent opacity={active ? 0.96 : 0.52} />;

  if (index === 0) {
    return (
      <group>
        <mesh position={[-0.13, 0.07, 0]}>{<sphereGeometry args={[0.09, 16, 16]} />}{material}</mesh>
        <mesh position={[0.13, 0.07, 0]}>{<sphereGeometry args={[0.09, 16, 16]} />}{material}</mesh>
        <mesh position={[0, -0.12, 0]}><capsuleGeometry args={[0.09, 0.18, 5, 10]} />{material}</mesh>
      </group>
    );
  }

  if (index === 1) {
    return (
      <group>
        {[-0.14, 0, 0.14].map((y, row) => (
          <mesh key={y} position={[row === 1 ? 0.04 : -0.03, y, 0]}>
            <boxGeometry args={[row === 1 ? 0.36 : 0.27, 0.055, 0.04]} />{material}
          </mesh>
        ))}
      </group>
    );
  }

  if (index === 2) {
    return (
      <group>
        <mesh><torusGeometry args={[0.19, 0.026, 8, 32]} />{material}</mesh>
        <mesh position={[0.045, 0.055, 0.01]} rotation={[0, 0, -0.55]}><boxGeometry args={[0.035, 0.18, 0.025]} />{material}</mesh>
        <mesh position={[-0.055, -0.03, 0.012]} rotation={[0, 0, 0.88]}><boxGeometry args={[0.035, 0.13, 0.025]} />{material}</mesh>
      </group>
    );
  }

  if (index === 3) {
    return (
      <group>
        {[-0.16, 0, 0.16].map((x, column) => (
          <mesh key={x} position={[x, column === 1 ? -0.03 : 0.06, 0]}>
            <boxGeometry args={[0.13, column === 1 ? 0.26 : 0.18, 0.055]} />{material}
          </mesh>
        ))}
      </group>
    );
  }

  if (index === 4) {
    return (
      <group rotation={[Math.PI / 2, 0, 0]}>
        {[-0.1, 0, 0.1].map((z, coin) => (
          <mesh key={z} position={[coin * 0.055 - 0.055, 0, z]}>
            <cylinderGeometry args={[0.13, 0.13, 0.045, 24]} />{material}
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group rotation={[0, 0, Math.PI / 4]}>
      <mesh><boxGeometry args={[0.27, 0.27, 0.045]} />{material}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[0.09, 0.09, 0.035]} /><meshBasicMaterial color={DEEP_BLUE} /></mesh>
    </group>
  );
}

function SourceModule({ index, phase }: { index: number; phase: number }) {
  const group = useRef<THREE.Group>(null);
  const target = SOURCE_POSITIONS[index];

  useFrame((state, delta) => {
    if (!group.current) return;
    const settle = 1 - Math.exp(-delta * 3.6);
    const gathered = phase >= 2;
    const plan = phase >= 3;
    const x = gathered ? target[0] * 0.82 : target[0];
    const y = gathered ? target[1] * 0.78 : target[1];
    const z = plan ? (index % 2 ? 0.55 : -0.15) : target[2];
    group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, x, settle);
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, y, settle);
    group.current.position.z = THREE.MathUtils.lerp(group.current.position.z, z, settle);
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y,
      (state.pointer.x * 0.12) + (index - 2.5) * 0.025,
      settle * 0.32,
    );
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, state.pointer.y * -0.055, settle * 0.25);
  });

  const color = SOURCE_COLORS[index];

  return (
    <group ref={group} position={target}>
      <mesh>
        <boxGeometry args={[index === 5 ? 1.45 : 1.22, index === 5 ? 0.58 : 0.72, 0.42]} />
        <meshPhysicalMaterial color={PANEL_BLUE} clearcoat={0.72} clearcoatRoughness={0.22} metalness={0.64} roughness={0.24} />
      </mesh>
      <mesh scale={[1.035, 1.05, 1.045]}>
        <boxGeometry args={[index === 5 ? 1.45 : 1.22, index === 5 ? 0.58 : 0.72, 0.42]} />
        <meshBasicMaterial color={color} opacity={phase >= 2 ? 0.34 : 0.13} transparent wireframe />
      </mesh>
      <mesh position={[0, 0, 0.225]}>
        <boxGeometry args={[index === 5 ? 1.19 : 0.94, index === 5 ? 0.32 : 0.42, 0.016]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={phase >= 2 ? 1.9 : 0.28} opacity={phase >= 2 ? 0.24 : 0.11} transparent />
      </mesh>
      <group position={[0, 0, 0.255]}>
        <ModuleGlyph index={index} color={color} active={phase >= 2} />
      </group>
      <mesh position={[-0.44, index === 5 ? 0.2 : 0.28, 0.24]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshBasicMaterial color={phase >= 2 ? "#b7f8ff" : color} />
      </mesh>
    </group>
  );
}

function Valve({ position, color, active }: { position: [number, number, number]; color: string; active: boolean }) {
  const wheel = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (wheel.current && active) wheel.current.rotation.z += delta * 0.7;
  });

  return (
    <group position={position}>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.24, 0.24, 0.22]} />
        <meshStandardMaterial color={PANEL_BLUE} metalness={0.72} roughness={0.24} />
      </mesh>
      <mesh ref={wheel} position={[0, 0, 0.18]}>
        <torusGeometry args={[0.18, 0.025, 7, 24]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.96 : 0.28} />
      </mesh>
    </group>
  );
}

function PhaseRail({ phase }: { phase: number }) {
  return (
    <group position={[0, -1.44, -0.62]}>
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.055, 6.4, 0.055]} />
        <meshBasicMaterial color="#274c76" transparent opacity={0.74} />
      </mesh>
      {Array.from({ length: 7 }, (_, index) => {
        const active = index <= phase;
        return (
          <group key={index} position={[(index - 3) * 1.02, 0.04, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
              <boxGeometry args={[0.22, 0.22, 0.07]} />
              <meshStandardMaterial
                color={active ? (index === 4 ? ELECTRIC : index === 5 ? AMBER : COBALT) : "#183350"}
                emissive={active ? (index === 5 ? AMBER : ELECTRIC) : "#081627"}
                emissiveIntensity={active ? 2.2 : 0.12}
                metalness={0.42}
                roughness={0.28}
              />
            </mesh>
            {active ? (
              <pointLight color={index === 5 ? AMBER : ELECTRIC} distance={1.5} intensity={2.4} position={[0, 0.18, 0.25]} />
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

function TreatmentVessel({ phase }: { phase: number }) {
  const vessel = useRef<THREE.Group>(null);
  const water = useRef<THREE.Mesh>(null);
  const gateLeft = useRef<THREE.Mesh>(null);
  const gateRight = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const ease = 1 - Math.exp(-delta * 3.4);
    if (vessel.current) {
      vessel.current.rotation.y += delta * (phase >= 4 ? 0.095 : 0.035);
      vessel.current.rotation.x = THREE.MathUtils.lerp(vessel.current.rotation.x, state.pointer.y * -0.035, ease * 0.35);
    }
    if (water.current) {
      const target = phase >= 6 ? 2.25 : phase >= 4 ? 1.82 : phase >= 2 ? 1.28 : 0.62;
      water.current.scale.y = THREE.MathUtils.lerp(water.current.scale.y, target, ease);
      water.current.position.y = -1.16 + water.current.scale.y * 0.52;
    }
    const gateY = phase >= 4 ? 0.7 : phase >= 3 ? 0.18 : -1.15;
    if (gateLeft.current) gateLeft.current.position.y = THREE.MathUtils.lerp(gateLeft.current.position.y, gateY, ease);
    if (gateRight.current) gateRight.current.position.y = THREE.MathUtils.lerp(gateRight.current.position.y, gateY, ease);
  });

  return (
    <group ref={vessel}>
      <mesh position={[0, -1.35, 0]}>
        <cylinderGeometry args={[1.42, 1.62, 0.28, 36]} />
        <meshPhysicalMaterial color={DEEP_BLUE} clearcoat={0.65} clearcoatRoughness={0.18} metalness={0.82} roughness={0.16} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[1.22, 1.38, 2.65, 36, 1, true]} />
        <meshPhysicalMaterial
          clearcoat={0.92}
          clearcoatRoughness={0.12}
          color="#174b87"
          metalness={0.16}
          opacity={0.54}
          roughness={0.12}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
      <mesh ref={water} position={[0, -0.82, 0]} scale={[1, 0.62, 1]}>
        <cylinderGeometry args={[1.12, 1.27, 1, 36]} />
        <meshStandardMaterial color={COBALT} emissive={COBALT} emissiveIntensity={1.9} opacity={0.64} transparent />
      </mesh>
      {[-0.68, -0.22, 0.24, 0.7].map((y, index) => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[1.17 - index * 0.025, 1.2 - index * 0.025, 0.06, 36]} />
          <meshStandardMaterial
            color={index % 2 ? "#8b76ff" : ELECTRIC}
            emissive={index % 2 ? "#8b76ff" : ELECTRIC}
            emissiveIntensity={phase >= 2 ? 1.35 : 0.16}
            opacity={phase >= 2 ? 0.58 : 0.18}
            transparent
          />
        </mesh>
      ))}
      <mesh position={[0, 1.36, 0]}>
        <cylinderGeometry args={[1.35, 1.22, 0.28, 36]} />
        <meshPhysicalMaterial color={PANEL_BLUE} clearcoat={0.7} clearcoatRoughness={0.16} metalness={0.8} roughness={0.17} />
      </mesh>
      {[0.88, 1.42, 1.82].map((radius, index) => (
        <mesh key={radius} rotation={[Math.PI / 2, index * 0.6, 0]}>
          <torusGeometry args={[radius, index === 1 ? 0.035 : 0.016, 6, 64]} />
          <meshBasicMaterial color={index === 1 ? ELECTRIC : "#2c5e9b"} transparent opacity={phase >= 2 ? 0.75 : 0.24} />
        </mesh>
      ))}
      <mesh ref={gateLeft} position={[-0.56, -1.15, 1.52]}>
        <boxGeometry args={[0.42, 1.12, 0.14]} />
        <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={phase >= 3 ? 1.6 : 0.1} />
      </mesh>
      <mesh ref={gateRight} position={[0.56, -1.15, 1.52]}>
        <boxGeometry args={[0.42, 1.12, 0.14]} />
        <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={phase >= 3 ? 1.6 : 0.1} />
      </mesh>
      <group position={[1.43, 0.78, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh><cylinderGeometry args={[0.19, 0.19, 0.14, 24]} /><meshStandardMaterial color={PANEL_BLUE} metalness={0.72} roughness={0.2} /></mesh>
        <mesh position={[0, 0.08, 0]}><circleGeometry args={[0.14, 24]} /><meshBasicMaterial color={phase >= 4 ? "#4fdb9d" : ELECTRIC} /></mesh>
      </group>
    </group>
  );
}

const PIPE_PATHS: Array<Array<[number, number, number]>> = [
  [[-4.05, 2.02, 0], [-2.9, 2.25, 0.2], [-2.2, 0.82, 0.38], [-1.18, 0.72, 0.2]],
  [[-4.2, -0.48, 0.25], [-2.95, -0.65, 0.6], [-2.25, -0.35, 0.52], [-1.28, -0.42, 0.28]],
  [[4.02, 2.02, 0.1], [3.05, 2.2, -0.15], [2.28, 0.85, 0.48], [1.18, 0.72, 0.2]],
  [[4.35, 0.04, 0.42], [3.15, 0.15, 0.7], [2.25, 0.1, 0.56], [1.34, 0.05, 0.35]],
  [[3.92, -2.02, -0.02], [3.05, -2.1, 0.2], [2.2, -0.8, 0.5], [1.2, -0.72, 0.24]],
  [[0, 3.2, -0.62], [-0.2, 2.55, 0.22], [0.42, 1.9, 0.65], [0.42, 1.25, 0.35]],
];

function Receipt({ phase, variant }: { phase: number; variant: WorldVariant }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!group.current) return;
    const ease = 1 - Math.exp(-delta * 4);
    const visible = phase >= 6;
    const visibleY = variant === "hero" ? -1.02 : -0.08;
    const visibleZ = variant === "hero" ? 1.82 : 2.6;
    const visibleRotation = variant === "hero" ? -0.24 : -0.08;
    const visibleScale = variant === "hero" ? 0.58 : variant === "final" ? 0.86 : 1;
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, visible ? visibleY : -3.4, ease);
    group.current.position.z = THREE.MathUtils.lerp(group.current.position.z, visible ? visibleZ : 1.2, ease);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, visible ? visibleRotation : -0.7, ease);
    group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, visible ? visibleScale : 0.55, ease));
  });

  return (
    <group ref={group} position={[0, -3.4, 1.2]} rotation={[-0.7, 0, 0]}>
      <mesh>
        <boxGeometry args={[4.7, 2.5, 0.16]} />
        <meshStandardMaterial color="#edf7ff" metalness={0.14} roughness={0.28} />
      </mesh>
      <mesh position={[-1.55, 0.72, 0.1]}><boxGeometry args={[1.1, 0.12, 0.02]} /><meshBasicMaterial color="#1267ff" /></mesh>
      {[0.3, -0.1, -0.5].map((y, index) => (
        <mesh key={y} position={[0.15, y, 0.1]}>
          <boxGeometry args={[index === 2 ? 3.5 : 3.8, 0.065, 0.02]} />
          <meshBasicMaterial color={index === 2 ? "#79e6ba" : "#7a95ba"} />
        </mesh>
      ))}
      <mesh position={[1.72, 0.76, 0.11]}>
        <circleGeometry args={[0.25, 32]} />
        <meshBasicMaterial color="#36d399" />
      </mesh>
    </group>
  );
}

function IndustrialScene({ phase, variant }: { phase: number; variant: WorldVariant }) {
  const root = useRef<THREE.Group>(null);
  const bypass = phase === 5;
  const { camera, pointer } = useThree();

  useFrame((state, delta) => {
    const ease = 1 - Math.exp(-delta * 2.8);
    const targetZ = variant === "hero" ? 10.5 : variant === "final" ? 9.2 : 10.9 - Math.min(phase, 4) * 0.25;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, pointer.x * (variant === "hero" ? 0.42 : 0.2), ease * 0.5);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, pointer.y * 0.24 + (phase >= 6 ? 0.7 : 0), ease * 0.46);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, ease * 0.55);
    camera.lookAt(0, phase >= 6 ? -0.1 : 0, 0);
    if (root.current) {
      root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, pointer.x * 0.045, ease * 0.28);
      root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, pointer.y * -0.025, ease * 0.24);
    }
  });

  return (
    <group ref={root} scale={variant === "hero" ? 0.92 : variant === "final" ? 0.86 : 1}>
      <TreatmentVessel phase={phase} />
      <PhaseRail phase={phase} />
      {SOURCE_POSITIONS.map((_, index) => <SourceModule key={index} index={index} phase={phase} />)}
      {PIPE_PATHS.map((points, index) => (
        <group key={index}>
          <Pipe points={points} color={bypass && index === 4 ? "#ff5f69" : SOURCE_COLORS[index]} active={phase >= 2 && (!bypass || index !== 4)} />
          <Valve position={points[points.length - 2]} color={SOURCE_COLORS[index]} active={phase >= 3 && (!bypass || index !== 4)} />
          {[0.02, 0.35, 0.68].map((offset) => (
            <FlowPacket
              key={offset}
              points={points}
              color={bypass && index === 4 ? "#ff5f69" : SOURCE_COLORS[index]}
              enabled={phase >= 2 && (!bypass || index !== 4)}
              offset={offset + index * 0.07}
              speed={0.13 + index * 0.008}
            />
          ))}
        </group>
      ))}
      {bypass ? (
        <group>
          <Pipe
            points={[[4.1, -2.05, 0], [2.9, -2.65, 1.1], [0.8, -2.8, 1.2], [-0.4, -1.25, 0.5]]}
            color={AMBER}
            active
            radius={0.048}
            opacity={0.88}
          />
          {[0.1, 0.45, 0.8].map((offset) => (
            <FlowPacket
              key={offset}
              points={[[4.1, -2.05, 0], [2.9, -2.65, 1.1], [0.8, -2.8, 1.2], [-0.4, -1.25, 0.5]]}
              color={AMBER}
              enabled
              offset={offset}
              speed={0.16}
            />
          ))}
        </group>
      ) : null}
      <Receipt phase={phase} variant={variant} />
      <mesh position={[0, -1.62, -1.25]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[13, 9, 1, 1]} />
        <meshStandardMaterial color={DEEP_BLUE} opacity={0.72} roughness={0.62} transparent />
      </mesh>
      <gridHelper args={[13, 26, "#265a9a", "#102b50"]} position={[0, -1.6, -1.2]} />
    </group>
  );
}

function StaticIndustrialWorld({ phase }: { phase: number }) {
  return (
    <div className={styles.staticIndustrial} data-phase={phase} aria-hidden="true">
      <div className={styles.staticVessel}><i /><i /><i /></div>
      {SOURCE_POSITIONS.map((_, index) => <span key={index} style={{ "--module-color": SOURCE_COLORS[index] } as CSSProperties} />)}
      <div className={styles.staticPipes} />
    </div>
  );
}

export default function IndustrialExecutionWorld({ phase, variant = "story", onCanvasReady }: IndustrialExecutionWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [inView, setInView] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !("IntersectionObserver" in window)) {
      setMounted(true);
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        setInView(visible);
        if (visible) setMounted(true);
      },
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.worldMount}
      data-world-phase={phase}
      data-world-variant={variant}
      data-world-ready={canvasReady}
      aria-hidden="true"
    >
      {mounted ? (
        <Canvas
          camera={{ position: [0, 0, variant === "hero" ? 10.5 : 10.9], fov: variant === "hero" ? 46 : 43, near: 0.1, far: 50 }}
          dpr={[1, 1.35]}
          frameloop={inView ? "always" : "never"}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          onCreated={() => {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                setCanvasReady(true);
                onCanvasReady?.();
              });
            });
          }}
          style={{ position: "absolute", inset: 0, opacity: canvasReady ? 1 : 0, transition: "opacity 480ms ease" }}
        >
          <fog attach="fog" args={[DEEP_BLUE, 11.5, 24]} />
          <ambientLight intensity={1.05} />
          <directionalLight color="#d9f2ff" intensity={3.2} position={[4, 7, 8]} />
          <pointLight color={COBALT} distance={16} intensity={34} position={[-2.5, 1.8, 5]} />
          <pointLight color={ELECTRIC} distance={15} intensity={25} position={[3.4, -0.6, 4]} />
          <pointLight color={AMBER} distance={10} intensity={14} position={[0, 3.8, 3]} />
          <IndustrialScene phase={phase} variant={variant} />
        </Canvas>
      ) : null}
    </div>
  );
}
