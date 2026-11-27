import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createManagedThreeScene } from './threeHelpers';

export interface GameComponentProps {
  onScoreChange: (score: number) => void;
  onGameOver: (finalScore: number, label?: string) => void;
}

function buildCompositeCar(bodyColor: number, isHero = false): {
  group: THREE.Group;
  wheels: THREE.Mesh[];
} {
  const group = new THREE.Group();
  const wheels: THREE.Mesh[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.42,
    roughness: 0.28,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.65,
    roughness: 0.14,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.78 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.25 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.56, 3.25), bodyMat);
  chassis.position.y = 0.48;
  chassis.castShadow = true;
  group.add(chassis);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.48, 1.7), glassMat);
  cabin.position.set(0, 0.96, -0.05);
  cabin.castShadow = true;
  group.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.08, 1.45), bodyMat);
  roof.position.set(0, 1.22, -0.05);
  group.add(roof);

  if (isHero) {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.18, 0.28),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
      })
    );
    sign.position.set(0, 1.33, -0.05);
    group.add(sign);
  }

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfef9c3,
    emissive: 0xfde047,
    emissiveIntensity: 0.85,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.7,
  });
  for (const sx of [-0.58, 0.58]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), headMat);
    hl.position.set(sx, 0.5, -1.64);
    group.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.08), tailMat);
    tl.position.set(sx, 0.52, 1.64);
    group.add(tl);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14);
  const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.26, 10);
  const wheelPositions: [number, number, number][] = [
    [-0.86, 0.32, -1.02],
    [0.86, 0.32, -1.02],
    [-0.86, 0.32, 1.02],
    [0.86, 0.32, 1.02],
  ];
  for (const [wx, wy, wz] of wheelPositions) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wy, wz);
    w.castShadow = true;
    const r = new THREE.Mesh(rimGeo, rimMat);
    w.add(r);
    group.add(w);
    wheels.push(w);
  }

  return { group, wheels };
}

