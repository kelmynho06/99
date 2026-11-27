import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GameComponentProps } from './GamesBatchA';
import { createManagedThreeScene } from './threeHelpers';

// 6. Esfera na Pista 3D (Equilíbrio, cristais bônus e saltos na pista suspensa)
export const SphereTrack3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const ctrl = useRef({ moveX: 0, jump: false });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xdbeafe,
      fogColor: 0xdbeafe,
      fogNear: 25,
      fogFar: 85,
    });
    camera.position.set(0, 5.2, 8.5);
    camera.lookAt(0, 0.5, -10);

    // Composite glowing cyber sphere
    const sphereGroup = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.5, roughness: 0.16 })
    );
    core.castShadow = true;
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.06, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.6 })
    );
    sphereGroup.add(core, band);
    sphereGroup.position.set(0, 0.65, 2);
    scene.add(sphereGroup);

    const tiles: THREE.Mesh[] = [];
    const tileGeo = new THREE.BoxGeometry(3.4, 0.5, 6.2);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.35 });
    for (let i = 0; i < 12; i++) {
      const t = new THREE.Mesh(tileGeo, tileMat);
      t.receiveShadow = true;
      t.position.set(i < 3 ? 0 : Math.sin(i * 0.7) * 2.4, -0.25, 2 - i * 6.4);
      scene.add(t);
      tiles.push(t);
    }

    const gems: THREE.Mesh[] = [];
    const gemGeo = new THREE.OctahedronGeometry(0.42, 0);
    const gemMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 0.5,
    });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Mesh(gemGeo, gemMat);
      g.position.set(Math.sin(i * 1.4) * 2, 1.0, -8 - i * 16);
      scene.add(g);
      gems.push(g);
    }

    let vy = 0;
    let score = 0;
    let alive = true;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') ctrl.current.moveX = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') ctrl.current.moveX = 1;
      if (e.code === 'Space') ctrl.current.jump = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) ctrl.current.moveX = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startLoop((dt, elapsed) => {
      if (!alive) return;
      const speed = Math.min(21, 9.5 + score * 0.025);
      score += dt * 12;
      onScoreChange(Math.floor(score));

      sphereGroup.position.x += ctrl.current.moveX * dt * 6.8;
      core.rotation.x -= speed * dt * 0.9;
      band.rotation.y += dt * 3;

      if (ctrl.current.jump && sphereGroup.position.y <= 0.72) {
        vy = 8.6;
      }
      ctrl.current.jump = false;
      vy -= 21 * dt;
      sphereGroup.position.y += vy * dt;

      let supported = false;
      for (const t of tiles) {
        t.position.z += speed * dt;
        if (t.position.z > 10) {
          const minZ = Math.min(...tiles.map((x) => x.position.z));
          t.position.z = minZ - 6.4;
          t.position.x = (Math.random() - 0.5) * 4.8;
        }
        if (
          Math.abs(t.position.x - sphereGroup.position.x) < 2.0 &&
          Math.abs(t.position.z - sphereGroup.position.z) < 3.4
        ) {
          supported = true;
        }
      }

      for (const g of gems) {
        g.position.z += speed * dt;
        g.rotation.y = elapsed * 3;
        if (g.position.z > 10) {
          g.position.set((Math.random() - 0.5) * 4.2, 1.0, -58 - Math.random() * 14);
        }
        if (g.position.distanceTo(sphereGroup.position) < 1.15) {
          score += 30;
          onScoreChange(Math.floor(score));
          g.position.set((Math.random() - 0.5) * 4.2, 1.0, -64 - Math.random() * 14);
        }
      }

      if (supported && sphereGroup.position.y <= 0.65 && vy < 0) {
        sphereGroup.position.y = 0.65;
        vy = 0;
      }
      if (sphereGroup.position.y < -4.5) {
        alive = false;
        onGameOver(Math.floor(score), 'A esfera caiu da pista!');
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
        Mantenha na pista azul e colete cristais (+30)
      </div>
      <div className="absolute bottom-4 inset-x-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onPointerDown={() => (ctrl.current.moveX = -1)}
          onPointerUp={() => (ctrl.current.moveX = 0)}
          onPointerCancel={() => (ctrl.current.moveX = 0)}
          onPointerLeave={() => (ctrl.current.moveX = 0)}
          className="h-14 flex-1 rounded-2xl bg-white border border-[#CBD5E1] font-extrabold text-[#0F172A] shadow-lg"
        >
          ◀ Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (ctrl.current.jump = true)}
          className="h-14 px-6 rounded-2xl bg-[#10B981] font-extrabold text-white shadow-lg"
        >
          Pular ▲
        </button>
        <button
          type="button"
          onPointerDown={() => (ctrl.current.moveX = 1)}
          onPointerUp={() => (ctrl.current.moveX = 0)}
          onPointerCancel={() => (ctrl.current.moveX = 0)}
          onPointerLeave={() => (ctrl.current.moveX = 0)}
          className="h-14 flex-1 rounded-2xl bg-white border border-[#CBD5E1] font-extrabold text-[#0F172A] shadow-lg"
        >
          Dir ▶
        </button>
      </div>
    </div>
  );
};

