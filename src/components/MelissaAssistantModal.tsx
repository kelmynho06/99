import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Gamepad2,
  MapPin,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneCall,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { getCurrentGpsPosition } from '../lib/capacitorDevice';
import { formatBRL } from '../lib/geo';
import {
  checkMelissaBackendStatus,
  isRikelmyOwnerGreeting,
  queryMelissaWithCloudflareFallback,
  type MelissaActionPayload,
} from '../lib/melissaGeminiClient';
import {
  getNightDutyWindowStatus,
  sendDirectMessage,
  uploadSupportAttachment,
} from '../lib/mobilityApi';
import { speakWithMelissaNaturalVoice, stopSpeech } from '../lib/sound';
import { getUserPreferences, saveUserPreferences } from '../lib/userPrefs';
import type {
  PaymentMethod,
  PlatformConfig,
  Ride,
  RideCategory,
  UserProfile,
} from '../types/mobility';

/**
 * Custom geometric GoDriver wave emblem for Melissa (replaces generic star icons)
 */
export const MelissaEmblem: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="2.1" opacity="0.28" />
    <path
      d="M7.5 16.5C9.8 11.2 12.6 11.2 14.8 16.5C17 21.8 19.8 21.8 22.1 16.5C23.1 14.1 24 13.1 25 13.1"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="24.5" cy="10" r="2.2" fill="currentColor" />
  </svg>
);

export const MelissaTriggerButton: React.FC<{
  onClick: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ onClick, title = 'Falar com a Melissa IA', size = 'md', className = '' }) => {
  const dim =
    size === 'lg'
      ? 'h-12 w-12'
      : size === 'sm'
      ? 'h-9 w-9'
      : 'h-10 w-10';
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 18 : 20;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`aurora-accent-flow relative flex ${dim} shrink-0 items-center justify-center rounded-full text-white shadow-md hover:scale-105 active:scale-95 transition-all duration-300 ${className}`}
    >
      <MelissaEmblem size={iconSize} />
    </button>
  );
};

interface ExternalLinkCard {
  label: string;
  url: string;
}

interface YouTubeEmbedInfo {
  query: string;
  videoId?: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'melissa';
  text: string;
  attachmentName?: string;
  attachmentUrl?: string;
  gpsCoords?: { lat: number; lng: number } | null;
  externalLink?: ExternalLinkCard | null;
  phoneLink?: { label: string; phone: string } | null;
  youtubeEmbed?: YouTubeEmbedInfo | null;
  createdAt: string;
  animate?: boolean;
}

type PendingConfirmation =
  | {
      action: 'delete_prompt' | 'financial_prompt' | 'open_wallet' | 'open_facial' | 'open_support';
      summary: string;
    }
  | {
      action: 'request_ride';
      summary: string;
      originQuery?: string;
      destQuery: string;
      category?: RideCategory;
      paymentMethod?: PaymentMethod;
    }
  | {
      action: 'cancel_ride';
      summary: string;
    }
  | {
      action: 'admin_toggle_block_user';
      summary: string;
      targetUser: UserProfile;
      block: boolean;
    };

export interface MelissaAssistantModalProps {
  open: boolean;
  currentUser: UserProfile;
  platformConfig?: PlatformConfig | null;
  activeRide?: Ride | null;
  onlineDriversCount?: number;
  adminStatsSummary?: string;
  adminUsers?: UserProfile[];
  adminRides?: Ride[];
  onClose: () => void;
  onOpenGames?: () => void;
  onOpenWallet?: () => void;
  onOpenSupport?: () => void;
  onOpenSettings?: () => void;
  onOpenFacialQueue?: () => void;
  onTriggerAdminAction?: (action: string) => void;
  onLogout?: () => void;
  onMelissaRequestRide?: (params: {
    originQuery?: string;
    destQuery: string;
    category?: RideCategory;
    paymentMethod?: PaymentMethod;
  }) => Promise<{ ok: boolean; summary: string }>;
  onMelissaCancelRide?: () => Promise<boolean>;
  onMelissaToggleOnline?: (online?: boolean) => Promise<string>;
  onMelissaLocateDriver?: (driver: UserProfile) => void;
  onMelissaToggleBlockUser?: (user: UserProfile, block: boolean) => Promise<void>;
  onMelissaSwitchAdminTab?: (tabName: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isSafeHttpsUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function extractYouTubeVideoId(urlOrText: string): string | undefined {
  const m = urlOrText.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m?.[1];
}

const MELISSA_CHAT_STORAGE_PREFIX = 'godriver_melissa_chat_v1_';

function loadSavedMelissaHistory(userId: string): ChatMessage[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${MELISSA_CHAT_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-40).map((m) => ({ ...m, animate: false }));
  } catch {
    return [];
  }
}

function persistMelissaHistory(userId: string, msgs: ChatMessage[]): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const compact = msgs.slice(-40).map((m) => ({
      ...m,
      animate: false,
      // Avoid storing heavy base64 images inside localStorage
      attachmentUrl:
        m.attachmentUrl && m.attachmentUrl.startsWith('data:') ? undefined : m.attachmentUrl,
    }));
    window.localStorage.setItem(
      `${MELISSA_CHAT_STORAGE_PREFIX}${userId}`,
      JSON.stringify(compact)
    );
  } catch {
    // Ignore storage quota errors cleanly
  }
}

