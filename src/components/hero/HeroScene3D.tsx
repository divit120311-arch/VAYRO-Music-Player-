import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * The hero's glass, in real 3D (the reference is a render, not a drawing): a great hemisphere of
 * glass and two twisting ribbons. A small shader draws the glass the way the reference shows it:
 * dark face-on, glowing at its rims, iridescent, with warm and cool highlights.
 * The ribbons flow and twist, the dome's surface swells slowly; under the pointer the dome dents
 * (a glowing crease) and the ribbons fold over themselves; a click sends a wave through the glass.
 * The camera drifts a little with the pointer.
 */

/**
 * Glass as the reference shows it: almost invisible face-on, glowing at grazing angles (Fresnel),
 * with iridescent colour sliding across it and two sharp highlights — a warm peach key light and a
 * cool ice light. Additive, so the glass only ever adds light to the dark room.
 */
const VERT = /* glsl */ `
  uniform float uTime; uniform float uWave; uniform float uDent; uniform float uRipple;
  uniform vec3 uPointer; uniform float uPointerOn; uniform float uPulseAge; uniform vec2 uPulseO;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 nW = normalize(mat3(modelMatrix) * normal);
    // idle: slow swells roll across the glass, like liquid settling
    float a1 = sin(w.x * 0.9 + uTime * 0.55) * sin(w.y * 1.1 - uTime * 0.4);
    float a2 = sin(length(w.xy) * 1.6 - uTime * 0.8);
    float disp = uWave * (0.6 * a1 + 0.4 * a2);
    // hover: the glass gives way under the pointer — a soft dent with a raised lip around it
    vec2 dp = w.xy - uPointer.xy;
    float r2 = dot(dp, dp);
    float g = exp(-r2 * 0.95);
    float lip = exp(-pow(sqrt(r2) - 1.5, 2.0) * 1.8);
    float press = uDent * uPointerOn;
    disp += press * (-g + 0.28 * lip);
    // click: a real wave runs out through the surface
    float rr = length(w.xy - uPulseO) - uPulseAge * 5.5;
    float wave = sin(rr * 3.0) * exp(-rr * rr * 1.4) * exp(-uPulseAge * 1.3) * step(0.0, uPulseAge);
    disp += uRipple * wave;
    w.xyz += nW * disp;
    // tilt the normal with the slope of the dent, so its rim catches the light (a glowing crease)
    nW = normalize(nW - vec3(press * 1.9 * g * dp * 1.4, 0.0));
    vec4 mv = viewMatrix * w;
    vN = normalize(mat3(viewMatrix) * nW);
    vV = normalize(-mv.xyz);
    vW = w.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  uniform float uTime; uniform float uPower; uniform float uRim; uniform float uBody; uniform float uSpec; uniform float uIrid;
  uniform vec3 uBase; uniform vec3 uWarm; uniform vec3 uCool;
  uniform vec3 uPointer; uniform float uPointerOn; uniform float uPulseAge; uniform vec2 uPulseO;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;              // both sides of the thin glass
    vec3 v = normalize(vV);
    float facing = abs(dot(n, v));
    float fres = pow(1.0 - facing, uPower);
    // iridescence: hue slides with the viewing angle and across the surface
    float h = fract(fres * 1.4 + vW.x * 0.07 - vW.y * 0.05 + uTime * 0.015);
    vec3 irid = 0.55 + 0.45 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
    vec3 tint = mix(uBase, irid, uIrid);
    // two key lights: warm from the upper right, cool from the left
    vec3 l1 = normalize(vec3(0.55, 0.45, 0.7));
    vec3 l2 = normalize(vec3(-0.75, -0.1, 0.55));
    float s1 = pow(max(dot(n, normalize(l1 + v)), 0.0), 70.0);
    float s2 = pow(max(dot(n, normalize(l2 + v)), 0.0), 45.0);
    vec3 col = tint * (fres * uRim + uBody) + uWarm * s1 * uSpec + uCool * s2 * uSpec * 0.7;
    // the pointer is a light: a soft glow slides across the glass under it, strongest at the rims
    float dp = length(vW.xy - uPointer.xy);
    float glow = exp(-dp * dp * 0.85) * uPointerOn;
    col += vec3(0.94, 0.91, 1.0) * glow * (0.22 + fres * 1.5);
    // a click sends a ring of light out through the glass
    float age = uPulseAge;
    float ring = exp(-pow((length(vW.xy - uPulseO) - age * 5.5) * 1.6, 2.0)) * exp(-age * 1.1) * step(0.0, age);
    col += mix(uBase, vec3(1.0), 0.55) * ring * (0.3 + fres * 1.8);
    gl_FragColor = vec4(col, 1.0);
  }`;

