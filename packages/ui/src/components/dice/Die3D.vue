<script setup lang="ts">
/**
 * Die3D - Three.js polyhedral die component
 *
 * Renders realistic 3D dice using Three.js with chamfered geometry.
 * Supports d4, d6, d8, d10, d12, and d20 with smooth roll animations.
 */
import { ref, computed, watch, onMounted, onUnmounted, inject, type PropType } from 'vue';
import * as THREE from 'three';
import {
  pendingRenders,
  isRenderingGlobally,
  setIsRenderingGlobally,
  getNextComponentId,
  DIE_ANIMATION_CONTEXT_KEY,
  createDieAnimationContext,
  type QueuedRender,
  type DieAnimationContext,
} from './die3d-state';

// Inject animation context from parent UI, or create a local fallback
// Each UI tree should provide its own context so dice animate independently in each UI
const injectedContext = inject<DieAnimationContext | null>(DIE_ANIMATION_CONTEXT_KEY, null);
const localContext = createDieAnimationContext();
const animationContext = injectedContext ?? localContext;
const animatedRollCounts = animationContext.animatedRollCounts;

type DieSides = 4 | 6 | 8 | 10 | 12 | 20;

const props = withDefaults(defineProps<{
  /** Number of sides (4, 6, 8, 10, 12, or 20) */
  sides: DieSides;
  /** Current face value */
  value: number;
  /** Die color (CSS color string) */
  color?: string;
  /** Size in pixels */
  size?: number;
  /** Roll counter - animate when this changes */
  rollCount?: number;
  /** Unique die ID for tracking animation state globally */
  dieId?: number | string;
  /** Custom face labels (optional) */
  faceLabels?: string[];
  /** Custom face images (optional) */
  faceImages?: string[];
  /** For d10: use 0-9 instead of 1-10 */
  zeroIndexed?: boolean;
}>(), {
  size: 60,
  rollCount: 0,
  zeroIndexed: false,
});

const emit = defineEmits<{
  click: [];
}>();

// Default colors for each die type
const defaultColors: Record<DieSides, string> = {
  4: '#4CAF50',   // Green
  6: '#2196F3',   // Blue
  8: '#9C27B0',   // Purple
  10: '#FF9800',  // Orange
  12: '#E91E63',  // Pink
  20: '#F44336',  // Red
};

const dieColor = computed(() => props.color || defaultColors[props.sides]);

// Per-face Z-rotation corrections (calibrated empirically)
const faceZCorrections: Record<string, number[]> = {
  d4: [-0.7850, -3.9266, -6.5446, -3.4030],
  d6: [1.5710, -10.9958, -3.1416, -1.5708, -3.1416, -3.1432],
  d8: [-0.1745, -0.6981, -26.8781, 0.8727, -3.3161, -3.8397, -4.8869, -2.2689],
  d10: [-49.3052, -0.2614, -2.7921, 2.2693, -0.2614, -2.7921, 11.0832, -5.3229, 8.4653, 4.7128],
  d12: [14.7480, -0.0873, -0.1745, -1.9199, -3.4907, -3.1416, -1.9199, -0.9599, -1.2217, -0.6981, 1.2217, -4.1015],
  d20: [-2.3562, -3.0543, -4.1015, 0.0000, -1.5708, -1.5708, -1.4835, -1.3090, -0.4363, -1.8326, 0.6981, 0.0873, -0.9599, -3.1416, -4.7997, -4.6251, -4.7124, -11.2574, -3.5779, -4.4506],
};

// Scale factors for consistent visual sizing
const scaleFactors: Record<DieSides, number> = {
  4: 1.3,
  6: 1.0,
  8: 1.1,
  10: 1.0,
  12: 0.9,
  20: 0.9,
};

const containerRef = ref<HTMLDivElement | null>(null);
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let mesh: THREE.Mesh | null = null;
let materials: THREE.MeshPhongMaterial[] = [];
let faceNormals: THREE.Vector3[] = [];
let animationId: number | null = null;

// Animation state
let isAnimating = false;
let animationStartTime = 0;
const animationDuration = 800;
let startRotation = new THREE.Euler();
let targetRotation = new THREE.Euler();
let rollSpins = { x: 0, y: 0, z: 0 };