// 1. GoDriver Rush 3D (Desvio de carros em 3 faixas com veículo composto & coleta de moedas)
export const RushCar3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef(0); // -1, 0, 1
  const [hint, setHint] = useState('Toque Esquerda/Direita ou use as setas · Colete moedas (+25)');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const ctx = createManagedThreeScene(container, {
      bgColor: 0xdbeafe,
      fogColor: 0xdbeafe,
      fogNear: 28,
      fogFar: 94,
    });
    const { scene, camera, dispose, startLoop } = ctx;
    camera.position.set(0, 5.4, 10.6);
    camera.lookAt(0, 1.0, -9);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(11.4, 140),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -50;
    road.receiveShadow = true;
    scene.add(road);

    const curbGeo = new THREE.BoxGeometry(0.45, 0.16, 140);
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });
    const curbL = new THREE.Mesh(curbGeo, curbMat);
    curbL.position.set(-5.7, 0.08, -50);
    const curbR = curbL.clone();
    curbR.position.x = 5.7;
    scene.add(curbL, curbR);

    const grassL = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 140),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.9 })
    );
    grassL.rotation.x = -Math.PI / 2;
    grassL.position.set(-22.7, -0.02, -50);
    scene.add(grassL);
    const grassR = grassL.clone();
    grassR.position.x = 22.7;
    scene.add(grassR);

    const stripes: THREE.Mesh[] = [];
    const stripeGeo = new THREE.BoxGeometry(0.18, 0.04, 3.0);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc });
    for (let i = 0; i < 14; i++) {
      for (const x of [-1.75, 1.75]) {
        const s = new THREE.Mesh(stripeGeo, stripeMat);
        s.position.set(x, 0.03, -i * 8 + 8);
        scene.add(s);
        stripes.push(s);
      }
    }

    // Scenery roadside posts
    const posts: THREE.Mesh[] = [];
    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.4 });
    for (let i = 0; i < 10; i++) {
      for (const px of [-6.8, 6.8]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(px, 1.1, -i * 12 + 6);
        scene.add(p);
        posts.push(p);
      }
    }

    const { group: playerGroup, wheels: playerWheels } = buildCompositeCar(0x2563eb, true);
    playerGroup.position.set(0, 0, 3.2);
    scene.add(playerGroup);

    const lanes = [-3.3, 0, 3.3];
    const trafficColors = [0xef4444, 0xf59e0b, 0x06b6d4, 0x8b5cf6];
    const obstacles: Array<{ group: THREE.Group; wheels: THREE.Mesh[]; laneIdx: number }> = [];
    for (let i = 0; i < 6; i++) {
      const laneIdx = i % 3;
      const built = buildCompositeCar(trafficColors[i % trafficColors.length], false);
      built.group.position.set(lanes[laneIdx], 0, -20 - i * 16);
      scene.add(built.group);
      obstacles.push({ group: built.group, wheels: built.wheels, laneIdx });
    }

    const coins: THREE.Mesh[] = [];
    const coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.16, 16);
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xd97706,
      emissiveIntensity: 0.45,
      metalness: 0.6,
      roughness: 0.25,
    });
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(coinGeo, coinMat);
      c.rotation.z = Math.PI / 2;
      c.position.set(lanes[(i + 1) % 3], 0.75, -14 - i * 26);
      scene.add(c);
      coins.push(c);
    }

    let score = 0;
    let alive = true;
    const targetPos = new THREE.Vector3();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        laneRef.current = Math.max(-1, laneRef.current - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        laneRef.current = Math.min(1, laneRef.current + 1);
      }
    };
    window.addEventListener('keydown', onKey);

    startLoop((dt, elapsed) => {
      if (!alive) return;
      const speed = Math.min(36, 17 + score * 0.04);
      score += dt * 14;
      onScoreChange(Math.floor(score));

      const targetX = lanes[laneRef.current + 1];
      targetPos.set(targetX, 0, 3.2);
      playerGroup.position.lerp(targetPos, Math.min(1, dt * 12));
      playerGroup.rotation.z = (playerGroup.position.x - targetX) * 0.08;
      for (const w of playerWheels) w.rotation.x -= speed * dt * 0.9;

      for (const s of stripes) {
        s.position.z += speed * dt;
        if (s.position.z > 14) s.position.z -= 112;
      }
      for (const p of posts) {
        p.position.z += speed * dt;
        if (p.position.z > 14) p.position.z -= 120;
      }

      for (const c of coins) {
        c.position.z += speed * dt;
        c.rotation.y = elapsed * 3.5;
        if (c.position.z > 12) {
          c.position.set(lanes[Math.floor(Math.random() * 3)], 0.75, -72 - Math.random() * 20);
        }
        if (
          Math.abs(c.position.x - playerGroup.position.x) < 1.2 &&
          Math.abs(c.position.z - playerGroup.position.z) < 1.8
        ) {
          score += 25;
          onScoreChange(Math.floor(score));
          c.position.set(lanes[Math.floor(Math.random() * 3)], 0.75, -76 - Math.random() * 20);
        }
      }

      for (const obs of obstacles) {
        obs.group.position.z += speed * 0.84 * dt;
        for (const w of obs.wheels) w.rotation.x -= speed * 0.7 * dt;
        if (obs.group.position.z > 14) {
          obs.laneIdx = Math.floor(Math.random() * 3);
          obs.group.position.set(lanes[obs.laneIdx], 0, -84 - Math.random() * 14);
        }
        const dx = Math.abs(obs.group.position.x - playerGroup.position.x);
        const dz = Math.abs(obs.group.position.z - playerGroup.position.z);
        if (dx < 1.45 && dz < 2.65) {
          alive = false;
          setHint('Colisão! Toque em Reiniciar.');
          onGameOver(Math.floor(score), 'Colidiu no trânsito!');
          break;
        }
      }
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] shadow-sm border border-[#E2E8F0] whitespace-nowrap">
        {hint}
      </div>
      <div className="absolute bottom-4 inset-x-4 flex justify-between gap-3">
        <button
          type="button"
          onPointerDown={() => (laneRef.current = Math.max(-1, laneRef.current - 1))}
          className="flex-1 min-h-[54px] rounded-2xl bg-white border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          ◀ Esquerda
        </button>
        <button
          type="button"
          onPointerDown={() => (laneRef.current = Math.min(1, laneRef.current + 1))}
          className="flex-1 min-h-[54px] rounded-2xl bg-white border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          Direita ▶
        </button>
      </div>
    </div>
  );
};