/** shared by every glass object, so the pointer light and the ripples cross them all as one */
const SHARED = {
  uPointer: { value: new THREE.Vector3(0, 0, 0) },
  uPointerOn: { value: 0 },
  uPulseAge: { value: 99 },
  uPulseO: { value: new THREE.Vector2(0, 0) },
};

const glass = (opts: { power: number; rim: number; body: number; spec: number; irid: number; wave?: number; dent?: number; ripple?: number }) =>
  new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: opts.power },
      uRim: { value: opts.rim },
      uBody: { value: opts.body },
      uSpec: { value: opts.spec },
      uIrid: { value: opts.irid },
      uWave: { value: opts.wave ?? 0 },
      uDent: { value: opts.dent ?? 0 },
      uRipple: { value: opts.ripple ?? 0 },
      uBase: { value: new THREE.Color('#c4b8ff') },
      uWarm: { value: new THREE.Color('#ffd2b0') },
      uCool: { value: new THREE.Color('#bfeaff') },
      ...SHARED,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

/** advance the iridescence over time */
function useGlassTime(mat: THREE.ShaderMaterial, still: boolean) {
  useFrame((s) => {
    if (!still) mat.uniforms.uTime.value = s.clock.elapsedTime;
  });
}

/** a twisting strip along a curve: width turns around the curve as it goes, tapering at the ends */
function useRibbon(points: [number, number, number][], width: number, twists: number) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal'), [points]);
  const N = 220;
  const frames = useMemo(() => curve.computeFrenetFrames(N, false), [curve]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }, []);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), d: new THREE.Vector3() }), []);
  /**
   * `time` makes the strip flow (a slow wave travels along it); `fold` (0..1, at `px, py`) folds it
   * over itself under the pointer: extra twist, wider, lifted toward the viewer.
   */
  const build = (phase: number, time = 0, fold = 0, px = 0, py = 0) => {
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      curve.getPointAt(t, tmp.p);
      const taper = Math.pow(Math.sin(t * Math.PI), 0.45);
      // flow
      tmp.p.y += Math.sin(t * 9 - time * 1.1) * 0.1 * taper;
      tmp.p.z += Math.cos(t * 7 - time * 0.9) * 0.18 * taper;
      // fold under the pointer
      const dx = tmp.p.x - px;
      const dy = tmp.p.y - py;
      const g = fold * Math.exp(-(dx * dx + dy * dy) / 2.4);
      tmp.p.z += g * 0.9;
      const ang = phase + t * twists * Math.PI + g * 2.6;
      tmp.d.copy(frames.normals[i]).multiplyScalar(Math.cos(ang)).addScaledVector(frames.binormals[i], Math.sin(ang)).multiplyScalar((width / 2) * taper * (1 + 0.35 * g));
      pos.setXYZ(i * 2, tmp.p.x + tmp.d.x, tmp.p.y + tmp.d.y, tmp.p.z + tmp.d.z);
      pos.setXYZ(i * 2 + 1, tmp.p.x - tmp.d.x, tmp.p.y - tmp.d.y, tmp.p.z - tmp.d.z);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  return { geometry, build };
}

function Ribbon({ points, width, twists, phase, speed, still }: { points: [number, number, number][]; width: number; twists: number; phase: number; speed: number; still: boolean }) {
  const { geometry, build } = useRibbon(points, width, twists);
  const mat = useMemo(() => glass({ power: 1.5, rim: 1.3, body: 0.11, spec: 1.6, irid: 0.34, ripple: 0.4 }), []);
  useGlassTime(mat, still);
  useEffect(() => build(phase), [build, phase]);
  useFrame((s) => {
    // reduced motion: no flowing by itself, but the strip still folds under the pointer
    const T = still ? 0 : s.clock.elapsedTime;
    const P = SHARED.uPointer.value;
    build(phase + Math.sin(T * speed) * 0.35, T, SHARED.uPointerOn.value, P.x, P.y);
  });
  return <mesh geometry={geometry} material={mat} />;
}