// Snapshot state - to reduce WebGL context usage
const snapshotDataUrl = ref<string | null>(null);
const isShowingSnapshot = ref(false);
let webglDisposed = false;

// Component instance ID for tracking queued renders (from shared module)
const myComponentId = getNextComponentId();

function queueRender(renderFn: () => void, componentId: number): QueuedRender {
  const queuedRender: QueuedRender = {
    fn: renderFn,
    cancelled: false,
    componentId,
  };
  pendingRenders.push(queuedRender);
  processRenderQueue();
  return queuedRender;
}

function cancelComponentRenders(componentId: number) {
  for (const render of pendingRenders) {
    if (render.componentId === componentId) {
      render.cancelled = true;
    }
  }
}

function processRenderQueue() {
  if (isRenderingGlobally || pendingRenders.length === 0) return;

  // Skip cancelled renders
  while (pendingRenders.length > 0 && pendingRenders[0].cancelled) {
    pendingRenders.shift();
  }

  if (pendingRenders.length === 0) return;

  setIsRenderingGlobally(true);
  const queuedRender = pendingRenders.shift()!;

  // Execute the render function if not cancelled
  if (!queuedRender.cancelled) {
    queuedRender.fn();
  }

  // Wait for render to complete and context to be disposed by browser GC
  setTimeout(() => {
    setIsRenderingGlobally(false);
    processRenderQueue();
  }, 300);
}

/**
 * Check if this die needs animation (new roll that hasn't been animated yet)
 */
function shouldAnimateDie(dieId: string | number | undefined, rollCount: number): boolean {
  if (!dieId || rollCount <= 0) return false;
  const lastAnimated = animatedRollCounts.get(dieId) ?? 0;
  const needsAnimation = rollCount > lastAnimated;
  return needsAnimation;
}

/**
 * Mark a die's rollCount as animated
 */
function markAnimated(dieId: string | number | undefined, rollCount: number) {
  if (dieId) {
    animatedRollCounts.set(dieId, rollCount);
  }
}

// Geometry creation functions
function calcTextureSize(approx: number): number {
  return Math.pow(2, Math.floor(Math.log(approx) / Math.log(2)));
}

function chamferGeom(vectors: THREE.Vector3[], faces: number[][], chamfer: number) {
  const chamferVectors: THREE.Vector3[] = [];
  const chamferFaces: number[][] = [];
  const cornerFaces: number[][] = vectors.map(() => []);

  for (let i = 0; i < faces.length; i++) {
    const ii = faces[i];
    const fl = ii.length - 1;
    const centerPoint = new THREE.Vector3();
    const face: number[] = [];

    for (let j = 0; j < fl; j++) {
      const vv = vectors[ii[j]].clone();
      centerPoint.add(vv);
      cornerFaces[ii[j]].push(chamferVectors.length);
      face.push(chamferVectors.length);
      chamferVectors.push(vv);
    }

    centerPoint.divideScalar(fl);

    for (let j = 0; j < fl; j++) {
      const vv = chamferVectors[face[j]];
      vv.sub(centerPoint).multiplyScalar(chamfer).add(centerPoint);
    }

    face.push(ii[fl]);
    chamferFaces.push(face);
  }

  for (let i = 0; i < faces.length - 1; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const pairs: [number, number][] = [];
      let lastm = -1;

      for (let m = 0; m < faces[i].length - 1; m++) {
        const n = faces[j].indexOf(faces[i][m]);
        if (n >= 0 && n < faces[j].length - 1) {
          if (lastm >= 0 && m !== lastm + 1) {
            pairs.unshift([i, m], [j, n]);
          } else {
            pairs.push([i, m], [j, n]);
          }
          lastm = m;
        }
      }

      if (pairs.length !== 4) continue;

      chamferFaces.push([
        chamferFaces[pairs[0][0]][pairs[0][1]],
        chamferFaces[pairs[1][0]][pairs[1][1]],
        chamferFaces[pairs[3][0]][pairs[3][1]],
        chamferFaces[pairs[2][0]][pairs[2][1]],
        -1
      ]);
    }
  }

  for (let i = 0; i < cornerFaces.length; i++) {
    const cf = cornerFaces[i];
    const face = [cf[0]];
    let count = cf.length - 1;

    while (count) {
      for (let m = faces.length; m < chamferFaces.length; m++) {
        const index = chamferFaces[m].indexOf(face[face.length - 1]);
        if (index >= 0 && index < 4) {
          let nextIndex = index - 1;
          if (nextIndex === -1) nextIndex = 3;
          const nextVertex = chamferFaces[m][nextIndex];
          if (cf.indexOf(nextVertex) >= 0) {
            face.push(nextVertex);
            break;
          }
        }
      }
      count--;
    }

    face.push(-1);
    chamferFaces.push(face);
  }

  return { vectors: chamferVectors, faces: chamferFaces };
}

