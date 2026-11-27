import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createManagedThreeScene } from './threeHelpers';

export interface GameComponentProps {
  onScoreChange: (score: number) => void;
  onGameOver: (finalScore: number, label?: string) => void;
}

// 1. GoDriver Rush 3D (Desvio de carros em 3 faixas)
export const RushCar3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef(0); // -1, 0, 1
  const [hint, setHint] = useState('Toque Esquerda/Direita ou use as setas');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const ctx = createManagedThreeScene(container, {
      bgColor: 0xdbeafe,
      fogColor: 0xdbeafe,
      fogNear: 28,
      fogFar: 92,
    });
    const { scene, camera, dispose, startLoop } = ctx;
    camera.position.set(0, 5.2, 10.5);
    camera.lookAt(0, 1.0, -8);

    // Road + lane stripes
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 140),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -50;
    road.receiveShadow = true;
    scene.add(road);

    const grassL = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 140),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.9 })
    );
    grassL.rotation.x = -Math.PI / 2;
    grassL.position.set(-20.5, -0.02, -50);
    scene.add(grassL);
    const grassR = grassL.clone();
    grassR.position.x = 20.5;
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

    // Player Blue GoDriver Sedan
    const playerGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 0.68, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.35, roughness: 0.3 })
    );
    body.position.y = 0.52;
    body.castShadow = true;
    playerGroup.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.55, 1.65),
      new THREE.MeshStandardMaterial({ color: 0x93c5fd, metalness: 0.2, roughness: 0.2 })
    );
    cabin.position.set(0, 1.08, -0.1);
    cabin.castShadow = true;
    playerGroup.add(cabin);
    playerGroup.position.set(0, 0, 3.2);
    scene.add(playerGroup);

    // Traffic pool
    const lanes = [-3.3, 0, 3.3];
    const trafficColors = [0xef4444, 0xf59e0b, 0x06b6d4, 0x8b5cf6];
    const obstacles: Array<{ mesh: THREE.Mesh; laneIdx: number }> = [];
    const obsGeo = new THREE.BoxGeometry(1.8, 0.95, 3.2);
    for (let i = 0; i < 6; i++) {
      const laneIdx = i % 3;
      const m = new THREE.Mesh(
        obsGeo,
        new THREE.MeshStandardMaterial({
          color: trafficColors[i % trafficColors.length],
          roughness: 0.4,
        })
      );
      m.castShadow = true;
      m.position.set(lanes[laneIdx], 0.52, -18 - i * 16);
      scene.add(m);
      obstacles.push({ mesh: m, laneIdx });
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

    startLoop((dt) => {
      if (!alive) return;
      const speed = Math.min(34, 16 + score * 0.045);
      score += dt * 15;
      onScoreChange(Math.floor(score));

      const targetX = lanes[laneRef.current + 1];
      targetPos.set(targetX, 0, 3.2);
      playerGroup.position.lerp(targetPos, Math.min(1, dt * 11));
      playerGroup.rotation.z = (playerGroup.position.x - targetX) * 0.08;

      for (const s of stripes) {
        s.position.z += speed * dt;
        if (s.position.z > 14) s.position.z -= 112;
      }

      for (const obs of obstacles) {
        obs.mesh.position.z += speed * 0.85 * dt;
        if (obs.mesh.position.z > 14) {
          obs.laneIdx = Math.floor(Math.random() * 3);
          obs.mesh.position.set(lanes[obs.laneIdx], 0.52, -84 - Math.random() * 14);
        }
        const dx = Math.abs(obs.mesh.position.x - playerGroup.position.x);
        const dz = Math.abs(obs.mesh.position.z - playerGroup.position.z);
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
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] shadow-sm border border-[#E2E8F0]">
        {hint}
      </div>
      <div className="absolute bottom-4 inset-x-4 flex justify-between gap-3">
        <button
          type="button"
          onPointerDown={() => (laneRef.current = Math.max(-1, laneRef.current - 1))}
          className="flex-1 min-h-[54px] rounded-2xl bg-white/95 border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          ◀ Esquerda
        </button>
        <button
          type="button"
          onPointerDown={() => (laneRef.current = Math.min(1, laneRef.current + 1))}
          className="flex-1 min-h-[54px] rounded-2xl bg-white/95 border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          Direita ▶
        </button>
      </div>
    </div>
  );
};

// 2. Moto Delivery 3D (Coleta de pacotes + desvio de cones)
export const MotoDelivery3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const steerRef = useRef(0); // -1..1

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
      new THREE.PlaneGeometry(10, 130),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -50;
    road.receiveShadow = true;
    scene.add(road);

    // Moto + delivery bag
    const moto = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.65, 2.1),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.4, roughness: 0.25 })
    );
    frame.position.y = 0.55;
    frame.castShadow = true;
    moto.add(frame);
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.6, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x2563eb })
    );
    bag.position.set(0, 1.05, 0.55);
    bag.castShadow = true;
    moto.add(bag);
    moto.position.set(0, 0, 2.5);
    scene.add(moto);

    const cones: THREE.Mesh[] = [];
    const coneGeo = new THREE.ConeGeometry(0.55, 1.25, 12);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(coneGeo, coneMat);
      c.castShadow = true;
      c.position.set((Math.random() - 0.5) * 7.6, 0.62, -16 - i * 15);
      scene.add(c);
      cones.push(c);
    }

    const parcels: THREE.Mesh[] = [];
    const parcelGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const parcelMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xca8a04,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    });
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(parcelGeo, parcelMat);
      p.position.set((Math.random() - 0.5) * 7.4, 0.75, -12 - i * 21);
      scene.add(p);
      parcels.push(p);
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
      const speed = Math.min(30, 15 + score * 0.03);
      score += dt * 8;
      onScoreChange(Math.floor(score));

      moto.position.x = THREE.MathUtils.clamp(moto.position.x + steerRef.current * dt * 8.5, -4.1, 4.1);
      moto.rotation.z = THREE.MathUtils.lerp(moto.rotation.z, -steerRef.current * 0.28, dt * 10);

      for (const p of parcels) {
        p.position.z += speed * dt;
        p.rotation.y = elapsed * 2.5;
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
          c.position.set((Math.random() - 0.5) * 7.8, 0.62, -78 - Math.random() * 12);
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
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0] shadow-xs">
        Colete pacotes dourados (+35) e desvie dos cones
      </div>
      <div className="absolute bottom-4 inset-x-4 flex justify-between gap-3">
        <button
          type="button"
          onPointerDown={() => (steerRef.current = -1)}
          onPointerUp={() => (steerRef.current = 0)}
          onPointerLeave={() => (steerRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-white/95 border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
        >
          ◀ Inclinar Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (steerRef.current = 1)}
          onPointerUp={() => (steerRef.current = 0)}
          onPointerLeave={() => (steerRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-white/95 border border-[#CBD5E1] text-sm font-extrabold text-[#0F172A] shadow-lg active:scale-95"
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
    camera.position.set(0, 12, 13);
    camera.lookAt(0, 0, -2);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 28),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const targetBay = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.06, 4.4),
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.35,
      })
    );
    scene.add(targetBay);

    const parkedCars: THREE.Mesh[] = [];
    const parkedGeo = new THREE.BoxGeometry(1.9, 1.0, 3.6);
    const parkedMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5 });
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
        if (m) m.position.set(bayCoords[i][0], 0.55, bayCoords[i][1]);
      }
    };

    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(parkedGeo, parkedMat);
      m.castShadow = true;
      scene.add(m);
      parkedCars.push(m);
    }

    const car = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 0.95, 3.3),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.3, roughness: 0.3 })
    );
    car.castShadow = true;
    scene.add(car);

    let level = 1;
    let score = 0;
    let ended = false;
    let heading = 0;

    const resetCar = () => {
      car.position.set((Math.random() - 0.5) * 8, 0.5, 6.5);
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

    startLoop((dt) => {
      if (ended) return;
      const { throttle, steer } = inputState.current;
      if (throttle !== 0) {
        heading += steer * throttle * dt * 2.1;
        car.rotation.y = heading;
        car.position.x -= Math.sin(heading) * throttle * dt * 5.2;
        car.position.z -= Math.cos(heading) * throttle * dt * 5.2;
      }
      car.position.x = THREE.MathUtils.clamp(car.position.x, -10.5, 10.5);
      car.position.z = THREE.MathUtils.clamp(car.position.z, -12, 12);

      for (const p of parkedCars) {
        if (car.position.distanceTo(p.position) < 2.2) {
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
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0] shadow-xs">
        Estacione na vaga verde brilhante sem bater
      </div>
      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => (inputState.current.steer = 1)}
            onPointerUp={() => (inputState.current.steer = 0)}
            className="h-12 w-16 rounded-2xl bg-white border border-[#CBD5E1] font-extrabold text-[#0F172A] shadow-md"
          >
            ◀
          </button>
          <button
            type="button"
            onPointerDown={() => (inputState.current.steer = -1)}
            onPointerUp={() => (inputState.current.steer = 0)}
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
            className="h-12 px-4 rounded-2xl bg-amber-500 text-xs font-extrabold text-white shadow-md"
          >
            Ré
          </button>
          <button
            type="button"
            onPointerDown={() => (inputState.current.throttle = 1)}
            onPointerUp={() => (inputState.current.throttle = 0)}
            className="h-12 px-5 rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white shadow-md"
          >
            Acelerar
          </button>
        </div>
      </div>
    </div>
  );
};

// 4. Túnel Neon 3D
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
    camera.position.set(0, 0, 7.5);
    camera.lookAt(0, 0, -25);

    const rings: THREE.Mesh[] = [];
    const ringGeo = new THREE.TorusGeometry(4.2, 0.12, 8, 28);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.7,
    });
    for (let i = 0; i < 12; i++) {
      const r = new THREE.Mesh(ringGeo, ringMat);
      r.position.z = -i * 6;
      scene.add(r);
      rings.push(r);
    }

    const ship = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6, 0),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x2563eb,
        emissiveIntensity: 0.6,
      })
    );
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

      angleRef.current += turnDir.current * dt * 3.4;
      ship.position.set(Math.cos(angleRef.current) * 2.8, Math.sin(angleRef.current) * 2.8, 2.5);
      ship.rotation.z += dt * 3;

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
        if (g.mesh.position.distanceTo(ship.position) < 1.35) {
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
      <div className="absolute bottom-4 inset-x-4 flex justify-between gap-3">
        <button
          type="button"
          onPointerDown={() => (turnDir.current = 1)}
          onPointerUp={() => (turnDir.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900/90 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          ↺ Girar Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (turnDir.current = -1)}
          onPointerUp={() => (turnDir.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900/90 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          Girar Dir ↻
        </button>
      </div>
    </div>
  );
};

// 5. Torre de Blocos 3D (Tower Stack)
export const TowerStack3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dropTriggerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xf8fafc,
    });
    camera.position.set(7.5, 8.5, 9.5);
    camera.lookAt(0, 1, 0);

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
          roughness: 0.3,
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
      const delta = axis === 'x' ? activeBlock.position.x - top.position.x : activeBlock.position.z - top.position.z;
      const size = axis === 'x' ? curW : curD;
      const overlap = size - Math.abs(delta);
      if (overlap <= 0.15) {
        alive = false;
        onGameOver(level - 1, 'Bloco fora da torre!');
        return;
      }

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
      stack.push(activeBlock);

      onScoreChange(level);
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
      const speed = Math.min(9.5, 4.2 + level * 0.25);
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
      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-extrabold text-white shadow-xl">
        Toque na tela para soltar o bloco!
      </div>
    </div>
  );
};