// 2. Moto Delivery 3D (Moto articulada com piloto + baú + coleta de pacotes + cones refletivos)
export const MotoDelivery3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const steerRef = useRef(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xe0f2fe,
      fogColor: 0xe0f2fe,
      fogNear: 24,
      fogFar: 82,
    });
    camera.position.set(0, 4.4, 8.8);
    camera.lookAt(0, 0.9, -9);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 130),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -50;
    road.receiveShadow = true;
    scene.add(road);

    const shoulderL = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 130),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.92 })
    );
    shoulderL.rotation.x = -Math.PI / 2;
    shoulderL.position.set(-17.25, -0.02, -50);
    const shoulderR = shoulderL.clone();
    shoulderR.position.x = 17.25;
    scene.add(shoulderL, shoulderR);

    // Composite Motorcycle + Rider + GoDriver Delivery Bag
    const moto = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.45, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.45, roughness: 0.25 })
    );
    frame.position.y = 0.56;
    frame.castShadow = true;
    moto.add(frame);

    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.18, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    const frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
    frontWheel.rotation.z = Math.PI / 2;
    frontWheel.position.set(0, 0.36, -0.82);
    const rearWheel = frontWheel.clone();
    rearWheel.position.z = 0.82;
    moto.add(frontWheel, rearWheel);

    const handleBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7 })
    );
    handleBar.position.set(0, 1.02, -0.62);
    moto.add(handleBar);

    const headLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.8 })
    );
    headLight.position.set(0, 0.82, -1.04);
    moto.add(headLight);

    const riderTorso = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.65, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 })
    );
    riderTorso.position.set(0, 1.12, -0.05);
    moto.add(riderTorso);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.35, roughness: 0.2 })
    );
    helmet.position.set(0, 1.62, -0.08);
    moto.add(helmet);

    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.64, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3 })
    );
    bag.position.set(0, 1.08, 0.64);
    bag.castShadow = true;
    moto.add(bag);

    moto.position.set(0, 0, 2.5);
    scene.add(moto);

    const cones: THREE.Group[] = [];
    const coneGeo = new THREE.ConeGeometry(0.55, 1.25, 14);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    const collarGeo = new THREE.CylinderGeometry(0.32, 0.38, 0.22, 14);
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.25,
    });
    for (let i = 0; i < 6; i++) {
      const cg = new THREE.Group();
      const c = new THREE.Mesh(coneGeo, coneMat);
      c.position.y = 0.62;
      c.castShadow = true;
      const col = new THREE.Mesh(collarGeo, collarMat);
      col.position.y = 0.72;
      cg.add(c, col);
      cg.position.set((Math.random() - 0.5) * 7.6, 0, -16 - i * 15);
      scene.add(cg);
      cones.push(cg);
    }

    const parcels: THREE.Group[] = [];
    const parcelGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const parcelMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xca8a04,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    });
    const ribbonMat = new THREE.MeshStandardMaterial({ color: 0x2563eb });
    for (let i = 0; i < 4; i++) {
      const pg = new THREE.Group();
      const p = new THREE.Mesh(parcelGeo, parcelMat);
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.18), ribbonMat);
      const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.95, 0.95), ribbonMat);
      pg.add(p, r1, r2);
      pg.position.set((Math.random() - 0.5) * 7.4, 0.75, -12 - i * 21);
      scene.add(pg);
      parcels.push(pg);
    }

    let score = 0;
    let alive = true;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') steerRef.current = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') steerRef.current = 1;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'a' || e.key === 'd') {
        steerRef.current = 0;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startLoop((dt, elapsed) => {
      if (!alive) return;
      const speed = Math.min(32, 16 + score * 0.03);
      score += dt * 8;
      onScoreChange(Math.floor(score));

      moto.position.x = THREE.MathUtils.clamp(moto.position.x + steerRef.current * dt * 8.8, -4.1, 4.1);
      moto.rotation.z = THREE.MathUtils.lerp(moto.rotation.z, -steerRef.current * 0.3, dt * 10);
      frontWheel.rotation.x -= speed * dt * 1.1;
      rearWheel.rotation.x -= speed * dt * 1.1;

      for (const p of parcels) {
        p.position.z += speed * dt;
        p.rotation.y = elapsed * 2.8;
        p.position.y = 0.75 + Math.sin(elapsed * 4 + p.position.x) * 0.14;
        if (p.position.z > 10) {
          p.position.set((Math.random() - 0.5) * 7.4, 0.75, -75 - Math.random() * 15);
        }
        if (Math.abs(p.position.x - moto.position.x) < 1.15 && Math.abs(p.position.z - moto.position.z) < 1.45) {
          score += 35;
          onScoreChange(Math.floor(score));
          p.position.set((Math.random() - 0.5) * 7.4, 0.75, -78 - Math.random() * 12);
        }
      }

      for (const c of cones) {
        c.position.z += speed * dt;
        if (c.position.z > 10) {
          c.position.set((Math.random() - 0.5) * 7.8, 0, -78 - Math.random() * 12);
        }
        if (Math.abs(c.position.x - moto.position.x) < 0.9 && Math.abs(c.position.z - moto.position.z) < 1.3) {
          alive = false;
          onGameOver(Math.floor(score), 'Bateu no cone da pista!');
          break;
        }
      }
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0] shadow-xs whitespace-nowrap">
        Colete pacotes dourados (+35) e desvie dos cones
      </div>
      <div className="absolute bottom-4 inset-x-4 flex justify-between gap-3">
        <button
          type="button"
          onPointerDown={() => (steerRef.current = -1)}
          onPointerUp={() => (steerRef.current = 0)}
          onPointerCancel={() => (steerRef.current = 0)}
          onPointerLeave={() => (steerRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-white border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          ◀ Inclinar Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (steerRef.current = 1)}
          onPointerUp={() => (steerRef.current = 0)}
          onPointerCancel={() => (steerRef.current = 0)}
          onPointerLeave={() => (steerRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-white border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          Inclinar Dir ▶
        </button>
      </div>
    </div>
  );
};

// 3. Estacionamento Perfeito 3D
export const Parking3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputState = useRef({ throttle: 0, steer: 0 });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xf1f5f9,
    });
    camera.position.set(0, 12.5, 13.5);
    camera.lookAt(0, 0, -2);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 28),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Parking bay lines
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
    for (const bx of [-8, -4, 0, 4, 8]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 4.6), lineMat);
      l.position.set(bx, 0.02, -6);
      scene.add(l);
    }

    const targetBay = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.06, 4.4),
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.45,
      })
    );
    scene.add(targetBay);

    const parkedCars: THREE.Group[] = [];
    const parkedColors = [0x64748b, 0x94a3b8, 0x475569];
    const bayCoords = [
      [-6, -6],
      [-2, -6],
      [2, -6],
      [6, -6],
    ];
    let targetIdx = 2;
    const placeStage = (stage: number) => {
      targetIdx = (stage + 1) % bayCoords.length;
      const [tx, tz] = bayCoords[targetIdx];
      targetBay.position.set(tx, 0.04, tz);
      let pIdx = 0;
      for (let i = 0; i < bayCoords.length; i++) {
        if (i === targetIdx) continue;
        const m = parkedCars[pIdx++];
        if (m) m.position.set(bayCoords[i][0], 0, bayCoords[i][1]);
      }
    };

    for (let i = 0; i < 3; i++) {
      const built = buildCompositeCar(parkedColors[i % parkedColors.length], false);
      scene.add(built.group);
      parkedCars.push(built.group);
    }

    const { group: car, wheels } = buildCompositeCar(0x2563eb, true);
    scene.add(car);

    let level = 1;
    let score = 0;
    let ended = false;
    let heading = 0;

    const resetCar = () => {
      car.position.set((Math.random() - 0.5) * 8, 0, 6.5);
      heading = 0;
      car.rotation.y = 0;
      placeStage(level);
    };
    resetCar();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') inputState.current.throttle = 1;
      if (e.key === 'ArrowDown' || e.key === 's') inputState.current.throttle = -1;
      if (e.key === 'ArrowLeft' || e.key === 'a') inputState.current.steer = 1;
      if (e.key === 'ArrowRight' || e.key === 'd') inputState.current.steer = -1;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'w', 's'].includes(e.key)) inputState.current.throttle = 0;
      if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) inputState.current.steer = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startLoop((dt, elapsed) => {
      if (ended) return;
      targetBay.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.03);
      const { throttle, steer } = inputState.current;
      if (throttle !== 0) {
        heading += steer * throttle * dt * 2.2;
        car.rotation.y = heading;
        car.position.x -= Math.sin(heading) * throttle * dt * 5.4;
        car.position.z -= Math.cos(heading) * throttle * dt * 5.4;
        for (const w of wheels) w.rotation.x -= throttle * dt * 7;
      }
      car.position.x = THREE.MathUtils.clamp(car.position.x, -10.5, 10.5);
      car.position.z = THREE.MathUtils.clamp(car.position.z, -12, 12);

      for (const p of parkedCars) {
        if (Math.hypot(car.position.x - p.position.x, car.position.z - p.position.z) < 2.15) {
          ended = true;
          onGameOver(score, 'Encostou em um carro estacionado!');
          return;
        }
      }

      const distToBay = Math.hypot(
        car.position.x - targetBay.position.x,
        car.position.z - targetBay.position.z
      );
      if (distToBay < 1.15) {
        score += 100 * level;
        level += 1;
        onScoreChange(score);
        resetCar();
      }
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0] shadow-xs whitespace-nowrap">
        Estacione na vaga verde brilhante sem bater
      </div>
      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => (inputState.current.steer = 1)}
            onPointerUp={() => (inputState.current.steer = 0)}
            onPointerCancel={() => (inputState.current.steer = 0)}
            onPointerLeave={() => (inputState.current.steer = 0)}
            className="h-12 w-16 rounded-2xl bg-white border border-[#CBD5E1] font-extrabold text-[#0F172A] shadow-md"
          >
            ◀
          </button>
          <button
            type="button"
            onPointerDown={() => (inputState.current.steer = -1)}
            onPointerUp={() => (inputState.current.steer = 0)}
            onPointerCancel={() => (inputState.current.steer = 0)}
            onPointerLeave={() => (inputState.current.steer = 0)}
            className="h-12 w-16 rounded-2xl bg-white border border-[#CBD5E1] font-extrabold text-[#0F172A] shadow-md"
          >
            ▶
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => (inputState.current.throttle = -1)}
            onPointerUp={() => (inputState.current.throttle = 0)}
            onPointerCancel={() => (inputState.current.throttle = 0)}
            onPointerLeave={() => (inputState.current.throttle = 0)}
            className="h-12 px-4 rounded-2xl bg-amber-500 text-xs font-extrabold text-white shadow-md"
          >
            Ré
          </button>
          <button
            type="button"
            onPointerDown={() => (inputState.current.throttle = 1)}
            onPointerUp={() => (inputState.current.throttle = 0)}
            onPointerCancel={() => (inputState.current.throttle = 0)}
            onPointerLeave={() => (inputState.current.throttle = 0)}
            className="h-12 px-5 rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white shadow-md"
          >
            Acelerar
          </button>
        </div>
      </div>
    </div>
  );
};