function Dome({ still }: { still: boolean }) {
  // a thin shell: dark face-on, bright only at its rim
  const mat = useMemo(() => glass({ power: 4.6, rim: 1.15, body: 0.01, spec: 0, irid: 0.16, wave: 0.06, dent: 0.32, ripple: 0.3 }), []);
  useGlassTime(mat, still);
  return (
    <mesh position={[0, -3.35, -2.2]} material={mat}>
      {/* a hemisphere: the top half of a sphere */}
      <sphereGeometry args={[5.35, 200, 100, 0, Math.PI * 2, 0, Math.PI / 2]} />
    </mesh>
  );
}

/**
 * The pointer as a light on the glass, and clicks as ripples: the pointer is projected onto the
 * plane of the scene each frame (smoothed, so the light glides rather than jumps).
 */
function Interaction({ still }: { still: boolean }) {
  const { camera } = useThree();
  const ndc = useRef({ x: 0, y: 0, inside: false });
  const pulseAt = useRef(-99);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), dir: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  useEffect(() => {
    if (still) return;
    const move = (e: PointerEvent) => {
      ndc.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ndc.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      ndc.current.inside = true;
    };
    const leave = () => (ndc.current.inside = false);
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest?.('aside, [role=menu], [role=dialog]')) return; // panels: not the scene
      move(e);
      pulseAt.current = performance.now() / 1000;
      // the ripple starts where the pointer meets the scene
      tmp.v.set(ndc.current.x, ndc.current.y, 0.5).unproject(camera);
      tmp.dir.copy(tmp.v).sub(camera.position).normalize();
      const t = (0 - camera.position.z) / tmp.dir.z;
      SHARED.uPulseO.value.set(camera.position.x + tmp.dir.x * t, camera.position.y + tmp.dir.y * t);
    };
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('pointerdown', down);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerdown', down);
    };
  }, [still, camera, tmp]);
  useFrame((_, dt) => {
    if (still) return;
    // where the pointer meets the plane z = 0
    tmp.v.set(ndc.current.x, ndc.current.y, 0.5).unproject(camera);
    tmp.dir.copy(tmp.v).sub(camera.position).normalize();
    const t = (0 - camera.position.z) / tmp.dir.z;
    tmp.target.copy(camera.position).addScaledVector(tmp.dir, t);
    const k = 1 - Math.exp(-dt * 7);
    SHARED.uPointer.value.lerp(tmp.target, k);
    SHARED.uPointerOn.value += ((ndc.current.inside ? 1 : 0) - SHARED.uPointerOn.value) * (1 - Math.exp(-dt * 4));
    SHARED.uPulseAge.value = performance.now() / 1000 - pulseAt.current;
  });
  return null;
}

/** the camera leans a little toward the pointer: depth */
function CameraDrift({ still }: { still: boolean }) {
  const { camera } = useThree();
  const target = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (still) return;
    const move = (e: PointerEvent) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [still]);
  useFrame((_, dt) => {
    if (still) return;
    const k = 1 - Math.exp(-dt * 2);
    camera.position.x += (target.current.x * 0.35 - camera.position.x) * k;
    camera.position.y += (-target.current.y * 0.2 - camera.position.y) * k;
    camera.lookAt(0, 0, -1);
  });
  return null;
}

/**
 * `ambient = false` (reduce motion): nothing moves by itself — no flowing, no swells, no camera
 * drift — but the glass still answers the pointer (dent, fold, light, click wave), since that motion
 * is caused by the listener.
 */
export default function HeroScene3D({ ambient = true, dpr = [1, 1.6] }: { ambient?: boolean; dpr?: [number, number] }) {
  const still = !ambient;
  return (
    <Canvas
      dpr={dpr}
      camera={{ position: [0, 0, 10], fov: 35 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
      frameloop="always"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      aria-hidden
    >
      <CameraDrift still={still} />
      <Interaction still={false} />
      <Dome still={still} />
      {/* top-left: sweeps from the left edge up out of the top */}
      <Ribbon points={[[-7.4, 0.2, 0.6], [-5.6, 0.9, 1.2], [-4.4, 2.0, 0.9], [-3.2, 3.0, 0.4], [-2.4, 4.3, -0.2]]} width={2.0} twists={1.6} phase={0.3} speed={0.22} still={still} />
      {/* bottom-right: curls in from the right edge and down out of the bottom */}
      <Ribbon points={[[7.4, 1.3, 0.2], [5.9, 0.6, 1.0], [5.1, -0.9, 1.2], [4.4, -2.3, 0.8], [3.0, -3.6, 0.2], [2.0, -4.6, -0.2]]} width={2.3} twists={1.9} phase={1.9} speed={0.18} still={still} />
    </Canvas>
  );
}