// 7. Pênalti / Gol 3D (Goleiro articulado + rede + placar de tentativas)
export const Penalty3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const kickRef = useRef<((targetX: number) => void) | null>(null);
  const [statusLabel, setStatusLabel] = useState('Escolha o canto do chute (3 chances de erro)');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xdcfce7,
    });
    camera.position.set(0, 3.2, 10.5);
    camera.lookAt(0, 1.3, -4);

    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 30),
      new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.9 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);

    const penaltyBox = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 8),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.95 })
    );
    penaltyBox.rotation.x = -Math.PI / 2;
    penaltyBox.position.set(0, 0.01, -3);
    scene.add(penaltyBox);

    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2), postMat);
    postL.position.set(-4, 1.6, -6);
    const postR = postL.clone();
    postR.position.x = 4;
    const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8.2), postMat);
    cross.rotation.z = Math.PI / 2;
    cross.position.set(0, 3.2, -6);
    const netBack = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 3.2),
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
      })
    );
    netBack.position.set(0, 1.6, -7.2);
    scene.add(postL, postR, cross, netBack);

    // Composite Goalkeeper (torso, head, outstretched arms/gloves)
    const keeper = new THREE.Group();
    const kTorso = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.15, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35 })
    );
    kTorso.position.y = 1.1;
    kTorso.castShadow = true;
    const kHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfde68a })
    );
    kHead.position.y = 1.9;
    const kArms = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.28, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2563eb })
    );
    kArms.position.y = 1.45;
    keeper.add(kTorso, kHead, kArms);
    keeper.position.set(0, 0, -5.5);
    scene.add(keeper);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
    );
    ball.castShadow = true;
    ball.position.set(0, 0.45, 4.5);
    scene.add(ball);

    let goals = 0;
    let misses = 0;
    let flying = false;
    const vel = new THREE.Vector3();

    kickRef.current = (targetX: number) => {
      if (flying) return;
      flying = true;
      vel.set((targetX - ball.position.x) * 1.15, 2.55, -13.8);
    };

    const resetBall = () => {
      flying = false;
      ball.position.set(0, 0.45, 4.5);
    };

    startLoop((dt, elapsed) => {
      keeper.position.x = Math.sin(elapsed * (2.6 + goals * 0.22)) * 2.9;
      kArms.rotation.z = Math.sin(elapsed * 5) * 0.15;

      if (flying) {
        ball.position.addScaledVector(vel, dt);
        vel.y -= 5.8 * dt;
        ball.rotation.x -= dt * 10;

        if (ball.position.z <= -5.2) {
          const hitKeeper = Math.abs(ball.position.x - keeper.position.x) < 1.12;
          if (hitKeeper || Math.abs(ball.position.x) > 3.9) {
            misses += 1;
            setStatusLabel(`Defendeu! Restam ${Math.max(0, 3 - misses)} chance(s).`);
            resetBall();
            if (misses >= 3) {
              onGameOver(goals * 50, `Fim dos pênaltis! ${goals} gol(s)`);
            }
          } else {
            goals += 1;
            setStatusLabel(`GOOOL! Total: ${goals} (${3 - misses} chances)`);
            onScoreChange(goals * 50);
            resetBall();
          }
        }
      }
    });

    return () => {
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0] whitespace-nowrap">
        {statusLabel}
      </div>
      <div className="absolute bottom-4 inset-x-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => kickRef.current?.(-2.85)}
          className="min-h-[52px] rounded-2xl bg-white border border-[#CBD5E1] text-xs font-extrabold text-[#0F172A] shadow-lg"
        >
          Chutar Esq
        </button>
        <button
          type="button"
          onClick={() => kickRef.current?.(0)}
          className="min-h-[52px] rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white shadow-lg"
        >
          Chutar Meio
        </button>
        <button
          type="button"
          onClick={() => kickRef.current?.(2.85)}
          className="min-h-[52px] rounded-2xl bg-white border border-[#CBD5E1] text-xs font-extrabold text-[#0F172A] shadow-lg"
        >
          Chutar Dir
        </button>
      </div>
    </div>
  );
};