function makeGeom(vertices: THREE.Vector3[], faces: number[][], radius: number, tab: number, af: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  const normals: (THREE.Vector3 | null)[] = [];

  const scaledVerts = vertices.map(v => v.clone().multiplyScalar(radius));

  let vertexIndex = 0;

  for (let i = 0; i < faces.length; i++) {
    const ii = faces[i];
    const fl = ii.length - 1;
    const faceLabel = ii[fl];
    const aa = (Math.PI * 2) / fl;

    if (fl >= 3 && faceLabel > 0) {
      const v0 = scaledVerts[ii[0]];
      const v1 = scaledVerts[ii[1]];
      const v2 = scaledVerts[ii[2]];

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);

      const normal = new THREE.Vector3()
        .crossVectors(edge1, edge2)
        .normalize();

      normals[faceLabel - 1] = normal;
    }

    const groupStart = vertexIndex;

    for (let j = 0; j < fl - 2; j++) {
      const indices = [0, j + 1, j + 2];

      for (const idx of indices) {
        const v = scaledVerts[ii[idx]];
        positions.push(v.x, v.y, v.z);

        const u = (Math.cos(aa * idx + af) + 1 + tab) / 2 / (1 + tab);
        const vCoord = (Math.sin(aa * idx + af) + 1 + tab) / 2 / (1 + tab);
        uvs.push(u, vCoord);

        vertexIndex++;
      }
    }

    groups.push({
      start: groupStart,
      count: vertexIndex - groupStart,
      materialIndex: faceLabel > 0 ? faceLabel : 0
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  geometry.clearGroups();
  for (const group of groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }

  return { geometry, faceNormals: normals };
}

function createGeom(vertices: number[][], faces: number[][], radius: number, tab: number, af: number, chamfer: number) {
  const vectors = vertices.map(v => new THREE.Vector3().fromArray(v).normalize());

  const origFaceInfo: { normal: THREE.Vector3 }[] = [];
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const faceLabel = f[f.length - 1];
    if (faceLabel <= 0) continue;

    const fl = f.length - 1;
    const v0 = vectors[f[0]].clone().multiplyScalar(radius);
    const v1 = vectors[f[1]].clone().multiplyScalar(radius);
    const v2 = vectors[f[2]].clone().multiplyScalar(radius);

    const normal = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(v1, v0),
        new THREE.Vector3().subVectors(v2, v0)
      ).normalize();

    origFaceInfo[faceLabel - 1] = { normal };
  }

  const cg = chamferGeom(vectors, faces, chamfer);
  const result = makeGeom(cg.vectors, cg.faces, radius, tab, af);

  result.faceNormals = origFaceInfo.map(info => info ? info.normal : null);

  return result;
}

// Die geometry creators
function createD4Geometry(radius: number) {
  const vertices = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];
  const faces = [[1, 0, 2, 1], [0, 1, 3, 2], [0, 3, 2, 3], [1, 2, 3, 4]];
  return createGeom(vertices, faces, radius, -0.1, Math.PI * 7 / 6, 0.96);
}

function createD6Geometry(radius: number) {
  const vertices = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ];
  const faces = [
    [0, 3, 2, 1, 1], [1, 2, 6, 5, 2], [0, 1, 5, 4, 3],
    [3, 7, 6, 2, 4], [0, 4, 7, 3, 5], [4, 5, 6, 7, 6]
  ];
  return createGeom(vertices, faces, radius, 0.1, Math.PI / 4, 0.96);
}

