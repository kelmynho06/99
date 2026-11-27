import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface ThreeSceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: THREE.Clock;
  isSoftwareGl: boolean;
  dispose: () => void;
  startLoop: (onFrame: (dt: number, elapsed: number) => void) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return false;
    const rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|LLVMpipe|Software Rasterizer|Microsoft Basic Render/i.test(rendererStr);
  } catch {
    return false;
  }
}

export function createManagedThreeScene(
  container: HTMLElement,
  options?: {
    bgColor?: number;
    fov?: number;
    near?: number;
    far?: number;
    fogColor?: number;
    fogNear?: number;
    fogFar?: number;
    onContextLost?: () => void;
  }
): ThreeSceneContext {
  const width = Math.max(container.clientWidth, 300);
  const height = Math.max(container.clientHeight, 260);
  const isSoftwareGl = detectSoftwareWebGL();

  const scene = new THREE.Scene();
  const bg = options?.bgColor ?? 0xeef4ff;
  scene.background = new THREE.Color(bg);
  if (options?.fogColor !== undefined) {
    scene.fog = new THREE.Fog(options.fogColor, options.fogNear ?? 18, options.fogFar ?? 95);
  }

  const camera = new THREE.PerspectiveCamera(
    options?.fov ?? 56,
    width / height,
    options?.near ?? 0.1,
    options?.far ?? 220
  );

  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  container.innerHTML = '';
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
  scene.environment = envTex;
  roomEnv.dispose();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.78);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.38);
  dir.position.set(12, 22, 14);
  if (!isSoftwareGl) {
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 70;
    const d = 18;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
  }
  scene.add(dir);

  const clock = new THREE.Clock();
  let rafId = 0;
  let paceTimerId = 0;
  let disposed = false;

  const handleContextLost = (ev: Event) => {
    ev.preventDefault();
    cancelAnimationFrame(rafId);
    window.clearTimeout(paceTimerId);
    options?.onContextLost?.();
  };
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

  const ro = new ResizeObserver(() => {
    if (disposed) return;
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  const startLoop = (onFrame: (dt: number, elapsed: number) => void) => {
    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      onFrame(dt, clock.elapsedTime);
      renderer.render(scene, camera);
      if (isSoftwareGl) {
        paceTimerId = window.setTimeout(() => {
          if (!disposed) rafId = requestAnimationFrame(tick);
        }, 16);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };
    clock.start();
    rafId = requestAnimationFrame(tick);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    window.clearTimeout(paceTimerId);
    ro.disconnect();
    renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          for (const val of Object.values(m)) {
            if (val && typeof val === 'object' && 'isTexture' in val) {
              (val as THREE.Texture).dispose();
            }
          }
          m.dispose();
        }
      }
    });

    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  };

  return { scene, camera, renderer, clock, isSoftwareGl, dispose, startLoop };
}