// 8. Basquete Street 3D (Tabela composta com haste + rede + combo streak)
export const Basketball3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const shootRef = useRef<((aimX: number) => void) | null>(null);
  const [hudText, setHudText] = useState('Arremesse no momento certo! (8 tentativas)');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0xfef3c7,
    });
    camera.position.set(0, 3.8, 9.5);
    camera.lookAt(0, 3.2, -5);

    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 22),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.75 })
    );
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    scene.add(court);

    const hoopGroup = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 5.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5 })
    );
    pole.position.set(0, 2.6, -6.2);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.1, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
    );
    board.position.set(0, 4.6, -5.8);
    const shooterSquare = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.85, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xef4444 })
    );
    shooterSquare.position.set(0, 4.35, -5.78);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.09, 10, 24),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.35 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 3.8, -4.9);
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.5, 1.0, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.65,
      })
    );
    net.position.set(0, 3.3, -4.9);
    hoopGroup.add(pole, board, shooterSquare, rim, net);
    scene.add(hoopGroup);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.55 })
    );
    ball.castShadow = true;
    ball.position.set(0, 1.4, 4.5);
    scene.add(ball);

    let score = 0;
    let streak = 0;
    let attemptsLeft = 8;
    let inAir = false;
    const vel = new THREE.Vector3();

    shootRef.current = (aimX: number) => {
      if (inAir) return;
      inAir = true;
      vel.set((hoopGroup.position.x + aimX - ball.position.x) * 0.95, 9.4, -9.4);
    };

    startLoop((dt, elapsed) => {
      const hoopX = Math.sin(elapsed * 1.4) * Math.min(2.2, score * 0.015);
      hoopGroup.position.x = hoopX;

      if (inAir) {
        ball.position.addScaledVector(vel, dt);
        vel.y -= 13.5 * dt;
        ball.rotation.x -= dt * 6;

        if (
          vel.y < 0 &&
          Math.abs(ball.position.y - 3.8) < 0.45 &&
          Math.hypot(ball.position.x - hoopGroup.position.x, ball.position.z - -4.9) < 0.85
        ) {
          streak += 1;
          score += 20 + streak * 5;
          onScoreChange(score);
          setHudText(`CESTA! Combo x${streak} · ${attemptsLeft} arremesso(s)`);
          inAir = false;
          ball.position.set(0, 1.4, 4.5);
        } else if (ball.position.y < 0.4 || ball.position.z < -8) {
          streak = 0;
          attemptsLeft -= 1;
          setHudText(`Quase! Restam ${attemptsLeft} arremesso(s)`);
          inAir = false;
          ball.position.set(0, 1.4, 4.5);
          if (attemptsLeft <= 0) {
            onGameOver(score, 'Fim da partida de arremessos!');
          }
        }
      }
    });

    return () => {
      dispose();
    };
  }, [onGameOver, onScoreChange]);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0] whitespace-nowrap">
        {hudText}
      </div>
      <div className="absolute bottom-4 inset-x-4 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => shootRef.current?.(-0.35)}
          className="flex-1 min-h-[52px] rounded-2xl bg-white border border-[#CBD5E1] text-xs font-extrabold text-[#0F172A] shadow-lg"
        >
          Arremesso Esq
        </button>
        <button
          type="button"
          onClick={() => shootRef.current?.(0)}
          className="flex-1 min-h-[52px] rounded-2xl bg-[#EA580C] text-xs font-extrabold text-white shadow-lg"
        >
          Arremessar Centro
        </button>
        <button
          type="button"
          onClick={() => shootRef.current?.(0.35)}
          className="flex-1 min-h-[52px] rounded-2xl bg-white border border-[#CBD5E1] text-xs font-extrabold text-[#0F172A] shadow-lg"
        >
          Arremesso Dir
        </button>
      </div>
    </div>
  );
};