// 4. Túnel Neon 3D (Nave composta com asas + propulsor + anéis de energia)
export const TunnelNeon3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const angleRef = useRef(0);
  const turnDir = useRef(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0x020617,
      fogColor: 0x020617,
      fogNear: 18,
      fogFar: 75,
    });
    camera.position.set(0, 0, 7.8);
    camera.lookAt(0, 0, -25);

    const rings: THREE.Mesh[] = [];
    const ringGeo = new THREE.TorusGeometry(4.2, 0.12, 8, 28);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.75,
    });
    for (let i = 0; i < 12; i++) {
      const r = new THREE.Mesh(ringGeo, ringMat);
      r.position.z = -i * 6;
      scene.add(r);
      rings.push(r);
    }

    // Composite Neon Starfighter
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 1.45, 6),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.5 })
    );
    hull.rotation.x = -Math.PI / 2;
    ship.add(hull);
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.08, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, emissive: 0x1d4ed8, emissiveIntensity: 0.45 })
    );
    wing.position.z = 0.2;
    ship.add(wing);
    const thruster = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xf59e0b, emissiveIntensity: 1.0 })
    );
    thruster.position.z = 0.75;
    ship.add(thruster);
    scene.add(ship);

    const gates: Array<{ mesh: THREE.Mesh; sector: number }> = [];
    const gateGeo = new THREE.BoxGeometry(2.4, 1.3, 0.7);
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 0.65,
    });
    for (let i = 0; i < 5; i++) {
      const sector = Math.random() * Math.PI * 2;
      const g = new THREE.Mesh(gateGeo, gateMat);
      g.position.set(Math.cos(sector) * 2.8, Math.sin(sector) * 2.8, -22 - i * 13);
      g.rotation.z = sector;
      scene.add(g);
      gates.push({ mesh: g, sector });
    }

    let score = 0;
    let alive = true;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') turnDir.current = 1;
      if (e.key === 'ArrowRight' || e.key === 'd') turnDir.current = -1;
    };
    const onKeyUp = () => {
      turnDir.current = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startLoop((dt) => {
      if (!alive) return;
      const speed = Math.min(35, 16 + score * 0.04);
      score += dt * 14;
      onScoreChange(Math.floor(score));

      angleRef.current += turnDir.current * dt * 3.5;
      ship.position.set(Math.cos(angleRef.current) * 2.8, Math.sin(angleRef.current) * 2.8, 2.5);
      ship.rotation.z = angleRef.current + Math.PI / 2 - turnDir.current * 0.35;

      for (const r of rings) {
        r.position.z += speed * dt;
        if (r.position.z > 8) r.position.z -= 72;
      }

      for (const g of gates) {
        g.mesh.position.z += speed * dt;
        if (g.mesh.position.z > 8) {
          const sec = Math.random() * Math.PI * 2;
          g.sector = sec;
          g.mesh.position.set(Math.cos(sec) * 2.8, Math.sin(sec) * 2.8, -62);
          g.mesh.rotation.z = sec;
        }
        if (g.mesh.position.distanceTo(ship.position) < 1.32) {
          alive = false;
          onGameOver(Math.floor(score), 'Atingido por barreira neon!');
          break;
        }
      }
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/90 border border-sky-500/40 px-3 py-1 text-[11px] font-bold text-white whitespace-nowrap">
        Gire ao redor do túnel para desviar dos blocos laser
      </div>
      <div className="absolute bottom-4 inset-x-4 flex justify-between gap-3">
        <button
          type="button"
          onPointerDown={() => (turnDir.current = 1)}
          onPointerUp={() => (turnDir.current = 0)}
          onPointerCancel={() => (turnDir.current = 0)}
          onPointerLeave={() => (turnDir.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          ↺ Girar Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (turnDir.current = -1)}
          onPointerUp={() => (turnDir.current = 0)}
          onPointerCancel={() => (turnDir.current = 0)}
          onPointerLeave={() => (turnDir.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          Girar Dir ↻
        </button>
      </div>
    </div>
  );
};

// 5. Torre de Blocos 3D (Tower Stack com bônus de alinhamento perfeito)
export const TowerStack3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dropTriggerRef = useRef<(() => void) | null>(null);
  const [perfectText, setPerfectText] = useState('');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xf8fafc,
    });
    camera.position.set(7.5, 8.5, 9.5);
    camera.lookAt(0, 1, 0);

    const floorPedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 6.2, 0.6, 24),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 })
    );
    floorPedestal.position.y = -0.3;
    floorPedestal.receiveShadow = true;
    scene.add(floorPedestal);

    const palette = [0x2563eb, 0x0ea5e9, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xef4444];
    const stack: THREE.Mesh[] = [];
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.7, 4),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })
    );
    base.position.set(0, 0.35, 0);
    base.castShadow = true;
    scene.add(base);
    stack.push(base);

    let level = 1;
    let totalScore = 0;
    let curW = 4;
    let curD = 4;
    let curX = 0;
    let curZ = 0;
    let dir = 1;
    let axis: 'x' | 'z' = 'x';
    let alive = true;

    const spawnMoving = () => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(curW, 0.7, curD),
        new THREE.MeshStandardMaterial({
          color: palette[level % palette.length],
          roughness: 0.28,
        })
      );
      m.castShadow = true;
      m.position.set(axis === 'x' ? -4.8 : curX, 0.35 + level * 0.72, axis === 'z' ? -4.8 : curZ);
      scene.add(m);
      return m;
    };

    let activeBlock = spawnMoving();

    const handleDrop = () => {
      if (!alive) return;
      const top = stack[stack.length - 1];
      const delta =
        axis === 'x' ? activeBlock.position.x - top.position.x : activeBlock.position.z - top.position.z;
      const size = axis === 'x' ? curW : curD;
      const overlap = size - Math.abs(delta);
      if (overlap <= 0.15) {
        alive = false;
        onGameOver(totalScore, 'Bloco fora da torre!');
        return;
      }

      const isPerfect = Math.abs(delta) < 0.18;
      if (isPerfect) {
        setPerfectText('PERFEITO! +20');
        totalScore += 20;
        activeBlock.position.set(top.position.x, activeBlock.position.y, top.position.z);
      } else {
        setPerfectText('');
        totalScore += 10;
        if (axis === 'x') {
          curW = overlap;
          curX = top.position.x + delta / 2;
        } else {
          curD = overlap;
          curZ = top.position.z + delta / 2;
        }
        activeBlock.geometry.dispose();
        activeBlock.geometry = new THREE.BoxGeometry(curW, 0.7, curD);
        activeBlock.position.set(curX, activeBlock.position.y, curZ);
      }

      stack.push(activeBlock);
      onScoreChange(totalScore);
      level += 1;
      axis = level % 2 === 1 ? 'x' : 'z';
      dir = 1;
      activeBlock = spawnMoving();
    };

    dropTriggerRef.current = handleDrop;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleDrop();
      }
    };
    window.addEventListener('keydown', onKey);

    startLoop((dt) => {
      if (!alive) return;
      const speed = Math.min(9.8, 4.2 + level * 0.24);
      if (axis === 'x') {
        activeBlock.position.x += dir * speed * dt;
        if (activeBlock.position.x > 4.8) dir = -1;
        if (activeBlock.position.x < -4.8) dir = 1;
      } else {
        activeBlock.position.z += dir * speed * dt;
        if (activeBlock.position.z > 4.8) dir = -1;
        if (activeBlock.position.z < -4.8) dir = 1;
      }
      const targetCamY = 7.5 + level * 0.7;
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, dt * 4);
      camera.lookAt(0, level * 0.65, 0);
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div
      className="relative h-full w-full select-none cursor-pointer"
      onPointerDown={() => dropTriggerRef.current?.()}
    >
      <div ref={mountRef} className="h-full w-full" />
      {perfectText && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-3.5 py-1 text-xs font-extrabold text-white shadow-md">
          {perfectText}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-extrabold text-white shadow-xl whitespace-nowrap">
        Toque na tela para soltar o bloco!
      </div>
    </div>
  );
};
