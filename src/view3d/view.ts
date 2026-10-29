// The 3D view: the plan's solids (build.ts) in three.js, turned with a finger.
// Loaded on demand, so the editor does not carry three.js until it is opened.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Plan } from '../model';
import { DEFAULT_HEIGHT, Kind, Solid, buildSolids } from './build';

const MATERIAL: Record<Kind, THREE.MeshStandardMaterialParameters> = {
  wall: { color: 0xe5e7eb, roughness: 0.9 },
  glass: { color: 0x7dd3fc, transparent: true, opacity: 0.35, roughness: 0.1 },
  floor: { color: 0xb59f80, roughness: 1 },
  stair: { color: 0xd6c4a8, roughness: 0.9 },
  furniture: { color: 0x60a5fa, transparent: true, opacity: 0.8, roughness: 0.8 },
};
const EDGES = new THREE.LineBasicMaterial({ color: 0x3a3f47 });

const el = (id: string) => document.getElementById(id)!;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let content = new THREE.Group();
let running = false;

/** A solid as a mesh: its outline extruded upwards. Plan x, y become x, z; height is y. */
function mesh(s: Solid): THREE.Object3D {
  const shape = new THREE.Shape(s.pts.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const hole of s.holes ?? []) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.y))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: s.z1 - s.z0, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, s.z0, 0);
  const params = { ...MATERIAL[s.kind], side: THREE.DoubleSide };
  if (s.color) params.color = new THREE.Color(s.color);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(params));
  if (s.kind === 'glass' || s.kind === 'floor') return m;
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), EDGES));
  return m;
}

function dispose(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      if (o.material !== EDGES) (o.material as THREE.Material).dispose();
    }
  });
}

function setup(): void {
  const canvas = el('canvas3d') as HTMLCanvasElement;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x14161a);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  scene.add(content);
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the floor
  addEventListener('resize', resize);
}

function resize(): void {
  if (!renderer) return;
  const canvas = renderer.domElement;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / (canvas.clientHeight || 1);
  camera.updateProjectionMatrix();
}

function loop(): void {
  if (!running) return;
  controls.update();
  renderer!.render(scene, camera);
  requestAnimationFrame(loop);
}

/** Rebuilds the view from the plan; `reframe` also puts the camera back over the whole plan. */
export function show3d(plan: Plan, reframe = true): void {
  el('view3d').hidden = false;
  if (!renderer) setup();
  scene.remove(content);
  dispose(content);
  content = new THREE.Group();
  for (const s of buildSolids(plan)) content.add(mesh(s));
  scene.add(content);
  resize();

  if (reframe) {
    const box = new THREE.Box3().setFromObject(content);
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 2) : box.getBoundingSphere(new THREE.Sphere());
    // far enough for the whole plan to fit the narrower side of the screen
    const vfov = (camera.fov * Math.PI) / 180;
    const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect));
    const d = sphere.radius / Math.sin(fov / 2);
    // from the bottom of the plan, looking up it at 60 degrees: the same way round as the editor
    controls.target.copy(sphere.center);
    camera.position.set(sphere.center.x, sphere.center.y + d * Math.sin(Math.PI / 3), sphere.center.z + d * Math.cos(Math.PI / 3));
    controls.update();
  }
  (el('height3d') as HTMLInputElement).value = String(Math.round((plan.height ?? DEFAULT_HEIGHT) * 100));
  if (!running) {
    running = true;
    loop();
  }
}

export function hide3d(): void {
  running = false;
  el('view3d').hidden = true;
}