// 9. Salto Espacial 3D (Robô explorador composto + plataformas neon)
export const SpaceHop3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const moveRef = useRef(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0x0f172a,
      fogColor: 0x0f172a,
      fogNear: 20,
      fogFar: 65,
    });
    camera.position.set(0, 6.2, 10.5);
    camera.lookAt(0, 0.5, -8);

    // Composite Space Bot
    const player = new THREE.Group();
    const pod = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.78, 0.85),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.45,
      })
    );
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.24, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xeab308, emissiveIntensity: 0.7 })
    );
    visor.position.set(0, 0.12, -0.45);
    const jet = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.45, 8),
      new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xe11d48, emissiveIntensity: 0.7 })
    );
    jet.rotation.x = Math.PI;
    jet.position.y = -0.55;
    player.add(pod, visor, jet);
    player.position.set(0, 1.5, 2);
    scene.add(player);

    const platforms: THREE.Mesh[] = [];
    const platGeo = new THREE.BoxGeometry(3.0, 0.4, 2.8);
    const platMat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      emissive: 0x6d28d9,
      emissiveIntensity: 0.35,
    });
    for (let i = 0; i < 9; i++) {
      const p = new THREE.Mesh(platGeo, platMat);
      p.position.set(i === 0 ? 0 : (Math.random() - 0.5) * 6.5, 0, 2 - i * 4.5);
      scene.add(p);
      platforms.push(p);
    }

    let vy = 6;
    let score = 0;
    let alive = true;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') moveRef.current = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') moveRef.current = 1;
    };
    const onKeyUp = () => {
      moveRef.current = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startLoop((dt) => {
      if (!alive) return;
      const forwardSpeed = Math.min(16, 7.5 + score * 0.02);
      score += dt * 10;
      onScoreChange(Math.floor(score));

      player.position.x = THREE.MathUtils.clamp(player.position.x + moveRef.current * dt * 7.8, -5.5, 5.5);
      vy -= 18 * dt;
      player.position.y += vy * dt;
      player.rotation.y = moveRef.current * -0.25;

      for (const p of platforms) {
        p.position.z += forwardSpeed * dt;
        if (p.position.z > 8) {
          const minZ = Math.min(...platforms.map((x) => x.position.z));
          p.position.z = minZ - 4.5;
          p.position.x = (Math.random() - 0.5) * 6.5;
        }
        if (
          vy < 0 &&
          player.position.y <= 0.78 &&
          player.position.y >= -0.2 &&
          Math.abs(player.position.x - p.position.x) < 1.85 &&
          Math.abs(player.position.z - p.position.z) < 1.85
        ) {
          player.position.y = 0.76;
          vy = 8.4;
        }
      }

      if (player.position.y < -5) {
        alive = false;
        onGameOver(Math.floor(score), 'Caiu no espaço!');
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
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/90 border border-violet-500/40 px-3 py-1 text-[11px] font-bold text-white whitespace-nowrap">
        Mova o robô espacial sobre as plataformas flutuantes
      </div>
      <div className="absolute bottom-4 inset-x-4 flex gap-3">
        <button
          type="button"
          onPointerDown={() => (moveRef.current = -1)}
          onPointerUp={() => (moveRef.current = 0)}
          onPointerCancel={() => (moveRef.current = 0)}
          onPointerLeave={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900 border border-violet-400 text-sm font-extrabold text-white shadow-lg"
        >
          ◀ Esquerda
        </button>
        <button
          type="button"
          onPointerDown={() => (moveRef.current = 1)}
          onPointerUp={() => (moveRef.current = 0)}
          onPointerCancel={() => (moveRef.current = 0)}
          onPointerLeave={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900 border border-violet-400 text-sm font-extrabold text-white shadow-lg"
        >
          Direita ▶
        </button>
      </div>
    </div>
  );
};

// 10. Quebra-Blocos 3D (Brick Breaker 3D com bordas de arena & barra composta)
export const BrickBreaker3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const moveRef = useRef(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { scene, camera, dispose, startLoop } = createManagedThreeScene(container, {
      bgColor: 0x0f172a,
    });
    camera.position.set(0, 12, 11);
    camera.lookAt(0, 0, -1);

    const arena = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 })
    );
    arena.rotation.x = -Math.PI / 2;
    scene.add(arena);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4 });
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 16), wallMat);
    wallL.position.set(-6.0, 0.35, 0);
    const wallR = wallL.clone();
    wallR.position.x = 6.0;
    const wallTop = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.7, 0.4), wallMat);
    wallTop.position.set(0, 0.35, -8.0);
    scene.add(wallL, wallR, wallTop);

    // Composite glowing paddle
    const paddle = new THREE.Group();
    const paddleBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.45, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.45 })
    );
    const bumperL = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfacc15 })
    );
    bumperL.position.x = -1.3;
    const bumperR = bumperL.clone();
    bumperR.position.x = 1.3;
    paddle.add(paddleBody, bumperL, bumperR);
    paddle.position.set(0, 0.3, 6.2);
    scene.add(paddle);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xeab308, emissiveIntensity: 0.6 })
    );
    ball.position.set(0, 0.38, 4.8);
    scene.add(ball);

    const bricks: THREE.Mesh[] = [];
    const colors = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6];
    const bGeo = new THREE.BoxGeometry(1.75, 0.55, 0.85);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        const b = new THREE.Mesh(
          bGeo,
          new THREE.MeshStandardMaterial({ color: colors[row], roughness: 0.3 })
        );
        b.position.set(-4.0 + col * 2.0, 0.35, -5.8 + row * 1.15);
        scene.add(b);
        bricks.push(b);
      }
    }

    let vx = 4.6;
    let vz = -6.8;
    let score = 0;
    let alive = true;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') moveRef.current = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') moveRef.current = 1;
    };
    const onKeyUp = () => {
      moveRef.current = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startLoop((dt) => {
      if (!alive) return;
      paddle.position.x = THREE.MathUtils.clamp(paddle.position.x + moveRef.current * dt * 10.5, -4.3, 4.3);
      ball.position.x += vx * dt;
      ball.position.z += vz * dt;

      if (ball.position.x > 5.4 || ball.position.x < -5.4) vx = -vx;
      if (ball.position.z < -7.4) vz = Math.abs(vz);

      if (
        vz > 0 &&
        Math.abs(ball.position.z - paddle.position.z) < 0.58 &&
        Math.abs(ball.position.x - paddle.position.x) < 1.7
      ) {
        vz = -Math.abs(vz) * 1.02;
        vx = (ball.position.x - paddle.position.x) * 3.8;
      }

      for (const b of bricks) {
        if (!b.visible) continue;
        if (Math.abs(ball.position.x - b.position.x) < 1.1 && Math.abs(ball.position.z - b.position.z) < 0.7) {
          b.visible = false;
          vz = -vz;
          score += 25;
          onScoreChange(score);
          break;
        }
      }

      if (bricks.every((b) => !b.visible)) {
        alive = false;
        onGameOver(score + 100, 'Vitória! Todos os blocos destruídos!');
      } else if (ball.position.z > 8.2) {
        alive = false;
        onGameOver(score, 'A bola passou da barra!');
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
        Rebata a esfera dourada e destrua toda a parede 3D
      </div>
      <div className="absolute bottom-4 inset-x-4 flex gap-3">
        <button
          type="button"
          onPointerDown={() => (moveRef.current = -1)}
          onPointerUp={() => (moveRef.current = 0)}
          onPointerCancel={() => (moveRef.current = 0)}
          onPointerLeave={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          ◀ Mover Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (moveRef.current = 1)}
          onPointerUp={() => (moveRef.current = 0)}
          onPointerCancel={() => (moveRef.current = 0)}
          onPointerLeave={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          Mover Dir ▶
        </button>
      </div>
    </div>
  );
};