function createD8Geometry(radius: number) {
  const vertices = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const faces = [
    [0, 2, 4, 1], [0, 4, 3, 2], [0, 3, 5, 3], [0, 5, 2, 4],
    [1, 3, 4, 5], [1, 4, 2, 6], [1, 2, 5, 7], [1, 5, 3, 8]
  ];
  return createGeom(vertices, faces, radius, 0, -Math.PI / 4 / 2, 0.965);
}

function createD10Geometry(radius: number) {
  const a = Math.PI * 2 / 10;
  const h = 0.105;
  const vertices: number[][] = [];

  for (let i = 0, b = 0; i < 10; i++, b += a) {
    vertices.push([Math.cos(b), Math.sin(b), h * (i % 2 ? 1 : -1)]);
  }
  vertices.push([0, 0, -1]);
  vertices.push([0, 0, 1]);

  const faces = [
    [5, 7, 11, 1], [4, 2, 10, 2], [1, 3, 11, 3], [0, 8, 10, 4], [7, 9, 11, 5],
    [8, 6, 10, 6], [9, 1, 11, 7], [2, 0, 10, 8], [3, 5, 11, 9], [6, 4, 10, 10],
    [1, 0, 2, -1], [1, 2, 3, -1], [3, 2, 4, -1], [3, 4, 5, -1], [5, 4, 6, -1],
    [5, 6, 7, -1], [7, 6, 8, -1], [7, 8, 9, -1], [9, 8, 0, -1], [9, 0, 1, -1]
  ];

  return createGeom(vertices, faces, radius, 0, Math.PI * 6 / 5, 0.945);
}

function createD12Geometry(radius: number) {
  const p = (1 + Math.sqrt(5)) / 2;
  const q = 1 / p;
  const vertices = [
    [0, q, p], [0, q, -p], [0, -q, p], [0, -q, -p],
    [p, 0, q], [p, 0, -q], [-p, 0, q], [-p, 0, -q],
    [q, p, 0], [q, -p, 0], [-q, p, 0], [-q, -p, 0],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
  ];
  const faces = [
    [2, 14, 4, 12, 0, 1], [15, 9, 11, 19, 3, 2], [16, 10, 17, 7, 6, 3],
    [6, 7, 19, 11, 18, 4], [6, 18, 2, 0, 16, 5], [18, 11, 9, 14, 2, 6],
    [1, 17, 10, 8, 13, 7], [1, 13, 5, 15, 3, 8], [13, 8, 12, 4, 5, 9],
    [5, 4, 14, 9, 15, 10], [0, 12, 8, 10, 16, 11], [3, 19, 7, 17, 1, 12]
  ];
  return createGeom(vertices, faces, radius, 0.2, -Math.PI / 4 / 2, 0.968);
}

function createD20Geometry(radius: number) {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ];
  const faces = [
    [0, 11, 5, 1], [0, 5, 1, 2], [0, 1, 7, 3], [0, 7, 10, 4], [0, 10, 11, 5],
    [1, 5, 9, 6], [5, 11, 4, 7], [11, 10, 2, 8], [10, 7, 6, 9], [7, 1, 8, 10],
    [3, 9, 4, 11], [3, 4, 2, 12], [3, 2, 6, 13], [3, 6, 8, 14], [3, 8, 9, 15],
    [4, 9, 5, 16], [2, 4, 11, 17], [6, 2, 10, 18], [8, 6, 7, 19], [9, 8, 1, 20]
  ];
  return createGeom(vertices, faces, radius, -0.2, -Math.PI / 4 / 2, 0.955);
}