const TypewriterText: React.FC<{
  text: string;
  animate?: boolean;
  onStep?: () => void;
}> = ({ text, animate = false, onStep }) => {
  const [visibleCount, setVisibleCount] = useState<number>(() => (animate ? 0 : text.length));

  useEffect(() => {
    if (!animate) {
      setVisibleCount(text.length);
      return;
    }
    setVisibleCount(0);
    let current = 0;
    const stepSize = text.length > 360 ? 3 : text.length > 140 ? 2 : 1;
    const intervalMs = text.length > 360 ? 12 : 16;

    const timer = window.setInterval(() => {
      current = Math.min(text.length, current + stepSize);
      setVisibleCount(current);
      onStep?.();
      if (current >= text.length) {
        window.clearInterval(timer);
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [animate, onStep, text]);

  const isTyping = animate && visibleCount < text.length;
  return (
    <span>
      {text.slice(0, visibleCount)}
      {isTyping && (
        <span
          aria-hidden="true"
          className="inline-block ml-0.5 h-4 w-[2px] align-middle bg-[#2563EB] animate-pulse"
        />
      )}
    </span>
  );
};

export const MelissaAssistantModal: React.FC<MelissaAssistantModalProps> = ({
  open,
  currentUser,
  platformConfig,
  activeRide,
  onlineDriversCount = 0,
  adminStatsSummary = '',
  adminUsers = [],
  adminRides = [],
  onClose,
  onOpenGames,
  onOpenWallet,
  onOpenSupport,
  onOpenSettings,
  onOpenFacialQueue,
  onTriggerAdminAction,
  onLogout,
  onMelissaRequestRide,
  onMelissaCancelRide,
  onMelissaToggleOnline,
  onMelissaLocateDriver,
  onMelissaToggleBlockUser,
  onMelissaSwitchAdminTab,
}) => {
  const isAdmin = Boolean(currentUser.is_admin || currentUser.role === 'admin');
  const firstName = currentUser.full_name?.trim().split(' ')[0] || 'você';
  const appName = platformConfig?.site_name?.trim() || 'Go Driver Mobilidade';
  const nightDuty = getNightDutyWindowStatus(platformConfig);

  const [prefs, setPrefs] = useState(getUserPreferences);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadSavedMelissaHistory(currentUser.id)
  );
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [alexaListening, setAlexaListening] = useState(false);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [missingGeminiKey, setMissingGeminiKey] = useState(false);
  const [apiDiagnostic, setApiDiagnostic] = useState<string | null>(null);
  const [recognizedAsRikelmy, setRecognizedAsRikelmy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    base64: string;
    mimeType: string;
    name: string;
  } | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const alexaActiveRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    persistMelissaHistory(currentUser.id, messages);
  }, [currentUser.id, messages]);

  const adminDirectoryContext = useMemo(() => {
    if (!isAdmin || adminUsers.length === 0) return '';
    const userLines = adminUsers.slice(0, 80).map((u) => {
      const roleTag =
        u.is_admin || u.role === 'admin'
          ? 'Admin'
          : u.role === 'driver'
          ? 'Motorista'
          : 'Cliente';
      const veh = u.driver
        ? ` · Veículo: ${u.driver.vehicle_model || 'N/D'} (${u.driver.vehicle_plate || 'sem placa'}, ${u.driver.vehicle_color || '-'}, ${u.driver.vehicle_type}) · ${u.driver.is_online ? 'ONLINE' : 'offline'} · Nota ${Number(u.rating_avg || 5).toFixed(1)} · Aceitação ${Number(u.driver.acceptance_rate || 100).toFixed(0)}%${u.driver.pix_key ? ` · Pix: ${u.driver.pix_key}` : ''}`
        : ` · Nota ${Number(u.rating_avg || 5).toFixed(1)}`;
      const debtAmt = Number(u.pending_debt_amount || 0);
      const debt = debtAmt > 0 ? ` · Pendência: ${formatBRL(debtAmt)}` : '';
      return `- [${roleTag}] Nome: ${u.full_name} | Tel: ${u.phone || 'não informado'} | E-mail: ${u.email} | Status: ${u.status} | Saldo GoPay: ${formatBRL(u.wallet_balance)}${debt}${veh}`;
    });
    const recentRides = adminRides.slice(0, 15).map(
      (r) =>
        `- Corrida ${r.id.slice(0, 8)}: Passageiro ${r.passenger?.full_name || 'N/D'}, Motorista ${r.driver?.full_name || 'Aguardando'} · ${r.origin_address} -> ${r.destination_address} · ${formatBRL(r.final_fare ?? r.estimated_fare)} (${r.status})`
    );
    return [
      `DIRETÓRIO COMPLETO DE USUÁRIOS (${adminUsers.length}):`,
      ...userLines,
      recentRides.length > 0 ? `CORRIDAS RECENTES (${adminRides.length} total):` : '',
      ...recentRides,
    ]
      .filter(Boolean)
      .join('\n');
  }, [adminRides, adminUsers, isAdmin]);

  const buildWelcomeMenu = useCallback((): string => {
    if (isAdmin) {
      return `Olá, ${firstName}! Sou a Melissa.\n\nEstou pronta no Painel Administrativo para localizar motoristas online, consultar dados, gerenciar contas (com sua confirmação) ou conversar sobre qualquer assunto:\n1. Resumo operacional e financeiro\n2. Fila de reconhecimento facial ao vivo\n3. Status do Plantão Noturno (${nightDuty.startTime} às ${nightDuty.endTime})\n4. Configurações, Paleta e SQL`;
    }
    if (currentUser.role === 'driver') {
      return `Olá, ${firstName}! Sou a Melissa, sua assistente na ${appName}.\n\nPosso conectar/desconectar você, ligar para o passageiro, abrir jogos ou conversar:\n1. Meu saldo GoPay e saques Pix\n2. Status da corrida/entrega ativa\n3. Abrir Central com 10 Jogos 3D\n4. Enviar mensagem, foto ou GPS ao Suporte`;
    }
    return `Olá, ${firstName}! Sou a Melissa da ${appName}.\n\nPosso chamar uma corrida ou entrega (inclusive para outra origem), abrir sites, ligar para o motorista ou conversar:\n1. Ver meu saldo GoPay (${formatBRL(currentUser.wallet_balance)})\n2. Regras de pagamento e Plantão Noturno\n3. Jogar na Central com 10 Jogos 3D\n4. Enviar mensagem, foto ou GPS para o Suporte`;
  }, [
    appName,
    currentUser.role,
    currentUser.wallet_balance,
    firstName,
    isAdmin,
    nightDuty.endTime,
    nightDuty.startTime,
  ]);

  useEffect(() => {
    if (!open) {
      setMinimized(false);
      alexaActiveRef.current = false;
      setAlexaListening(false);
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      stopSpeech();
      return;
    }

    let cancelled = false;
    void checkMelissaBackendStatus().then((status) => {
      if (cancelled) return;
      setMissingGeminiKey(status === 'cloudflare-missing-key');
    });

    setMessages((prev) => {
      if (prev.length > 0) return prev;
      const saved = loadSavedMelissaHistory(currentUser.id);
      if (saved.length > 0) return saved;
      return [
        {
          id: 'welcome-melissa',
          sender: 'melissa',
          text: buildWelcomeMenu(),
          createdAt: new Date().toISOString(),
          animate: true,
        },
      ];
    });
    return () => {
      cancelled = true;
    };
  }, [buildWelcomeMenu, currentUser.id, open]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, thinking, minimized, scrollToBottom]);

  const speakReply = useCallback(async (text: string) => {
    if (!getUserPreferences().voice_enabled) return;
    setSpeaking(true);
    try {
      await speakWithMelissaNaturalVoice(text, { interrupt: true });
    } finally {
      setSpeaking(false);
    }
  }, []);

  const appendMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'createdAt'>) => {
    setMessages((prev) => [
      ...prev.slice(-39),
      {
        ...msg,
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const forwardPayloadToAdmin = useCallback(
    async (
      contentText: string,
      extra?: {
        attachmentUrl?: string | null;
        attachmentName?: string | null;
        attachmentType?: string | null;
        gpsLat?: number | null;
        gpsLng?: number | null;
      }
    ) => {
      const senderRoleLabel =
        currentUser.role === 'driver' ? 'Motorista/Entregador' : 'Passageiro';
      await sendDirectMessage({
        userId: currentUser.id,
        senderId: currentUser.id,
        senderName: `${currentUser.full_name} (${senderRoleLabel})`,
        senderRole: currentUser.role,
        content: `[Via Melissa] ${contentText}`,
        attachmentUrl: extra?.attachmentUrl,
        attachmentName: extra?.attachmentName,
        attachmentType: extra?.attachmentType,
        gpsLat: extra?.gpsLat,
        gpsLng: extra?.gpsLng,
      });
    },
    [currentUser.full_name, currentUser.id, currentUser.role]
  );

  const findAdminUserByName = useCallback(
    (nameQuery: string, driversOnly = false): UserProfile | null => {
      const clean = nameQuery
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ');
      if (!clean) return null;

      const pool = driversOnly
        ? adminUsers.filter((u) => u.role === 'driver')
        : adminUsers.filter((u) => !u.is_admin && u.role !== 'admin');

      const exact = pool.find((u) =>
        u.full_name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .includes(clean)
      );
      if (exact) return exact;

      const tokens = clean.split(' ').filter((t) => t.length >= 2);
      if (tokens.length === 0) return null;

      // Prioritize online drivers when locating drivers
      const sorted = [...pool].sort(
        (a, b) => Number(Boolean(b.driver?.is_online)) - Number(Boolean(a.driver?.is_online))
      );
      return (
        sorted.find((u) => {
          const norm = u.full_name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          return tokens.some((tok) => norm.includes(tok));
        }) || null
      );
    },
    [adminUsers]
  );

  const executeStructuredAction = useCallback(
    async (
      action: MelissaActionPayload,
      requireConfirmFlag: boolean
    ): Promise<{
      replyOverride?: string;
      externalLink?: ExternalLinkCard | null;
      phoneLink?: { label: string; phone: string } | null;
      youtubeEmbed?: YouTubeEmbedInfo | null;
    } | null> => {
      if (!action || action.type === 'none') return null;

      if (action.type === 'logout' && onLogout) {
        window.setTimeout(() => {
          onLogout();
        }, 700);
        return {
          replyOverride: 'Encerrando sua sessão agora com segurança. Até logo!',
        };
      }

      if (action.type === 'open_wallet' && onOpenWallet) {
        onOpenWallet();
        return null;
      }
      if (action.type === 'open_games' && onOpenGames) {
        onOpenGames();
        return null;
      }
      if (action.type === 'open_support' && onOpenSupport) {
        onOpenSupport();
        return null;
      }
      if (action.type === 'open_settings' && onOpenSettings) {
        onOpenSettings();
        return null;
      }
      if (action.type === 'open_facial_queue' && onOpenFacialQueue) {
        onOpenFacialQueue();
        return null;
      }

      if (action.type === 'admin_switch_tab' && isAdmin && action.tabName && onMelissaSwitchAdminTab) {
        onMelissaSwitchAdminTab(action.tabName);
        return null;
      }

      if (action.type === 'open_external' && action.url) {
        const safeUrl = isSafeHttpsUrl(action.url);
        if (safeUrl) {
          const hostLabel = safeUrl.includes('youtube')
            ? 'Abrir YouTube'
            : safeUrl.includes('wa.me') || safeUrl.includes('whatsapp')
            ? 'Abrir WhatsApp'
            : 'Abrir no Google';
          return {
            externalLink: { label: hostLabel, url: safeUrl },
          };
        }
      }

      if (action.type === 'play_youtube') {
        const q = (action.youtubeQuery || 'música relaxante').trim();
        const vid = action.url ? extractYouTubeVideoId(action.url) : undefined;
        return {
          youtubeEmbed: { query: q, videoId: vid },
          externalLink: {
            label: `Buscar "${q}" no YouTube`,
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
          },
        };
      }

      if (action.type === 'call_phone') {
        const targetPhone =
          currentUser.role === 'driver'
            ? activeRide?.passenger?.phone
            : activeRide?.driver?.phone;
        const targetName =
          currentUser.role === 'driver'
            ? activeRide?.passenger?.full_name || 'Passageiro'
            : activeRide?.driver?.full_name || 'Motorista';
        if (targetPhone) {
          return {
            phoneLink: { label: `Ligar para ${targetName}`, phone: targetPhone },
          };
        }
        return {
          replyOverride:
            'Não há uma corrida ativa com telefone disponível neste momento para realizar a ligação.',
        };
      }

      if (
        action.type === 'toggle_driver_online' &&
        currentUser.role === 'driver' &&
        onMelissaToggleOnline
      ) {
        const msg = await onMelissaToggleOnline(action.online);
        return { replyOverride: msg };
      }

      if (action.type === 'request_ride' && currentUser.role === 'passenger' && action.destQuery) {
        setPendingConfirm({
          action: 'request_ride',
          summary: `Solicitar ${action.category || 'corrida'} para "${action.destQuery}"${
            action.originQuery ? ` saindo de "${action.originQuery}"` : ''
          }`,
          originQuery: action.originQuery,
          destQuery: action.destQuery,
          category: action.category,
          paymentMethod: action.paymentMethod,
        });
        return null;
      }

      if (action.type === 'cancel_ride' && currentUser.role === 'passenger' && activeRide) {
        setPendingConfirm({
          action: 'cancel_ride',
          summary: `Cancelar corrida para ${activeRide.destination_address}`,
        });
        return null;
      }

      if (action.type === 'admin_locate_driver' && isAdmin && action.driverName) {
        const drv = findAdminUserByName(action.driverName, true);
        if (!drv) {
          return {
            replyOverride: `Não encontrei nenhum motorista cadastrado com o nome "${action.driverName}".`,
          };
        }
        onMelissaLocateDriver?.(drv);
        if (
          drv.driver?.is_online &&
          typeof drv.driver.current_lat === 'number' &&
          typeof drv.driver.current_lng === 'number'
        ) {
          return {
            replyOverride: `Motorista ${drv.full_name} está ONLINE agora! Centralizei o mapa administrativo na posição dele (${drv.driver.current_lat.toFixed(5)}, ${drv.driver.current_lng.toFixed(5)}) · Veículo: ${drv.driver.vehicle_model} (${drv.driver.vehicle_plate}).`,
          };
        }
        return {
          replyOverride: `Encontrei ${drv.full_name} (${drv.driver?.vehicle_model || 'Motorista'}), mas ele está OFFLINE no momento.`,
        };
      }

      if (
        action.type === 'admin_toggle_block_user' &&
        isAdmin &&
        action.targetName &&
        onMelissaToggleBlockUser
      ) {
        const target = findAdminUserByName(action.targetName, false);
        if (!target) {
          return {
            replyOverride: `Não encontrei nenhum usuário com o nome "${action.targetName}".`,
          };
        }
        const shouldBlock = action.targetBlock !== false;
        if (requireConfirmFlag || !pendingConfirm) {
          setPendingConfirm({
            action: 'admin_toggle_block_user',
            summary: `${shouldBlock ? 'Bloquear/Suspender' : 'Reativar'} ${target.full_name}`,
            targetUser: target,
            block: shouldBlock,
          });
          return {
            replyOverride: `Confirmação de segurança: você deseja ${
              shouldBlock ? 'bloquear/suspender' : 'reativar'
            } a conta de ${target.full_name} (${
              target.role === 'driver' ? 'Motorista' : 'Passageiro'
            })? Responda "Sim" para confirmar ou "Não" para cancelar.`,
          };
        }
      }

      return null;
    },
    [
      activeRide,
      currentUser.role,
      findAdminUserByName,
      isAdmin,
      onLogout,
      onMelissaLocateDriver,
      onMelissaSwitchAdminTab,
      onMelissaToggleBlockUser,
      onMelissaToggleOnline,
      onOpenFacialQueue,
      onOpenGames,
      onOpenSettings,
      onOpenSupport,
      onOpenWallet,
      pendingConfirm,
    ]
  );

  // Local instant rule engine (zero AI quota consumed!)
  const tryLocalChatbotResponse = useCallback(
    async (
      rawText: string
    ): Promise<{
      handled: boolean;
      reply?: string;
      externalLink?: ExternalLinkCard | null;
      phoneLink?: { label: string; phone: string } | null;
      youtubeEmbed?: YouTubeEmbedInfo | null;
    }> => {
      const normalized = rawText
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      // Recognition of Rikelmy (owner & primary admin) across ALL panels
      if (isRikelmyOwnerGreeting(rawText)) {
        setRecognizedAsRikelmy(true);
        if (isAdmin) {
          return {
            handled: true,
            reply:
              'Oi, Rikelmy! Reconheci você na hora — seja bem-vindo, dono e administrador da Go Driver! Aqui no painel administrativo tenho acesso completo aos clientes, motoristas, saldos, corridas e configurações. O que você precisa ver ou fazer agora?',
          };
        }
        return {
          handled: true,
          reply:
            'Oi, Rikelmy! Já sei que é você — bem-vindo, chefe e administrador geral da Go Driver! Reconheci você aqui mesmo neste painel. Como posso te ajudar agora?',
        };
      }

      // Handle pending confirmation ("Sim" / "Não")
      if (pendingConfirm) {
        if (/^(sim|s|claro|pode|confirmar|confirmo|ok|vai)$/.test(normalized)) {
          const currentPending = pendingConfirm;
          setPendingConfirm(null);

          if (currentPending.action === 'open_wallet' && onOpenWallet) {
            onOpenWallet();
            return { handled: true, reply: 'Confirmado! Abri a sua carteira GoPay.' };
          }
          if (currentPending.action === 'open_facial' && onOpenFacialQueue) {
            onOpenFacialQueue();
            return {
              handled: true,
              reply: 'Confirmado! Abrindo a Fila de Reconhecimento Facial ao Vivo agora.',
            };
          }
          if (currentPending.action === 'open_support' && onOpenSupport) {
            onOpenSupport();
            return { handled: true, reply: 'Confirmado! Abri o chat de suporte direto.' };
          }
          if (currentPending.action === 'request_ride' && onMelissaRequestRide) {
            const res = await onMelissaRequestRide({
              originQuery: currentPending.originQuery,
              destQuery: currentPending.destQuery,
              category: currentPending.category,
              paymentMethod: currentPending.paymentMethod,
            });
            return { handled: true, reply: res.summary };
          }
          if (currentPending.action === 'cancel_ride' && onMelissaCancelRide) {
            const cancelled = await onMelissaCancelRide();
            return {
              handled: true,
              reply: cancelled
                ? 'Sua corrida foi cancelada conforme solicitado.'
                : 'Não foi possível cancelar esta corrida no status atual.',
            };
          }
          if (
            currentPending.action === 'admin_toggle_block_user' &&
            isAdmin &&
            onMelissaToggleBlockUser
          ) {
            await onMelissaToggleBlockUser(currentPending.targetUser, currentPending.block);
            return {
              handled: true,
              reply: `Pronto! A conta de ${currentPending.targetUser.full_name} foi ${
                currentPending.block ? 'bloqueada/suspensa' : 'reativada'
              } no sistema.`,
            };
          }
          if (onTriggerAdminAction) {
            onTriggerAdminAction(currentPending.summary);
          }
          return {
            handled: true,
            reply: `Confirmado! ${currentPending.summary} — verifique os detalhes na tela correspondente do painel.`,
          };
        }
        if (/^(nao|n|cancela|cancelar|deixa|parar)$/.test(normalized)) {
          setPendingConfirm(null);
          return {
            handled: true,
            reply: 'Tudo bem, cancelei essa solicitação. Nenhuma alteração foi feita.',
          };
        }
      }

      // Automatic Logout
      if (
        /(encerrar sessao|sair da conta|fazer logout|deslogar|melissa sair|pode sair)/.test(
          normalized
        ) &&
        onLogout
      ) {
        window.setTimeout(() => {
          onLogout();
        }, 700);
        return {
          handled: true,
          reply: 'Encerrando sua sessão agora com segurança. Até logo!',
        };
      }

      // Call active driver or passenger
      if (/(ligar para|telefonar para|chamar no telefone|ligue para)/.test(normalized)) {
        const targetPhone =
          currentUser.role === 'driver'
            ? activeRide?.passenger?.phone
            : activeRide?.driver?.phone;
        const targetLabel =
          currentUser.role === 'driver'
            ? activeRide?.passenger?.full_name || 'Passageiro'
            : activeRide?.driver?.full_name || 'Motorista';
        if (targetPhone) {
          return {
            handled: true,
            reply: `Aqui está o atalho direto para ligar para ${targetLabel} (${targetPhone}):`,
            phoneLink: { label: `Ligar para ${targetLabel}`, phone: targetPhone },
          };
        }
        return {
          handled: true,
          reply:
            'Você precisa estar com uma corrida ativa atribuída para ligar diretamente pelo aplicativo.',
        };
      }

      // YouTube music/video embed on demand
      const ytPlayMatch = rawText.match(
        /(?:tocar|colocar|assistir|abrir musica|buscar video|no youtube)\s+(.+)/i
      );
      if (
        ytPlayMatch &&
        /(youtube|musica|video|clipe)/i.test(normalized) &&
        ytPlayMatch[1].trim().length >= 2
      ) {
        const query = ytPlayMatch[1].replace(/no youtube/gi, '').trim();
        return {
          handled: true,
          reply: `Preparei o reprodutor do YouTube sob demanda para "${query}". Toque abaixo se quiser abrir ou assistir aqui:`,
          youtubeEmbed: { query },
          externalLink: {
            label: `Abrir "${query}" no YouTube`,
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
          },
        };
      }

      // External quick web links (YouTube, WhatsApp, Google Search)
      if (/^(abrir|abra|ir para)\s+(o\s+)?youtube\b/.test(normalized)) {
        return {
          handled: true,
          reply: 'Aqui está o atalho seguro para abrir o YouTube:',
          externalLink: { label: 'Abrir YouTube', url: 'https://www.youtube.com' },
        };
      }
      if (/^(abrir|abra|ir para)\s+(o\s+)?whatsapp\b/.test(normalized)) {
        return {
          handled: true,
          reply: 'Aqui está o atalho seguro para abrir o WhatsApp:',
          externalLink: { label: 'Abrir WhatsApp', url: 'https://wa.me/' },
        };
      }
      const googleMatch = rawText.match(
        /(?:pesquis[ae]r?|procur[ae]r?|busc[ae]r?)\s+(?:no\s+google\s+)?(.+)/i
      );
      if (googleMatch && /google/i.test(normalized) && googleMatch[1].trim().length >= 2) {
        const query = googleMatch[1].replace(/no google/gi, '').trim();
        return {
          handled: true,
          reply: `Preparei sua pesquisa no Google para "${query}":`,
          externalLink: {
            label: `Pesquisar "${query}" no Google`,
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          },
        };
      }

      // Driver instant online/offline toggle
      if (currentUser.role === 'driver' && onMelissaToggleOnline) {
        if (/(ficar online|conectar agora|entrar online|ligar modo)/.test(normalized)) {
          const msg = await onMelissaToggleOnline(true);
          return { handled: true, reply: msg };
        }
        if (/(ficar offline|pausar corridas|desconectar agora|ficar off)/.test(normalized)) {
          const msg = await onMelissaToggleOnline(false);
          return { handled: true, reply: msg };
        }
      }

      // Admin locate online driver by name
      if (isAdmin && onMelissaLocateDriver) {
        const locMatch = rawText.match(
          /(?:localiz[ae]r?|onde\s+est[aá]|achar|encontrar)\s+(?:o\s+)?(?:motorista|entregador)?\s*(.+)/i
        );
        if (
          locMatch &&
          /(localiz|onde est|achar motorista|encontrar motorista)/i.test(normalized)
        ) {
          const targetName = locMatch[1].replace(/\bno mapa\b/gi, '').trim();
          const drv = findAdminUserByName(targetName, true);
          if (!drv) {
            return {
              handled: true,
              reply: `Não encontrei nenhum motorista com o nome "${targetName}".`,
            };
          }
          onMelissaLocateDriver(drv);
          if (
            drv.driver?.is_online &&
            typeof drv.driver.current_lat === 'number' &&
            typeof drv.driver.current_lng === 'number'
          ) {
            return {
              handled: true,
              reply: `Motorista ${drv.full_name} está ONLINE agora! Centralizei o mapa administrativo em ${drv.driver.current_lat.toFixed(5)}, ${drv.driver.current_lng.toFixed(5)} (${drv.driver.vehicle_model} · ${drv.driver.vehicle_plate}).`,
            };
          }
          return {
            handled: true,
            reply: `Encontrei ${drv.full_name} (${drv.driver?.vehicle_model || 'Veículo'}), porém está OFFLINE no momento.`,
          };
        }

        // Admin block / suspend / unblock with confirmation
        const blockMatch = rawText.match(
          /(?:bloque[ae]r?|suspender|desbloque[ae]r?|reativar)\s+(?:o\s+|a\s+)?(?:cliente|passageiro|motorista|entregador|usuario|conta\s+de)?\s*(.+)/i
        );
        if (
          blockMatch &&
          /(bloquear|bloqueie|suspender|suspenda|desbloquear|desbloqueie|reativar|reative)/.test(
            normalized
          )
        ) {
          const targetName = blockMatch[1].trim();
          const target = findAdminUserByName(targetName, false);
          if (!target) {
            return {
              handled: true,
              reply: `Não encontrei usuário com o nome "${targetName}". Informe o nome completo ou primeiro nome cadastrado.`,
            };
          }
          const shouldBlock = !/(desbloquear|desbloqueie|reativar|reative)/.test(normalized);
          setPendingConfirm({
            action: 'admin_toggle_block_user',
            summary: `${shouldBlock ? 'Bloquear' : 'Reativar'} ${target.full_name}`,
            targetUser: target,
            block: shouldBlock,
          });
          return {
            handled: true,
            reply: `Confirmação de segurança: você quer mesmo ${
              shouldBlock ? 'bloquear/suspender' : 'reativar'
            } ${target.full_name} (${
              target.role === 'driver' ? 'Motorista' : 'Cliente'
            })? Responda "Sim" para confirmar ou "Não" para cancelar.`,
          };
        }
      }

      // Passenger local quick ride/delivery call & cancel
      if (currentUser.role === 'passenger') {
        if (/(cancelar corrida|cancelar entrega|cancela a corrida)/.test(normalized)) {
          if (!activeRide) {
            return {
              handled: true,
              reply: 'Você não possui nenhuma corrida ou entrega ativa para cancelar agora.',
            };
          }
          setPendingConfirm({
            action: 'cancel_ride',
            summary: `Cancelar corrida para ${activeRide.destination_address}`,
          });
          return {
            handled: true,
            reply: `Você quer confirmar o cancelamento da corrida para "${activeRide.destination_address}"? Responda "Sim" para confirmar.`,
          };
        }

        const rideIntentMatch = rawText.match(
          /(?:cham[ae]r?|pedir|solicitar)\s+(?:um|uma)?\s*(moto|carro|pop|entrega|corrida|viagem)?\s*(?:para\s+(?:minha\s+\w+|meu\s+\w+)\s+)?(?:(?:de|do|da|saindo\s+de)\s+(.+?)\s+)?(?:para|ate|até|pro|pra)\s+(.+)/i
        );
        if (
          rideIntentMatch &&
          /(chama|chame|pedir|solicitar)/.test(normalized) &&
          /(moto|carro|pop|entrega|corrida|viagem|para |ate |até )/.test(normalized) &&
          onMelissaRequestRide
        ) {
          const vehicleToken = (rideIntentMatch[1] || '').toLowerCase();
          const originQuery = (rideIntentMatch[2] || '').trim();
          const destQuery = (rideIntentMatch[3] || '').trim();
          const category: RideCategory =
            vehicleToken === 'moto'
              ? 'moto'
              : vehicleToken === 'entrega'
              ? 'delivery_moto'
              : vehicleToken === 'carro' || vehicleToken === 'pop'
              ? 'pop'
              : 'pop';

          if (destQuery.length >= 3) {
            setPendingConfirm({
              action: 'request_ride',
              summary: `Chamar ${
                category === 'moto'
                  ? 'Moto'
                  : category === 'delivery_moto'
                  ? 'Entrega'
                  : 'Carro Pop'
              } para "${destQuery}"`,
              originQuery: originQuery || undefined,
              destQuery,
              category,
            });
            return {
              handled: true,
              reply: `Entendi! Vou preparar uma solicitação de ${
                category === 'moto'
                  ? 'Moto'
                  : category === 'delivery_moto'
                  ? 'Entrega'
                  : 'Carro Pop'
              }${originQuery ? ` saindo de "${originQuery}"` : ' da sua origem atual'} até "${destQuery}". Responda "Sim" para confirmar a chamada!`,
            };
          }
        }
      }

      // Instant greeting without touching API quota
      if (
        /^(oi|ola|bom dia|boa tarde|boa noite|e ai|tudo bem|melissa|menu|ajuda|0)$/.test(
          normalized
        )
      ) {
        return {
          handled: true,
          reply: buildWelcomeMenu(),
        };
      }

      // Option 1: Saldo / Resumo
      if (normalized === '1' || /(meu saldo|quanto tenho|carteira|gopay|resumo)/.test(normalized)) {
        if (isAdmin) {
          return {
            handled: true,
            reply: `Resumo operacional atual: ${
              adminStatsSummary || `${onlineDriversCount} motorista(s) online neste momento.`
            }\n\nSe quiser abrir a Fila Facial ao Vivo diga "2" ou pergunte sobre qualquer cliente ou motorista pelo nome.`,
          };
        }
        return {
          handled: true,
          reply: `Seu saldo disponível no GoPay é ${formatBRL(currentUser.wallet_balance)}. ${
            Number(currentUser.reserved_balance || 0) > 0
              ? `Você também possui ${formatBRL(Number(currentUser.reserved_balance || 0))} em reserva para corrida em andamento.`
              : ''
          }\n\nDiga "abrir carteira" se quiser gerenciar depósitos, transferências ou saques Pix.`,
        };
      }

      // Option 2: Active ride / Night Duty / Facial queue
      if (normalized === '2') {
        if (isAdmin) {
          setPendingConfirm({
            action: 'open_facial',
            summary: 'Abrir Fila de Reconhecimento Facial ao Vivo',
          });
          return {
            handled: true,
            reply:
              'Você quer que eu abra agora a Fila de Reconhecimento Facial ao Vivo? Responda "Sim" para confirmar.',
          };
        }
        if (currentUser.role === 'driver') {
          if (activeRide) {
            return {
              handled: true,
              reply: `Corrida/Entrega ativa: ${activeRide.origin_address} até ${activeRide.destination_address}. Valor ${formatBRL(activeRide.final_fare ?? activeRide.estimated_fare)} · Pagamento: ${activeRide.payment_method.toUpperCase()} · Status: ${activeRide.status}.`,
            };
          }
          return {
            handled: true,
            reply: `Você não tem corrida em andamento agora. Seu veículo ativo é ${currentUser.driver?.vehicle_model || 'Cadastrado'} (${currentUser.driver?.vehicle_plate || 'sem placa'}).`,
          };
        }
        return {
          handled: true,
          reply: nightDuty.isActive
            ? `Plantão Noturno da Melissa ATIVO (${nightDuty.startTime} às ${nightDuty.endTime}): neste horário, apenas Saldo da Carteira GoPay ou Dinheiro estão liberados para corridas. Depósitos Pix manuais e Pix na hora retornam às ${nightDuty.endTime}.`
            : `No momento estamos fora do Plantão Noturno (${nightDuty.startTime} às ${nightDuty.endTime}): Saldo GoPay, Pix e Dinheiro funcionam normalmente!`,
        };
      }

      // Option 3: Games 3D or Night Duty info for admin
      if (normalized === '3' || /(jogo|jogos|game|3d|brincar|passatempo)/.test(normalized)) {
        if (isAdmin) {
          return {
            handled: true,
            reply: `Plantão Noturno da Melissa configurado das ${nightDuty.startTime} às ${nightDuty.endTime} · Estado atual: ${
              nightDuty.enabled
                ? nightDuty.isActive
                  ? 'EM PLANTÃO AGORA (somente Saldo Carteira e Dinheiro)'
                  : 'Habilitado (aguardando horário noturno)'
                : 'Desativado'
            }.`,
          };
        }
        if (onOpenGames) {
          onOpenGames();
          return {
            handled: true,
            reply: 'Abri a Central com 10 Jogos 3D para você se divertir enquanto aguarda!',
          };
        }
      }

      // Option 4: Open Support / Forward to Admin
      if (
        normalized === '4' ||
        /(suporte|falar com admin|reclamacao|ajuda admin|chamar admin)/.test(normalized)
      ) {
        if (isAdmin) {
          onOpenSettings?.();
          return {
            handled: true,
            reply:
              'Você pode ajustar a Paleta Global e os scripts SQL diretamente nas abas do painel administrativo.',
          };
        }
        return {
          handled: true,
          reply:
            'Você pode digitar aqui mesmo ou enviar foto, arquivo ou sua localização GPS pelos ícones abaixo que eu encaminho direto para o Administrador.',
        };
      }

      if (/(abrir carteira|deposito|sacar pix)/.test(normalized) && onOpenWallet) {
        onOpenWallet();
        return {
          handled: true,
          reply: 'Prontinho! Abri sua carteira GoPay.',
        };
      }

      if (/(configuracoes|abrir config|meu perfil)/.test(normalized) && onOpenSettings) {
        onOpenSettings();
        return {
          handled: true,
          reply: 'Abri suas configurações agora!',
        };
      }

      // Admin destructive safety prompt
      if (isAdmin && /(excluir|deletar|apagar|remover|banir|zerar)/.test(normalized)) {
        setPendingConfirm({
          action: 'delete_prompt',
          summary: rawText.trim(),
        });
        return {
          handled: true,
          reply:
            'Atenção de segurança: você quer realmente que eu exclua/aplique essa ação crítica? Responda "Sim" para confirmar ou "Não" para cancelar.',
        };
      }

      // RBAC block for non-admin asking admin info or third-party data
      if (
        !isAdmin &&
        /(todos usuarios|aprovar motorista|sql|painel admin|faturamento da plataforma|excluir conta de|telefone do motorista|dados dos clientes)/.test(
          normalized
        )
      ) {
        return {
          handled: true,
          reply:
            'Por segurança e privacidade da Go Driver, dados de terceiros e controles administrativos ficam protegidos e disponíveis apenas dentro do Painel Administrativo autenticado. Posso te ajudar com suas próprias corridas, carteira GoPay, jogos 3D ou qualquer outra dúvida!',
        };
      }

      // Admin minimal incremental SQL quick helper
      if (
        isAdmin &&
        /(sql.*notific|notific.*sql|sql.*lida|sql.*incremental|gerar sql|sql minimo)/.test(
          normalized
        )
      ) {
        return {
          handled: true,
          reply: `Aqui está o SQL incremental mínimo e idempotente (sem recriar tabelas existentes):\n\nALTER TABLE public.app_notifications\n  ADD COLUMN IF NOT EXISTS lida BOOLEAN NOT NULL DEFAULT FALSE,\n  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;\n\nDROP POLICY IF EXISTS "app_notifications_mark_own_read" ON public.app_notifications;\nCREATE POLICY "app_notifications_mark_own_read"\n  ON public.app_notifications FOR UPDATE\n  TO authenticated\n  USING (target_scope = 'user' AND target_user_id = auth.uid())\n  WITH CHECK (target_scope = 'user' AND target_user_id = auth.uid());\n\nSe precisar de outro campo específico, me diga o nome da tabela e da coluna que gero somente o ALTER TABLE / CREATE POLICY mínimo!`,
        };
      }

      return { handled: false };
    },
    [
      activeRide,
      adminStatsSummary,
      buildWelcomeMenu,
      currentUser.driver?.vehicle_model,
      currentUser.driver?.vehicle_plate,
      currentUser.reserved_balance,
      currentUser.role,
      currentUser.wallet_balance,
      findAdminUserByName,
      isAdmin,
      nightDuty.enabled,
      nightDuty.endTime,
      nightDuty.isActive,
      nightDuty.startTime,
      onLogout,
      onMelissaCancelRide,
      onMelissaLocateDriver,
      onMelissaRequestRide,
      onMelissaToggleBlockUser,
      onMelissaToggleOnline,
      onOpenFacialQueue,
      onOpenGames,
      onOpenSettings,
      onOpenSupport,
      onOpenWallet,
      onTriggerAdminAction,
      onlineDriversCount,
      pendingConfirm,
    ]
  );

  // Admin local lookup helper when AI servers experience transient 503/429 high demand
  const tryAdminLocalDirectoryFallback = useCallback(
    (rawText: string): string | null => {
      if (!isAdmin || adminUsers.length === 0) return null;
      const clean = rawText
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const matching = adminUsers.filter((u) => {
        const nameNorm = (u.full_name || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const plateNorm = (u.driver?.vehicle_plate || '').toLowerCase();
        const phoneDigits = (u.phone || '').replace(/\D/g, '');
        const queryTokens = clean
          .split(/\s+/)
          .filter(
            (t) =>
              t.length >= 3 &&
              ![
                'quem',
                'mostre',
                'aqui',
                'ele',
                'ela',
                'veja',
                'motorista',
                'cliente',
                'passageiro',
                'qual',
                'telefone',
                'saldo',
                'dados',
                'sobre',
              ].includes(t)
          );
        return queryTokens.some(
          (tok) =>
            nameNorm.includes(tok) ||
            (plateNorm && plateNorm.includes(tok)) ||
            (phoneDigits && phoneDigits.includes(tok))
        );
      });

      if (matching.length > 0) {
        const lines = matching.slice(0, 5).map((u) => {
          const roleName =
            u.is_admin || u.role === 'admin'
              ? 'Administrador'
              : u.role === 'driver'
              ? 'Motorista/Parceiro'
              : 'Passageiro/Cliente';
          const vehInfo = u.driver
            ? `\nVeículo: ${u.driver.vehicle_model || 'N/D'} · Placa: ${u.driver.vehicle_plate || '-'} · Cor: ${u.driver.vehicle_color || '-'} · ${u.driver.is_online ? 'Online' : 'Offline'}`
            : '';
          return `• ${u.full_name} (${roleName})\nTelefone: ${u.phone || 'não informado'} · E-mail: ${u.email}\nStatus: ${u.status} · Saldo GoPay: ${formatBRL(u.wallet_balance)}${vehInfo}`;
        });
        return `Encontrei estes dados no cadastro:\n\n${lines.join('\n\n')}`;
      }

      if (/(motorista|motoristas|entregador)/.test(clean)) {
        const drivers = adminUsers.filter((u) => u.role === 'driver').slice(0, 8);
        if (drivers.length > 0) {
          return `Motoristas cadastrados (${adminUsers.filter((u) => u.role === 'driver').length} total):\n\n${drivers
            .map(
              (d) =>
                `• ${d.full_name} · ${d.phone || 'sem tel.'} · ${d.status} · Saldo ${formatBRL(d.wallet_balance)} · ${d.driver?.vehicle_model || 'Veículo'} (${d.driver?.vehicle_plate || '-'})`
            )
            .join('\n')}`;
        }
      }

      if (/(cliente|clientes|passageiro|passageiros)/.test(clean)) {
        const clients = adminUsers.filter((u) => u.role === 'passenger').slice(0, 8);
        if (clients.length > 0) {
          return `Clientes cadastrados (${adminUsers.filter((u) => u.role === 'passenger').length} total):\n\n${clients
            .map(
              (c) =>
                `• ${c.full_name} · ${c.phone || 'sem tel.'} · ${c.status} · Saldo ${formatBRL(c.wallet_balance)}`
            )
            .join('\n')}`;
        }
      }

      return null;
    },
    [adminUsers, isAdmin]
  );

  const handleSendText = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text && !pendingAttachment) return;
      if (thinking) return;

      const userMsgText =
        text || (pendingAttachment ? `Enviando anexo: ${pendingAttachment.name}` : '');
      const attachSnapshot = pendingAttachment;

      if (!overrideText) setInput('');
      setPendingAttachment(null);

      appendMessage({
        sender: 'user',
        text: userMsgText,
        attachmentName: attachSnapshot?.name,
        attachmentUrl: attachSnapshot
          ? `data:${attachSnapshot.mimeType};base64,${attachSnapshot.base64}`
          : undefined,
      });

      if (
        attachSnapshot &&
        !isAdmin &&
        /(admin|suporte|comprovante|documento|ajuda)/i.test(userMsgText)
      ) {
        try {
          const uploadedUrl = await uploadSupportAttachment(
            currentUser.id,
            attachSnapshot.name,
            `data:${attachSnapshot.mimeType};base64,${attachSnapshot.base64}`
          );
          await forwardPayloadToAdmin(userMsgText, {
            attachmentUrl: uploadedUrl,
            attachmentName: attachSnapshot.name,
            attachmentType: attachSnapshot.mimeType,
          });
        } catch {
          // Continue chat cleanly
        }
      }

      setThinking(true);
      try {
        if (!attachSnapshot) {
          const localRes = await tryLocalChatbotResponse(userMsgText);
          if (localRes.handled && localRes.reply) {
            appendMessage({
              sender: 'melissa',
              text: localRes.reply,
              externalLink: localRes.externalLink,
              phoneLink: localRes.phoneLink,
              youtubeEmbed: localRes.youtubeEmbed,
              animate: true,
            });
            setThinking(false);
            await speakReply(localRes.reply);
            return;
          }
        }

        if (quotaExhausted) {
          const adminLocal = tryAdminLocalDirectoryFallback(userMsgText);
          const fallbackMsg =
            adminLocal ||
            'O limite de cota da IA foi atingido. Você pode usar normalmente os atalhos locais abaixo (digite "menu" ou escolha 1, 2, 3 ou 4).';
          appendMessage({ sender: 'melissa', text: fallbackMsg, animate: true });
          setThinking(false);
          await speakReply(fallbackMsg);
          return;
        }

        const contextParts = [
          `Usuário logado: ${currentUser.full_name} (perfil: ${isAdmin ? 'admin' : currentUser.role})`,
          recognizedAsRikelmy
            ? 'Identificação confirmada na conversa: o usuário se identificou como Rikelmy (dono/fundador e administrador do sistema Go Driver).'
            : '',
          `Saldo carteira GoPay: ${formatBRL(currentUser.wallet_balance)}`,
          `Plantão Noturno (${nightDuty.startTime}-${nightDuty.endTime}): ${
            nightDuty.isActive
              ? 'ATIVO (Pix manual bloqueado; só Carteira GoPay e Dinheiro)'
              : 'Inativo'
          }`,
          activeRide
            ? `Corrida ativa (${activeRide.status}): ${activeRide.origin_address} -> ${activeRide.destination_address}, valor ${formatBRL(activeRide.final_fare ?? activeRide.estimated_fare)}, pagamento ${activeRide.payment_method}`
            : 'Sem corrida ativa no momento.',
          isAdmin ? `Resumo Admin: ${adminStatsSummary}` : '',
          isAdmin && adminDirectoryContext ? adminDirectoryContext : '',
        ]
          .filter(Boolean)
          .join('\n');

        const aiResult = await queryMelissaWithCloudflareFallback({
          message: userMsgText,
          role: isAdmin ? 'admin' : currentUser.role,
          appName,
          contextSummary: contextParts,
          history: messages.slice(-6).map((m) => ({ sender: m.sender, text: m.text })),
          attachment: attachSnapshot,
        });

        if (aiResult.transientHighDemand) {
          setApiDiagnostic(null);
          const adminLocal = tryAdminLocalDirectoryFallback(userMsgText);
          const friendlyMsg =
            adminLocal ||
            aiResult.message ||
            'Os servidores de IA estão com alta demanda no momento, mas continuo te atendendo pelos atalhos locais abaixo.';
          appendMessage({ sender: 'melissa', text: friendlyMsg, animate: true });
          setThinking(false);
          await speakReply(friendlyMsg);
          return;
        }

        if (aiResult.quotaExceeded) {
          setQuotaExhausted(true);
          setApiDiagnostic(aiResult.diagnosticError || null);
          const adminLocal = tryAdminLocalDirectoryFallback(userMsgText);
          const quotaMsg =
            adminLocal ||
            aiResult.message ||
            'O limite de cota da IA foi esgotado. Você pode continuar usando os atalhos locais abaixo.';
          appendMessage({ sender: 'melissa', text: quotaMsg, animate: true });
          setThinking(false);
          await speakReply(quotaMsg);
          return;
        }

        if (aiResult.missingApiKey) {
          setMissingGeminiKey(true);
          setApiDiagnostic(null);
          const adminLocal = tryAdminLocalDirectoryFallback(userMsgText);
          const keyMsg =
            adminLocal ||
            aiResult.message ||
            'Configure a variável VITE_GEMINI_API_KEY no painel da Cloudflare e faça um novo deploy para ativar a IA da Melissa.';
          appendMessage({ sender: 'melissa', text: keyMsg, animate: true });
          setThinking(false);
          await speakReply(keyMsg);
          return;
        }

        if (!aiResult.ok) {
          const adminLocal = tryAdminLocalDirectoryFallback(userMsgText);
          const reason =
            adminLocal ||
            aiResult.diagnosticError ||
            aiResult.message ||
            'Os servidores de IA estão instáveis no momento, mas continuo te atendendo pelos atalhos locais abaixo.';
          setApiDiagnostic(adminLocal ? null : aiResult.diagnosticError || reason);
          appendMessage({ sender: 'melissa', text: reason, animate: true });
          setThinking(false);
          await speakReply(reason);
          return;
        }

        setMissingGeminiKey(false);
        setApiDiagnostic(null);

        let replyText = aiResult.reply || 'Pronto! Como posso ajudar mais?';
        let externalLink: ExternalLinkCard | null | undefined = null;
        let phoneLink: { label: string; phone: string } | null | undefined = null;
        let youtubeEmbed: YouTubeEmbedInfo | null | undefined = null;

        if (aiResult.actionPayload) {
          const exec = await executeStructuredAction(
            aiResult.actionPayload,
            Boolean(aiResult.requiresConfirmation)
          );
          if (exec?.replyOverride) replyText = exec.replyOverride;
          externalLink = exec?.externalLink;
          phoneLink = exec?.phoneLink;
          youtubeEmbed = exec?.youtubeEmbed;
        } else if (aiResult.requiresConfirmation && isAdmin) {
          setPendingConfirm({
            action: 'financial_prompt',
            summary: userMsgText,
          });
        }

        appendMessage({
          sender: 'melissa',
          text: replyText,
          externalLink,
          phoneLink,
          youtubeEmbed,
          animate: true,
        });
        setThinking(false);
        await speakReply(replyText);

        if (aiResult.suggestedAction === 'open_games') onOpenGames?.();
        if (aiResult.suggestedAction === 'open_wallet') onOpenWallet?.();
      } catch {
        const offlineMsg =
          'Os servidores de IA estão com alta demanda no momento, mas continuo te atendendo pelos atalhos locais abaixo.';
        appendMessage({ sender: 'melissa', text: offlineMsg, animate: true });
        await speakReply(offlineMsg);
      } finally {
        setThinking(false);
      }
    },
    [
      activeRide,
      adminDirectoryContext,
      adminStatsSummary,
      appName,
      appendMessage,
      currentUser.full_name,
      currentUser.id,
      currentUser.role,
      currentUser.wallet_balance,
      executeStructuredAction,
      forwardPayloadToAdmin,
      input,
      isAdmin,
      messages,
      nightDuty.endTime,
      nightDuty.isActive,
      nightDuty.startTime,
      onOpenGames,
      onOpenWallet,
      pendingAttachment,
      quotaExhausted,
      recognizedAsRikelmy,
      speakReply,
      thinking,
      tryAdminLocalDirectoryFallback,
      tryLocalChatbotResponse,
    ]
  );

  // Continuous Alexa-style speech recognition loop
  const toggleAlexaContinuous = () => {
    const SpeechRec = getSpeechRecognitionConstructor();
    if (!SpeechRec) {
      appendMessage({
        sender: 'melissa',
        text: 'Este navegador não suporta reconhecimento contínuo de voz, mas você pode conversar comigo digitando ou usando os anexos abaixo!',
        animate: true,
      });
      return;
    }

    if (alexaActiveRef.current) {
      alexaActiveRef.current = false;
      setAlexaListening(false);
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      return;
    }

    alexaActiveRef.current = true;
    setAlexaListening(true);

    const startCycle = () => {
      if (!alexaActiveRef.current || !open) return;
      try {
        const rec = new SpeechRec();
        recognitionRef.current = rec;
        rec.lang = prefs.language || 'pt-BR';
        rec.continuous = false;
        rec.interimResults = false;

        rec.onresult = (ev) => {
          const results = ev.results;
          const last = results[results.length - 1];
          const transcript = last?.[0]?.transcript?.trim();
          if (transcript) {
            void handleSendText(transcript);
          }
        };

        rec.onerror = (ev) => {
          if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
            alexaActiveRef.current = false;
            setAlexaListening(false);
          }
        };

        rec.onend = () => {
          if (alexaActiveRef.current && open) {
            window.setTimeout(() => {
              if (alexaActiveRef.current && open) startCycle();
            }, 350);
          } else {
            setAlexaListening(false);
          }
        };

        rec.start();
      } catch {
        alexaActiveRef.current = false;
        setAlexaListening(false);
      }
    };

    startCycle();
  };

  const handleAttachFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      appendMessage({
        sender: 'melissa',
        text: 'Escolha uma foto ou arquivo de até 6 MB para enviar rapidamente.',
        animate: true,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const b64 = result.split(',')[1] || '';
      setPendingAttachment({
        base64: b64,
        mimeType: file.type || 'application/octet-stream',
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSendGpsToAdmin = async () => {
    const pos = await getCurrentGpsPosition();
    if (!pos) {
      appendMessage({
        sender: 'melissa',
        text: 'Não consegui ler seu GPS agora. Verifique se a localização do aparelho está ativada.',
        animate: true,
      });
      return;
    }
    const gpsText = `Localização GPS enviada: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    appendMessage({
      sender: 'user',
      text: gpsText,
      gpsCoords: { lat: pos.lat, lng: pos.lng },
    });

    if (!isAdmin) {
      try {
        await forwardPayloadToAdmin(gpsText, { gpsLat: pos.lat, gpsLng: pos.lng });
        const reply =
          'Sua localização GPS exata foi encaminhada em tempo real para o Administrador!';
        appendMessage({ sender: 'melissa', text: reply, animate: true });
        await speakReply(reply);
      } catch {
        appendMessage({
          sender: 'melissa',
          text: `Sua coordenada atual é ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}.`,
          animate: true,
        });
      }
    } else {
      appendMessage({
        sender: 'melissa',
        text: `Sua coordenada GPS atual é ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}.`,
        animate: true,
      });
    }
  };

  const handleForwardSupport = async () => {
    const lastUser = [...messages].reverse().find((m) => m.sender === 'user');
    const summary = lastUser?.text || 'Solicitação de atendimento direto pelo aplicativo.';
    try {
      let uploadedUrl: string | undefined;
      if (lastUser?.attachmentUrl && lastUser?.attachmentName) {
        uploadedUrl = await uploadSupportAttachment(
          currentUser.id,
          lastUser.attachmentName,
          lastUser.attachmentUrl
        );
      }
      await forwardPayloadToAdmin(summary, {
        attachmentUrl: uploadedUrl,
        attachmentName: lastUser?.attachmentName,
        gpsLat: lastUser?.gpsCoords?.lat ?? null,
        gpsLng: lastUser?.gpsCoords?.lng ?? null,
      });
      const okMsg =
        'Encaminhei sua mensagem agora mesmo para o Administrador! Se preferir, você também pode abrir o chat direto de Suporte pelo menu.';
      appendMessage({ sender: 'melissa', text: okMsg, animate: true });
      await speakReply(okMsg);
    } catch {
      onOpenSupport?.();
    }
  };

  const handleResetChat = () => {
    stopSpeech();
    setPendingConfirm(null);
    setPendingAttachment(null);
    setApiDiagnostic(null);
    const fresh: ChatMessage[] = [
      {
        id: `welcome-${Date.now()}`,
        sender: 'melissa',
        text: buildWelcomeMenu(),
        createdAt: new Date().toISOString(),
        animate: true,
      },
    ];
    setMessages(fresh);
    persistMelissaHistory(currentUser.id, fresh);
  };

  const extractSqlSnippet = (text: string): string | null => {
    const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]?.trim()) return fenced[1].trim();
    if (
      /\b(ALTER\s+TABLE|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|CREATE\s+POLICY|CREATE\s+OR\s+REPLACE\s+FUNCTION)\b/i.test(
        text
      )
    ) {
      const lines = text
        .split('\n')
        .filter((l) =>
          /^\s*(--|ALTER\s+TABLE|ADD\s+COLUMN|CREATE\s+|DROP\s+POLICY|ON\s+public\.|TO\s+authenticated|USING\s*\(|WITH\s+CHECK|LANGUAGE|RETURNS|SECURITY|AS\s+\$\$|DECLARE|BEGIN|END|RETURN|INSERT|UPDATE|SELECT|WHERE|AND|OR|SET|\);|\$\$)/i.test(
            l
          )
        );
      if (lines.length >= 2) return lines.join('\n').trim();
    }
    return null;
  };

  const handleCopySqlFromMsg = async (msgId: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedMsgId(msgId);
      window.setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  if (!open) return null;

  const lastMelissaMsg = [...messages].reverse().find((m) => m.sender === 'melissa');

  // Compact Minimized Floating Mode: lets user drag map & navigate app while still chatting with Melissa
  if (minimized) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[1280] flex justify-center px-3 pb-safe">
        <div className="melissa-light-shell pointer-events-auto w-full max-w-md rounded-3xl border border-[#CBD5E1] bg-white p-3 shadow-2xl melissa-color-transition">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="aurora-accent-flow flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white">
                <MelissaEmblem size={17} />
              </div>
              <div className="min-w-0">
                <p className="melissa-ink text-xs font-extrabold truncate">
                  Melissa {thinking ? '· pensando...' : speaking ? '· falando...' : '· ativa'}
                </p>
                <p className="melissa-ink-muted text-[11px] truncate">
                  {lastMelissaMsg?.text || 'Pode navegar no app enquanto conversamos'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setMinimized(false)}
                className="melissa-muted-surface melissa-ink flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0] hover:brightness-95 transition"
                title="Expandir Melissa"
                aria-label="Expandir Melissa"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="melissa-muted-surface melissa-ink flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0] hover:brightness-95 transition"
                title="Fechar Melissa"
                aria-label="Fechar Melissa"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {pendingConfirm && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSendText('Sim')}
                className="flex-1 rounded-xl bg-[#10B981] py-1.5 text-[11px] font-extrabold text-white"
              >
                Sim, confirmar
              </button>
              <button
                type="button"
                onClick={() => void handleSendText('Não')}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-[11px] font-extrabold text-white"
              >
                Não
              </button>
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5 rounded-2xl border border-[#CBD5E1] bg-[#F8FAFC] p-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSendText();
                }
              }}
              placeholder="Falar ou digitar com a Melissa..."
              className="melissa-composer-input min-w-0 flex-1 px-2.5 py-1.5 text-xs outline-none"
            />
            <button
              type="button"
              onClick={toggleAlexaContinuous}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                alexaListening ? 'bg-red-600 text-white' : 'bg-[#EFF6FF] text-[#2563EB]'
              }`}
              title="Voz"
            >
              {alexaListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              disabled={thinking || !input.trim()}
              onClick={() => void handleSendText()}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563EB] text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showCleanHero = messages.length <= 1;

  return (
    <div className="melissa-light-shell fixed inset-0 z-[1280] flex flex-col bg-white text-[#0F172A] h-[100dvh] w-screen overflow-hidden">
      {/* Clean Gemini-Inspired Top Header (NO "Fazer upgrade") */}
      <header className="melissa-surface melissa-hairline melissa-color-transition flex items-center justify-between gap-3 border-b px-4 sm:px-6 py-3 pt-safe shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="aurora-accent-flow relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-xs">
            <MelissaEmblem size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="melissa-ink font-display text-[15px] font-bold truncate leading-tight">
              Melissa
            </h2>
            <p className="melissa-ink-muted text-[11px] font-medium truncate">
              {alexaListening
                ? 'Ouvindo você...'
                : thinking
                ? 'Pensando...'
                : speaking
                ? 'Falando...'
                : recognizedAsRikelmy
                ? 'Modo Fundador · Rikelmy'
                : appName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="melissa-muted-surface melissa-hairline melissa-ink melissa-color-transition flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95"
            title="Minimizar e mexer no app"
            aria-label="Minimizar Melissa"
          >
            <Minimize2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleResetChat}
            className="melissa-muted-surface melissa-hairline melissa-ink melissa-color-transition flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95"
            title="Nova conversa"
            aria-label="Nova conversa"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              const next = saveUserPreferences({ voice_enabled: !prefs.voice_enabled });
              setPrefs(next);
              if (!next.voice_enabled) stopSpeech();
            }}
            className={`melissa-hairline melissa-color-transition flex h-9 w-9 items-center justify-center rounded-full border ${
              prefs.voice_enabled
                ? 'bg-[#EFF6FF] text-[#2563EB]'
                : 'melissa-muted-surface melissa-ink-muted'
            }`}
            aria-label={prefs.voice_enabled ? 'Silenciar voz' : 'Ativar voz'}
          >
            {prefs.voice_enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="melissa-muted-surface melissa-hairline melissa-ink melissa-color-transition flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95"
            aria-label="Fechar Melissa"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Missing Cloudflare VITE_GEMINI_API_KEY Notice */}
      {missingGeminiKey && !quotaExhausted && (
        <div className="melissa-warning-banner flex items-center gap-2 border-b px-4 py-2 text-xs font-semibold shrink-0">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
          <span>
            Chave <code className="font-mono-num font-bold">VITE_GEMINI_API_KEY</code> ausente no build da Cloudflare. Configure <code className="font-mono-num font-bold">VITE_GEMINI_API_KEY</code> na Cloudflare e faça um novo deploy após salvar.
          </span>
        </div>
      )}

      {/* Detailed API Diagnostic Banner */}
      {apiDiagnostic && !missingGeminiKey && !quotaExhausted && (
        <div className="melissa-warning-banner flex items-center justify-between gap-2 border-b px-4 py-2 text-xs font-semibold shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="break-words">{apiDiagnostic}</span>
          </div>
          <button
            type="button"
            onClick={() => setApiDiagnostic(null)}
            className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold underline"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Quota Warning Banner */}
      {quotaExhausted && (
        <div className="melissa-warning-banner flex items-center gap-2 border-b px-4 py-2 text-xs font-semibold shrink-0">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{apiDiagnostic || 'O limite de IA foi esgotado. Os atalhos locais seguem ativos.'}</span>
        </div>
      )}

      {/* Clean Light Gemini-Inspired Conversation Stream */}
      <div className="flex-1 overflow-y-auto bg-white px-4 sm:px-6 py-6 melissa-color-transition">
        <div className="mx-auto max-w-2xl space-y-6">
          {showCleanHero && (
            <div className="rounded-3xl border border-[#E2E8F0] bg-[#F8FAFC] p-5 sm:p-6 melissa-color-transition">
              <div className="flex items-center gap-2.5 text-sm font-bold text-[#2563EB]">
                <MelissaEmblem size={20} />
                <span>Olá, {firstName}!</span>
              </div>
              <h3 className="mt-1.5 font-display text-2xl font-extrabold text-[#0F172A] tracking-tight">
                Como posso te ajudar hoje?
              </h3>
              <p className="mt-1 text-xs font-medium text-[#475569]">
                Converse por voz ou texto. Posso executar ações no {appName}, abrir sites e lembrar nossa conversa aqui no aparelho.
              </p>
            </div>
          )}

          {messages.map((m) => {
            const sqlSnippet =
              m.sender === 'melissa' && isAdmin ? extractSqlSnippet(m.text) : null;

            if (m.sender === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="melissa-bubble-user melissa-color-transition max-w-[85%] sm:max-w-[75%] rounded-3xl rounded-br-md px-4 py-3 text-[15px] leading-relaxed whitespace-pre-line">
                    {m.attachmentUrl && m.attachmentUrl.startsWith('data:image') && (
                      <img
                        src={m.attachmentUrl}
                        alt={m.attachmentName || 'Anexo'}
                        className="mb-2 max-h-48 rounded-2xl object-cover border border-black/10"
                      />
                    )}
                    {m.attachmentName && !m.attachmentUrl?.startsWith('data:image') && (
                      <div className="mb-2 flex items-center gap-2 rounded-xl bg-black/5 px-2.5 py-1.5 text-xs font-semibold">
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="truncate">{m.attachmentName}</span>
                      </div>
                    )}
                    <p className="melissa-ink font-normal">{m.text}</p>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="melissa-bubble-assistant space-y-2.5 melissa-color-transition">
                <div className="flex items-center gap-2.5">
                  <div
                    className="aurora-accent-flow flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                    aria-hidden="true"
                  >
                    <MelissaEmblem size={15} />
                  </div>
                  <span className="melissa-ink text-sm font-bold tracking-tight">Melissa</span>
                </div>

                <div className="pl-9 text-[15px] leading-[1.65] melissa-ink whitespace-pre-line space-y-3">
                  <div>
                    <TypewriterText
                      text={m.text}
                      animate={Boolean(m.animate)}
                      onStep={scrollToBottom}
                    />
                  </div>

                  {m.phoneLink && (
                    <a
                      href={`tel:${m.phoneLink.phone.replace(/[^+\d]/g, '')}`}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[#10B981] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-[#059669] transition"
                    >
                      <PhoneCall className="h-4 w-4" />
                      <span>{m.phoneLink.label}</span>
                    </a>
                  )}

                  {m.youtubeEmbed && (
                    <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                        <Play className="h-3.5 w-3.5 text-red-600" />
                        <span>YouTube · {m.youtubeEmbed.query}</span>
                      </div>
                      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                        <iframe
                          title={`YouTube ${m.youtubeEmbed.query}`}
                          src={
                            m.youtubeEmbed.videoId
                              ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
                                  m.youtubeEmbed.videoId
                                )}`
                              : `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(
                                  m.youtubeEmbed.query
                                )}`
                          }
                          className="h-full w-full border-0"
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    </div>
                  )}

                  {m.externalLink && isSafeHttpsUrl(m.externalLink.url) && (
                    <div>
                      <a
                        href={m.externalLink.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2 text-xs font-extrabold text-[#1D4ED8] hover:bg-[#DBEAFE] transition"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>{m.externalLink.label}</span>
                      </a>
                    </div>
                  )}

                  {sqlSnippet && (
                    <div className="mt-3 pt-2.5 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#475569]">
                        SQL Incremental Mínimo
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopySqlFromMsg(m.id, sqlSnippet)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition shrink-0"
                      >
                        {copiedMsgId === m.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copiar SQL</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {thinking && (
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="aurora-accent-flow flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white animate-pulse">
                  <MelissaEmblem size={15} />
                </div>
                <span className="melissa-ink text-sm font-bold tracking-tight">Melissa</span>
              </div>
              <div className="pl-9 flex items-center gap-1.5 py-1">
                <span className="h-2 w-2 rounded-full bg-[#2563EB] animate-bounce" />
                <span
                  className="h-2 w-2 rounded-full bg-[#0EA5E9] animate-bounce"
                  style={{ animationDelay: '120ms' }}
                />
                <span
                  className="h-2 w-2 rounded-full bg-[#6366F1] animate-bounce"
                  style={{ animationDelay: '240ms' }}
                />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Subtle Quick Action Bar */}
      <div className="melissa-surface px-4 pt-2 pb-1 shrink-0">
        <div className="mx-auto flex max-w-2xl items-center gap-2 overflow-x-auto no-scrollbar">
          {['1', '2', '3', '4'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => void handleSendText(num)}
              className="melissa-muted-surface melissa-hairline melissa-ink melissa-color-transition rounded-full border px-3 py-1.5 text-xs font-semibold hover:brightness-95 shrink-0"
            >
              Opção {num}
            </button>
          ))}

          {pendingConfirm && (
            <>
              <button
                type="button"
                onClick={() => void handleSendText('Sim')}
                className="inline-flex items-center gap-1 rounded-full bg-[#10B981] px-3.5 py-1.5 text-xs font-bold text-white shrink-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sim, confirmar
              </button>
              <button
                type="button"
                onClick={() => void handleSendText('Não')}
                className="rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shrink-0"
              >
                Não
              </button>
            </>
          )}

          {onOpenGames && !isAdmin && (
            <button
              type="button"
              onClick={onOpenGames}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] shrink-0 transition"
            >
              <Gamepad2 className="h-3.5 w-3.5" />
              10 Jogos 3D
            </button>
          )}

          {!isAdmin && (
            <button
              type="button"
              onClick={handleForwardSupport}
              className="melissa-warning-banner inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shrink-0"
            >
              Enviar ao Suporte Admin
            </button>
          )}
        </div>
      </div>

      {/* Attachment preview */}
      {pendingAttachment && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-2 shrink-0">
          <div className="flex items-center justify-between rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-2 text-xs font-semibold text-[#1D4ED8]">
            <span className="truncate">Anexo: {pendingAttachment.name}</span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="ml-2 text-red-600 font-bold"
            >
              Remover
            </button>
          </div>
        </div>
      )}

      {/* Clean Gemini-Style Floating Composer */}
      <footer className="melissa-surface px-4 py-3 pb-safe shrink-0">
        <div className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-3xl border border-[#CBD5E1] bg-white p-1.5 shadow-sm focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/15 melissa-color-transition">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handleAttachFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,image/*"
            className="hidden"
            onChange={(e) => {
              handleAttachFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="melissa-ink-muted flex h-10 w-9 items-center justify-center rounded-full hover:bg-[#F1F5F9] shrink-0 transition"
            title="Enviar Foto"
          >
            <Camera className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="melissa-ink-muted flex h-10 w-9 items-center justify-center rounded-full hover:bg-[#F1F5F9] shrink-0 transition"
            title="Enviar Documento"
          >
            <FileText className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleSendGpsToAdmin}
            className="flex h-10 w-9 items-center justify-center rounded-full text-[#2563EB] hover:bg-[#EFF6FF] shrink-0 transition"
            title="Enviar Localização GPS"
          >
            <MapPin className="h-4 w-4" />
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSendText();
              }
            }}
            placeholder="Pergunte qualquer coisa para a Melissa..."
            className="melissa-composer-input min-w-0 flex-1 px-2 py-2 text-[15px] font-normal text-[#0F172A] outline-none"
          />

          <button
            type="button"
            onClick={toggleAlexaContinuous}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition shrink-0 ${
              alexaListening
                ? 'bg-red-600 text-white shadow-sm animate-pulse'
                : 'bg-[#F1F5F9] text-[#2563EB] hover:bg-[#EFF6FF]'
            }`}
            title={alexaListening ? 'Parar modo voz contínuo' : 'Conversar por voz contínua'}
          >
            {alexaListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            type="button"
            disabled={thinking || (!input.trim() && !pendingAttachment)}
            onClick={() => void handleSendText()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-35 active:scale-95 transition shrink-0"
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </footer>
    </div>
  );
};
