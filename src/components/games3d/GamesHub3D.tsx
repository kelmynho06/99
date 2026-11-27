import React, { useCallback, useState } from 'react';
import {
  ArrowLeft,
  Car,
  Gamepad2,
  Package,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import {
  MotoDelivery3DGame,
  Parking3DGame,
  RushCar3DGame,
  TowerStack3DGame,
  TunnelNeon3DGame,
} from './GamesBatchA';
import {
  Basketball3DGame,
  BrickBreaker3DGame,
  Penalty3DGame,
  SpaceHop3DGame,
  SphereTrack3DGame,
} from './GamesBatchB';

export type GameId3D =
  | 'rush'
  | 'moto_delivery'
  | 'parking'
  | 'tunnel_neon'
  | 'tower_stack'
  | 'sphere_track'
  | 'penalty'
  | 'basketball'
  | 'space_hop'
  | 'brick_breaker';

interface GameMeta {
  id: GameId3D;
  title: string;
  subtitle: string;
  accent: string;
  tag: string;
}

const GAMES_CATALOG: GameMeta[] = [
  {
    id: 'rush',
    title: '1. GoDriver Rush 3D',
    subtitle: 'Desvie do trânsito em alta velocidade nas 3 faixas',
    accent: 'from-blue-600 to-sky-500',
    tag: 'Corrida',
  },
  {
    id: 'moto_delivery',
    title: '2. Moto Delivery 3D',
    subtitle: 'Colete entregas douradas e desvie dos cones',
    accent: 'from-cyan-600 to-teal-500',
    tag: 'Entrega',
  },
  {
    id: 'parking',
    title: '3. Estacionamento 3D',
    subtitle: 'Manobre com precisão até a vaga verde',
    accent: 'from-emerald-600 to-green-500',
    tag: 'Manobra',
  },
  {
    id: 'tunnel_neon',
    title: '4. Túnel Neon 3D',
    subtitle: 'Gire no túnel iluminado evitando barreiras laser',
    accent: 'from-indigo-600 to-sky-500',
    tag: 'Reflexo',
  },
  {
    id: 'tower_stack',
    title: '5. Torre de Blocos 3D',
    subtitle: 'Empilhe blocos no tempo exato para subir alto',
    accent: 'from-violet-600 to-purple-500',
    tag: 'Precisão',
  },
  {
    id: 'sphere_track',
    title: '6. Esfera na Pista 3D',
    subtitle: 'Equilibre e salte pela pista suspensa no céu',
    accent: 'from-sky-600 to-blue-500',
    tag: 'Aventura',
  },
  {
    id: 'penalty',
    title: '7. Pênalti / Gol 3D',
    subtitle: 'Mire no ângulo e supere o goleiro móvel',
    accent: 'from-green-600 to-emerald-500',
    tag: 'Esporte',
  },
  {
    id: 'basketball',
    title: '8. Basquete Street 3D',
    subtitle: 'Acerte a cesta com sequência de combos',
    accent: 'from-orange-600 to-amber-500',
    tag: 'Esporte',
  },
  {
    id: 'space_hop',
    title: '9. Salto Espacial 3D',
    subtitle: 'Salte entre plataformas flutuantes na galáxia',
    accent: 'from-purple-700 to-indigo-600',
    tag: 'Arcade',
  },
  {
    id: 'brick_breaker',
    title: '10. Quebra-Blocos 3D',
    subtitle: 'Rebata a esfera e destrua toda a parede 3D',
    accent: 'from-rose-600 to-red-500',
    tag: 'Clássico',
  },
];

const HIGH_SCORE_STORAGE_KEY = 'godriver_games3d_records_v1';

function readHighScores(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

interface GamesHub3DProps {
  open: boolean;
  onClose: () => void;
}

export const GamesHub3D: React.FC<GamesHub3DProps> = ({ open, onClose }) => {
  const [selectedId, setSelectedId] = useState<GameId3D | null>(null);
  const [runSeed, setRunSeed] = useState(1);
  const [score, setScore] = useState(0);
  const [highScores, setHighScores] = useState<Record<string, number>>(readHighScores);
  const [gameOverState, setGameOverState] = useState<{ score: number; label: string } | null>(null);

  const handleScoreChange = useCallback((nextScore: number) => {
    setScore(nextScore);
  }, []);

  const handleGameOver = useCallback(
    (finalScore: number, label = 'Fim de jogo!') => {
      setGameOverState({ score: finalScore, label });
      if (!selectedId) return;
      setHighScores((prev) => {
        const best = Math.max(prev[selectedId] || 0, finalScore);
        const updated = { ...prev, [selectedId]: best };
        try {
          localStorage.setItem(HIGH_SCORE_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore quota error
        }
        return updated;
      });
    },
    [selectedId]
  );

  const startGame = (id: GameId3D) => {
    setSelectedId(id);
    setScore(0);
    setGameOverState(null);
    setRunSeed((s) => s + 1);
  };

  if (!open) return null;

  const activeMeta = GAMES_CATALOG.find((g) => g.id === selectedId) || null;

  return (
    <div className="fixed inset-0 z-[1270] flex flex-col bg-[#F4F6F9] text-[#0F172A] h-[100dvh] w-screen overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-4 py-3 pt-safe shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          {selectedId ? (
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setGameOverState(null);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0] shrink-0"
              aria-label="Voltar aos jogos"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <div className="aurora-accent-flow flex h-10 w-10 items-center justify-center rounded-2xl text-white shrink-0">
              <Gamepad2 className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-base font-extrabold text-[#0F172A] truncate">
              {activeMeta ? activeMeta.title : 'Central com 10 Jogos 3D · GoDriver'}
            </h2>
            <p className="text-[11px] font-semibold text-[#475569] truncate">
              {activeMeta
                ? `Pontos: ${score} · Recorde: ${Math.max(highScores[activeMeta.id] || 0, score)}`
                : 'Diversão leve em 3D enquanto aguarda sua corrida ou chamada'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedId && (
            <button
              type="button"
              onClick={() => startGame(selectedId)}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-[#EFF6FF] px-3 text-xs font-extrabold text-[#1D4ED8]"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Reiniciar</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setGameOverState(null);
              onClose();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0]"
            aria-label="Fechar Jogos 3D"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      {!selectedId ? (
        <div className="flex-1 overflow-y-auto p-4 pb-8">
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="rounded-3xl bg-gradient-to-r from-[#2563EB] to-[#0EA5E9] p-5 text-white shadow-lg flex items-center justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  10 Jogos Three.js em Tempo Real
                </span>
                <h3 className="mt-2 font-display text-xl font-extrabold">
                  Escolha seu jogo 3D favorito
                </h3>
                <p className="text-xs text-blue-50 mt-0.5">
                  Controles táteis e teclado · Seus recordes ficam salvos automaticamente no aparelho.
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-2 rounded-2xl bg-white/15 px-4 py-3">
                <Car className="h-6 w-6" />
                <Package className="h-6 w-6" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {GAMES_CATALOG.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => startGame(g.id)}
                  className="group flex flex-col justify-between rounded-3xl border border-[#E2E8F0] bg-white p-4 text-left shadow-sm transition hover:border-[#2563EB] hover:shadow-md active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center rounded-xl bg-gradient-to-r ${g.accent} px-2.5 py-1 text-[10px] font-extrabold uppercase text-white`}
                      >
                        {g.tag}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-extrabold text-amber-600">
                        <Trophy className="h-3.5 w-3.5" />
                        {highScores[g.id] || 0}
                      </span>
                    </div>
                    <h4 className="mt-3 font-display text-base font-extrabold text-[#0F172A]">
                      {g.title}
                    </h4>
                    <p className="mt-1 text-xs text-[#475569] leading-relaxed">{g.subtitle}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs font-extrabold text-[#2563EB]">
                    <span>Jogar em Tela Cheia</span>
                    <span>▶</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden">
          {selectedId === 'rush' && (
            <RushCar3DGame
              key={`rush-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'moto_delivery' && (
            <MotoDelivery3DGame
              key={`moto-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'parking' && (
            <Parking3DGame
              key={`park-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'tunnel_neon' && (
            <TunnelNeon3DGame
              key={`tunnel-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'tower_stack' && (
            <TowerStack3DGame
              key={`tower-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'sphere_track' && (
            <SphereTrack3DGame
              key={`sphere-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'penalty' && (
            <Penalty3DGame
              key={`pen-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'basketball' && (
            <Basketball3DGame
              key={`bask-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'space_hop' && (
            <SpaceHop3DGame
              key={`space-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}
          {selectedId === 'brick_breaker' && (
            <BrickBreaker3DGame
              key={`brick-${runSeed}`}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
            />
          )}

          {/* Clean non-blurred Game Over card */}
          {gameOverState && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0F172A]/75 p-4">
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl border border-[#E2E8F0] space-y-4">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <Trophy className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-extrabold text-[#0F172A]">
                    {gameOverState.label}
                  </h3>
                  <p className="mt-1 text-sm font-bold text-[#475569]">
                    Pontuação final: <span className="text-[#2563EB]">{gameOverState.score}</span>
                  </p>
                  <p className="text-xs font-semibold text-amber-600 mt-1">
                    Seu Recorde: {highScores[selectedId] || gameOverState.score}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(null);
                      setGameOverState(null);
                    }}
                    className="min-h-[46px] rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] text-xs font-extrabold text-[#0F172A]"
                  >
                    Todos os Jogos
                  </button>
                  <button
                    type="button"
                    onClick={() => startGame(selectedId)}
                    className="min-h-[46px] rounded-2xl bg-[#2563EB] text-xs font-extrabold text-white shadow-md"
                  >
                    Jogar Novamente
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
