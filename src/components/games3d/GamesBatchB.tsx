import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { GameComponentProps } from './GamesBatchA';
import { createManagedThreeScene } from './threeHelpers';

// 6. Esfera na Pista 3D (Equilíbrio e saltos na pista suspensa)
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

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.45, roughness: 0.18 })
    );
    sphere.castShadow = true;
    sphere.position.set(0, 0.65, 2);
    scene.add(sphere);

    const tiles: THREE.Mesh[] = [];
    const tileGeo = new THREE.BoxGeometry(3.4, 0.5, 6.2);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.4 });
    for (let i = 0; i < 12; i++) {
      const t = new THREE.Mesh(tileGeo, tileMat);
      t.receiveShadow = true;
      t.position.set(i < 3 ? 0 : Math.sin(i * 0.7) * 2.4, -0.25, 2 - i * 6.4);
      scene.add(t);
      tiles.push(t);
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

    startLoop((dt) => {
      if (!alive) return;
      const speed = Math.min(20, 9.5 + score * 0.025);
      score += dt * 12;
      onScoreChange(Math.floor(score));

      sphere.position.x += ctrl.current.moveX * dt * 6.5;
      sphere.rotation.x -= speed * dt * 0.8;

      if (ctrl.current.jump && sphere.position.y <= 0.72) {
        vy = 8.5;
      }
      ctrl.current.jump = false;
      vy -= 21 * dt;
      sphere.position.y += vy * dt;

      let supported = false;
      for (const t of tiles) {
        t.position.z += speed * dt;
        if (t.position.z > 10) {
          const minZ = Math.min(...tiles.map((x) => x.position.z));
          t.position.z = minZ - 6.4;
          t.position.x = (Math.random() - 0.5) * 4.8;
        }
        if (
          Math.abs(t.position.x - sphere.position.x) < 2.0 &&
          Math.abs(t.position.z - sphere.position.z) < 3.4
        ) {
          supported = true;
        }
      }

      if (supported && sphere.position.y <= 0.65 && vy < 0) {
        sphere.position.y = 0.65;
        vy = 0;
      }
      if (sphere.position.y < -4.5) {
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
      <div className="absolute bottom-4 inset-x-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onPointerDown={() => (ctrl.current.moveX = -1)}
          onPointerUp={() => (ctrl.current.moveX = 0)}
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
          className="h-14 flex-1 rounded-2xl bg-white border border-[#CBD5E1] font-extrabold text-[#0F172A] shadow-lg"
        >
          Dir ▶
        </button>
      </div>
    </div>
  );
};

// 7. Pênalti / Gol 3D
export const Penalty3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const kickRef = useRef<((targetX: number) => void) | null>(null);

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

    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2), postMat);
    postL.position.set(-4, 1.6, -6);
    const postR = postL.clone();
    postR.position.x = 4;
    const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8.2), postMat);
    cross.rotation.z = Math.PI / 2;
    cross.position.set(0, 3.2, -6);
    scene.add(postL, postR, cross);

    const keeper = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.0, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35 })
    );
    keeper.castShadow = true;
    keeper.position.set(0, 1.0, -5.5);
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
      vel.set((targetX - ball.position.x) * 1.15, 2.5, -13.5);
    };

    const resetBall = () => {
      flying = false;
      ball.position.set(0, 0.45, 4.5);
    };

    startLoop((dt, elapsed) => {
      keeper.position.x = Math.sin(elapsed * (2.6 + goals * 0.22)) * 2.9;

      if (flying) {
        ball.position.addScaledVector(vel, dt);
        vel.y -= 5.8 * dt;
        ball.rotation.x -= dt * 10;

        if (ball.position.z <= -5.2) {
          const hitKeeper = Math.abs(ball.position.x - keeper.position.x) < 1.05;
          if (hitKeeper || Math.abs(ball.position.x) > 3.9) {
            misses += 1;
            resetBall();
            if (misses >= 3) {
              onGameOver(goals * 50, `Fim dos pênaltis! ${goals} gol(s)`);
            }
          } else {
            goals += 1;
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
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0]">
        Escolha o canto do chute (3 chances de erro)
      </div>
      <div className="absolute bottom-4 inset-x-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => kickRef.current?.(-2.8)}
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
          onClick={() => kickRef.current?.(2.8)}
          className="min-h-[52px] rounded-2xl bg-white border border-[#CBD5E1] text-xs font-extrabold text-[#0F172A] shadow-lg"
        >
          Chutar Dir
        </button>
      </div>
    </div>
  );
};

// 8. Basquete Street 3D
export const Basketball3DGame: React.FC<GameComponentProps> = ({ onScoreChange, onGameOver }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const shootRef = useRef<((aimX: number) => void) | null>(null);

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

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.1, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
    );
    board.position.set(0, 4.6, -5.8);
    scene.add(board);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.09, 10, 24),
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.3 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 3.8, -4.9);
    scene.add(rim);

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
      vel.set((rim.position.x + aimX - ball.position.x) * 0.95, 9.4, -9.4);
    };

    startLoop((dt, elapsed) => {
      const hoopX = Math.sin(elapsed * 1.4) * Math.min(2.2, score * 0.015);
      board.position.x = hoopX;
      rim.position.x = hoopX;

      if (inAir) {
        ball.position.addScaledVector(vel, dt);
        vel.y -= 13.5 * dt;
        ball.rotation.x -= dt * 6;

        if (
          vel.y < 0 &&
          Math.abs(ball.position.y - rim.position.y) < 0.45 &&
          Math.hypot(ball.position.x - rim.position.x, ball.position.z - rim.position.z) < 0.85
        ) {
          streak += 1;
          score += 20 + streak * 5;
          onScoreChange(score);
          inAir = false;
          ball.position.set(0, 1.4, 4.5);
        } else if (ball.position.y < 0.4 || ball.position.z < -8) {
          streak = 0;
          attemptsLeft -= 1;
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
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0F172A] border border-[#E2E8F0]">
        Arremesse no momento certo na tabela móvel!
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

// 9. Salto Espacial 3D
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

    const player = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.95, 0.95),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.4,
      })
    );
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

      player.position.x = THREE.MathUtils.clamp(player.position.x + moveRef.current * dt * 7.5, -5.5, 5.5);
      vy -= 18 * dt;
      player.position.y += vy * dt;
      player.rotation.y += dt * 2.4;

      for (const p of platforms) {
        p.position.z += forwardSpeed * dt;
        if (p.position.z > 8) {
          const minZ = Math.min(...platforms.map((x) => x.position.z));
          p.position.z = minZ - 4.5;
          p.position.x = (Math.random() - 0.5) * 6.5;
        }
        if (
          vy < 0 &&
          player.position.y <= 0.72 &&
          player.position.y >= -0.2 &&
          Math.abs(player.position.x - p.position.x) < 1.85 &&
          Math.abs(player.position.z - p.position.z) < 1.85
        ) {
          player.position.y = 0.7;
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
      <div className="absolute bottom-4 inset-x-4 flex gap-3">
        <button
          type="button"
          onPointerDown={() => (moveRef.current = -1)}
          onPointerUp={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900/90 border border-violet-400 text-sm font-extrabold text-white shadow-lg"
        >
          ◀ Esquerda
        </button>
        <button
          type="button"
          onPointerDown={() => (moveRef.current = 1)}
          onPointerUp={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900/90 border border-violet-400 text-sm font-extrabold text-white shadow-lg"
        >
          Direita ▶
        </button>
      </div>
    </div>
  );
};

// 10. Quebra-Blocos 3D (Brick Breaker 3D)
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

    const paddle = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.5, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.45 })
    );
    paddle.position.set(0, 0.3, 6.2);
    scene.add(paddle);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xeab308, emissiveIntensity: 0.5 })
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
      paddle.position.x = THREE.MathUtils.clamp(paddle.position.x + moveRef.current * dt * 10, -4.4, 4.4);
      ball.position.x += vx * dt;
      ball.position.z += vz * dt;

      if (ball.position.x > 5.5 || ball.position.x < -5.5) vx = -vx;
      if (ball.position.z < -7.5) vz = Math.abs(vz);

      if (
        vz > 0 &&
        Math.abs(ball.position.z - paddle.position.z) < 0.55 &&
        Math.abs(ball.position.x - paddle.position.x) < 1.65
      ) {
        vz = -Math.abs(vz) * 1.03;
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
      <div className="absolute bottom-4 inset-x-4 flex gap-3">
        <button
          type="button"
          onPointerDown={() => (moveRef.current = -1)}
          onPointerUp={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900/90 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          ◀ Mover Esq
        </button>
        <button
          type="button"
          onPointerDown={() => (moveRef.current = 1)}
          onPointerUp={() => (moveRef.current = 0)}
          className="flex-1 min-h-[54px] rounded-2xl bg-slate-900/90 border border-sky-400 text-sm font-extrabold text-white shadow-lg"
        >
          Mover Dir ▶
        </button>
      </div>
    </div>
  );
};