function createFaceTexture(text: string, size: number, textColor: string, backColor: string, margin: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const ts = calcTextureSize(size + size * 2 * margin) * 2;

  canvas.width = ts;
  canvas.height = ts;

  ctx.fillStyle = backColor;
  ctx.fillRect(0, 0, ts, ts);

  const gradient = ctx.createRadialGradient(ts/2, ts/2, 0, ts/2, ts/2, ts/2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ts, ts);

  ctx.fillStyle = textColor;
  ctx.font = `bold ${ts / (1 + 2 * margin)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.fillText(text, ts / 2, ts / 2);

  if (text === '6' || text === '9') {
    ctx.fillText('.', ts / 2 + ts / 4, ts / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createImageTexture(imageUrl: string, backColor: string): Promise<THREE.CanvasTexture> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 256;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (size - w) / 2;
      const y = (size - h) / 2;
      ctx.drawImage(img, x, y, w, h);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      resolve(texture);
    };
    img.onerror = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = backColor;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 80px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 128, 128);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      resolve(texture);
    };
    img.src = imageUrl;
  });
}

function createDieMaterials(numFaces: number, color: string, textColor: string = '#ffffff'): THREE.MeshPhongMaterial[] {
  const mats: THREE.MeshPhongMaterial[] = [];
  const size = 100;
  const margin = 1;

  mats.push(new THREE.MeshPhongMaterial({
    color: new THREE.Color(color).multiplyScalar(0.8),
    flatShading: true,
    shininess: 40,
  }));

  for (let i = 1; i <= numFaces; i++) {
    const texture = createFaceTexture(String(i), size, textColor, color, margin);
    mats.push(new THREE.MeshPhongMaterial({
      map: texture,
      flatShading: true,
      shininess: 40,
    }));
  }

  return mats;
}

function setFaceRotation(faceNumber: number): THREE.Euler {
  const dieType = `d${props.sides}`;
  const normal = faceNormals[faceNumber - 1];

  if (!normal) {
    console.warn(`No normal for face ${faceNumber}`);
    return new THREE.Euler(0, 0, 0);
  }

  const targetDir = new THREE.Vector3(0, 0, 1);
  const q1 = new THREE.Quaternion();
  q1.setFromUnitVectors(normal.clone().normalize(), targetDir);

  const corrections = faceZCorrections[dieType];
  const zCorrection = corrections ? (corrections[faceNumber - 1] || 0) : 0;

  const q2 = new THREE.Quaternion();
  q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), zCorrection);

  const finalQ = q2.multiply(q1);

  const euler = new THREE.Euler();
  euler.setFromQuaternion(finalQ);
  return euler;
}

function initScene() {
  if (!containerRef.value) return;

  // Dispose any existing renderer before creating new one
  // This prevents WebGL context exhaustion
  if (renderer) {
    disposeWebGL();
  }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  camera.position.z = 5;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(props.size, props.size);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  containerRef.value.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambient);

  const front = new THREE.DirectionalLight(0xffffff, 1.0);
  front.position.set(0, 0, 5);
  scene.add(front);

  const top = new THREE.DirectionalLight(0xffffff, 0.8);
  top.position.set(0, 5, 2);
  scene.add(top);

  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-3, -2, 3);
  scene.add(fill);

  const back = new THREE.DirectionalLight(0xffffff, 0.3);
  back.position.set(0, 0, -5);
  scene.add(back);

  createDieMesh();
  animate();
}

function createDieMesh() {
  if (!scene) return;

  // Remove existing mesh
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    materials.forEach(m => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  }

  const radius = 1 * scaleFactors[props.sides];
  let result: { geometry: THREE.BufferGeometry; faceNormals: (THREE.Vector3 | null)[] };

  switch (props.sides) {
    case 4:  result = createD4Geometry(radius); break;
    case 6:  result = createD6Geometry(radius); break;
    case 8:  result = createD8Geometry(radius); break;
    case 10: result = createD10Geometry(radius); break;
    case 12: result = createD12Geometry(radius); break;
    case 20: result = createD20Geometry(radius); break;
    default: result = createD6Geometry(radius);
  }

  faceNormals = result.faceNormals.filter((n): n is THREE.Vector3 => n !== null);
  materials = createDieMaterials(props.sides, dieColor.value);

  mesh = new THREE.Mesh(result.geometry, materials);
  scene.add(mesh);

  // Set initial rotation
  const euler = setFaceRotation(props.value || 1);
  mesh.rotation.copy(euler);
  targetRotation.copy(euler);
}

function animate() {
  animationId = requestAnimationFrame(animate);

  if (!mesh || !renderer || !scene || !camera) return;

  if (isAnimating) {
    const elapsed = Date.now() - animationStartTime;
    const progress = Math.min(elapsed / animationDuration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    mesh.rotation.x = startRotation.x + rollSpins.x * eased;
    mesh.rotation.y = startRotation.y + rollSpins.y * eased;
    mesh.rotation.z = startRotation.z + rollSpins.z * eased;

    if (progress >= 1) {
      isAnimating = false;
      mesh.rotation.copy(targetRotation);
      // Capture snapshot and dispose WebGL after animation completes
      scheduleSnapshotAndDispose();
      return; // Don't try to render after disposing
    }
  }

  renderer.render(scene, camera);
}

/**
 * Capture the current canvas as a data URL snapshot and schedule WebGL disposal.
 * This reduces WebGL context usage - browsers limit active contexts.
 */
function captureSnapshot(): string | null {
  if (!renderer) return null;
  // Render one final frame to ensure the die is at final position
  if (scene && camera) {
    renderer.render(scene, camera);
  }
  return renderer.domElement.toDataURL('image/png');
}

/**
 * Dispose of WebGL resources to free up the context.
 */
function disposeWebGL() {
  if (webglDisposed) return;

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (renderer) {
    renderer.dispose();
    if (containerRef.value && renderer.domElement.parentNode === containerRef.value) {
      containerRef.value.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  if (mesh) {
    mesh.geometry.dispose();
    materials.forEach(m => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
    mesh = null;
  }

  materials = [];
  scene = null;
  camera = null;
  webglDisposed = true;
}

/**
 * Capture snapshot and dispose WebGL synchronously.
 * Synchronous disposal prevents WebGL context exhaustion.
 */
function scheduleSnapshotAndDispose() {
  const snapshot = captureSnapshot();
  if (snapshot) {
    snapshotDataUrl.value = snapshot;
    isShowingSnapshot.value = true;
    disposeWebGL();
  }
}

/**
 * Restore WebGL rendering from snapshot mode.
 * Called when rolling starts again.
 */
function restoreWebGL() {
  if (!webglDisposed) return;

  webglDisposed = false;
  isShowingSnapshot.value = false;
  initScene();
}

/**
 * Regenerate snapshot with a new value without keeping WebGL active.
 * Creates WebGL context, renders, snapshots, then disposes immediately.
 * Queued to avoid creating too many WebGL contexts at once.
 */
function regenerateSnapshot(newValue: number) {
  queueRender(() => {
    // Temporarily restore WebGL
    webglDisposed = false;
    isShowingSnapshot.value = false;
    initScene();

    // Set the new rotation
    if (mesh) {
      const euler = setFaceRotation(newValue);
      targetRotation.copy(euler);
      mesh.rotation.copy(euler);
    }

    // Take snapshot and dispose immediately
    scheduleSnapshotAndDispose();
  }, myComponentId);
}

function startRollAnimation(newValue: number) {
  if (!mesh) return;

  targetRotation = setFaceRotation(newValue);
  startRotation = mesh.rotation.clone();

  const spinsX = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.floor(Math.random() * 2)) * Math.PI * 2;
  const spinsY = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.floor(Math.random() * 2)) * Math.PI * 2;
  const spinsZ = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 2)) * Math.PI * 2;

  rollSpins = {
    x: spinsX + (targetRotation.x - startRotation.x),
    y: spinsY + (targetRotation.y - startRotation.y),
    z: spinsZ + (targetRotation.z - startRotation.z),
  };

  isAnimating = true;
  animationStartTime = Date.now();
}

async function updateTextures() {
  if (!materials.length || webglDisposed) return;

  const color = dieColor.value;

  for (let i = 1; i <= props.sides; i++) {
    if (props.faceImages && props.faceImages[i - 1]) {
      const texture = await createImageTexture(props.faceImages[i - 1], color);
      materials[i].map?.dispose();
      materials[i].map = texture;
      materials[i].needsUpdate = true;
    } else if (props.faceLabels && props.faceLabels[i - 1]) {
      const texture = createFaceTexture(props.faceLabels[i - 1], 100, '#ffffff', color, 1);
      materials[i].map?.dispose();
      materials[i].map = texture;
      materials[i].needsUpdate = true;
    } else {
      const label = props.sides === 10 && props.zeroIndexed ? String(i - 1) : String(i);
      const texture = createFaceTexture(label, 100, '#ffffff', color, 1);
      materials[i].map?.dispose();
      materials[i].map = texture;
      materials[i].needsUpdate = true;
    }
  }

  // Update edge material color
  if (materials[0]) {
    materials[0].color = new THREE.Color(color).multiplyScalar(0.8);
    materials[0].needsUpdate = true;
  }
}

// Watch for rollCount changes - trigger animation for new rolls
watch(() => props.rollCount, (newRollCount) => {
  if (!newRollCount || !props.dieId) return;

  // Check if this is a new roll that needs animation
  if (shouldAnimateDie(props.dieId, newRollCount)) {
    markAnimated(props.dieId, newRollCount);

    // Queue the animation render
    queueRender(() => {
      // Restore WebGL if needed
      if (isShowingSnapshot.value || webglDisposed) {
        webglDisposed = false;
        isShowingSnapshot.value = false;
        initScene();
      }

      // Start animation after a brief delay for scene init
      setTimeout(() => {
        if (mesh) {
          startRollAnimation(props.value);
        }
      }, 50);
    }, myComponentId);
  }
});

// NOTE: We intentionally do NOT watch for value changes.
// Value should only change when roll() is called, which increments rollCount.
// The rollCount watcher handles animation. When animation completes, it snapshots
// with the current (new) value.
// If value changes without rollCount (e.g., flip ability), we need to handle
// that differently - for now, just ignore it and let the component remount.

// Watch for color/texture changes
watch([() => props.color, () => props.faceLabels, () => props.faceImages, () => props.zeroIndexed], () => {
  if (materials.length && !webglDisposed) {
    // WebGL active - update textures directly
    updateTextures();
  } else if (isShowingSnapshot.value) {
    // In snapshot mode - regenerate snapshot with new colors/textures
    regenerateSnapshot(props.value);
  }
}, { deep: true });

// Watch for sides changes (recreate geometry)
watch(() => props.sides, () => {
  if (scene && mesh && !webglDisposed) {
    // Scene exists - just recreate the mesh
    createDieMesh();
  } else if (isShowingSnapshot.value) {
    // In snapshot mode - regenerate snapshot with new geometry
    regenerateSnapshot(props.value);
  }
  // If neither, onMounted will handle it
});

// Watch for size changes
watch(() => props.size, (newSize) => {
  if (renderer && !webglDisposed) {
    renderer.setSize(newSize, newSize);
  } else if (isShowingSnapshot.value) {
    // In snapshot mode - regenerate snapshot at new size
    regenerateSnapshot(props.value);
  }
});

onMounted(() => {
  // Check if this die needs animation (new roll that hasn't been animated yet)
  const needsAnimation = shouldAnimateDie(props.dieId, props.rollCount ?? 0);

  if (needsAnimation && props.dieId) {
    // Mark as animated before queuing
    markAnimated(props.dieId, props.rollCount ?? 0);

    // Queue animation render
    queueRender(() => {
      initScene();

      // Start animation after a brief delay for scene init
      setTimeout(() => {
        if (mesh) {
          startRollAnimation(props.value);
        }
      }, 50);
    }, myComponentId);
  } else {
    // No animation needed - just render static and snapshot
    queueRender(() => {
      initScene();

      // Take a snapshot and dispose WebGL immediately
      setTimeout(() => {
        scheduleSnapshotAndDispose();
      }, 50);
    }, myComponentId);
  }
});

onUnmounted(() => {
  // Cancel any pending queued renders from this component
  cancelComponentRenders(myComponentId);

  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  if (renderer) {
    renderer.dispose();
    if (containerRef.value && renderer.domElement.parentNode === containerRef.value) {
      containerRef.value.removeChild(renderer.domElement);
    }
  }
  if (mesh) {
    mesh.geometry.dispose();
    materials.forEach(m => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  }
});
</script>

<template>
  <div
    class="die-3d-container"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @click="emit('click')"
  >
    <!-- Show static snapshot image when WebGL is disposed -->
    <img
      v-if="isShowingSnapshot && snapshotDataUrl"
      :src="snapshotDataUrl"
      class="die-snapshot"
      :style="{ width: `${size}px`, height: `${size}px` }"
      alt="Die"
    />
    <!-- WebGL canvas container (Three.js appends canvas here) -->
    <div
      v-show="!isShowingSnapshot"
      ref="containerRef"
      class="die-canvas-container"
    />
  </div>
</template>

<style scoped>
.die-3d-container {
  display: inline-block;
  cursor: pointer;
  position: relative;
}

.die-canvas-container {
  width: 100%;
  height: 100%;
}

.die-snapshot {
  display: block;
  object-fit: contain;
}
</style>
