import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Gamepad2,
  MapPin,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
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
} from '../lib/melissaGeminiClient';
import {
  getNightDutyWindowStatus,
  sendDirectMessage,
  uploadSupportAttachment,
} from '../lib/mobilityApi';
import { speakWithMelissaNaturalVoice, stopSpeech } from '../lib/sound';
import { getUserPreferences, saveUserPreferences } from '../lib/userPrefs';
import type { PlatformConfig, Ride, UserProfile } from '../types/mobility';

interface ChatMessage {
  id: string;
  sender: 'user' | 'melissa';
  text: string;
  attachmentName?: string;
  attachmentUrl?: string;
  gpsCoords?: { lat: number; lng: number } | null;
  createdAt: string;
  animate?: boolean;
}

interface PendingAdminConfirmation {
  action: 'delete_prompt' | 'financial_prompt' | 'open_wallet' | 'open_facial' | 'open_support';
  summary: string;
}

interface MelissaAssistantModalProps {
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
}) => {
  const isAdmin = Boolean(currentUser.is_admin || currentUser.role === 'admin');
  const firstName = currentUser.full_name?.trim().split(' ')[0] || 'você';
  const appName = platformConfig?.site_name?.trim() || 'Go Driver Mobilidade';
  const nightDuty = getNightDutyWindowStatus(platformConfig);

  const [prefs, setPrefs] = useState(getUserPreferences);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [alexaListening, setAlexaListening] = useState(false);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [missingGeminiKey, setMissingGeminiKey] = useState(false);
  const [apiDiagnostic, setApiDiagnostic] = useState<string | null>(null);
  const [recognizedAsRikelmy, setRecognizedAsRikelmy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirmation | null>(null);
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
      return `Olá, ${firstName}! Sou a Melissa.\n\nEstou pronta no Painel Administrativo para conversar sobre qualquer assunto, consultar dados completos de clientes e motoristas ou executar atalhos rápidos:\n1. Resumo operacional e financeiro\n2. Fila de reconhecimento facial ao vivo\n3. Status do Plantão Noturno (${nightDuty.startTime} às ${nightDuty.endTime})\n4. Configurações, Paleta e SQL`;
    }
    if (currentUser.role === 'driver') {
      return `Olá, ${firstName}! Sou a Melissa, sua assistente na ${appName}.\n\nPodemos conversar sobre qualquer coisa ou usar um atalho:\n1. Meu saldo GoPay e saques Pix\n2. Status da corrida/entrega ativa\n3. Abrir Central com 10 Jogos 3D\n4. Enviar mensagem, foto ou GPS ao Suporte`;
    }
    return `Olá, ${firstName}! Sou a Melissa da ${appName}.\n\nPosso conversar e ajudar você com qualquer dúvida ou usar um atalho rápido:\n1. Ver meu saldo GoPay (${formatBRL(currentUser.wallet_balance)})\n2. Regras de pagamento e Plantão Noturno\n3. Jogar na Central com 10 Jogos 3D\n4. Enviar mensagem, foto ou GPS para o Suporte`;
  }, [appName, currentUser.role, currentUser.wallet_balance, firstName, isAdmin, nightDuty.endTime, nightDuty.startTime]);

  useEffect(() => {
    if (!open) {
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

    setMessages((prev) =>
      prev.length > 0
        ? prev
        : [
            {
              id: 'welcome-melissa',
              sender: 'melissa',
              text: buildWelcomeMenu(),
              createdAt: new Date().toISOString(),
              animate: true,
            },
          ]
    );
    return () => {
      cancelled = true;
    };
  }, [buildWelcomeMenu, open]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, thinking, scrollToBottom]);

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
      ...prev,
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

  // Local instant rule engine (zero AI quota consumed!)
  const tryLocalChatbotResponse = useCallback(
    async (rawText: string): Promise<{ handled: boolean; reply?: string }> => {
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
          const action = pendingConfirm.action;
          setPendingConfirm(null);
          if (action === 'open_wallet' && onOpenWallet) {
            onOpenWallet();
            return {
              handled: true,
              reply: 'Confirmado! Abri a sua carteira GoPay.',
            };
          }
          if (action === 'open_facial' && onOpenFacialQueue) {
            onOpenFacialQueue();
            return {
              handled: true,
              reply: 'Confirmado! Abrindo a Fila de Reconhecimento Facial ao Vivo agora.',
            };
          }
          if (action === 'open_support' && onOpenSupport) {
            onOpenSupport();
            return {
              handled: true,
              reply: 'Confirmado! Abri o chat de suporte direto.',
            };
          }
          if (onTriggerAdminAction) {
            onTriggerAdminAction(pendingConfirm.summary);
          }
          return {
            handled: true,
            reply: `Confirmado! ${pendingConfirm.summary} — verifique os detalhes na tela correspondente do painel para concluir com segurança.`,
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

      // Admin destructive safety prompt
      if (isAdmin && /(excluir|deletar|apagar|remover|banir|suspender|zerar)/.test(normalized)) {
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
      isAdmin,
      nightDuty.enabled,
      nightDuty.endTime,
      nightDuty.isActive,
      nightDuty.startTime,
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
        const replyText = aiResult.reply || 'Pronto! Como posso ajudar mais?';
        if (aiResult.requiresConfirmation && isAdmin) {
          setPendingConfirm({
            action: 'financial_prompt',
            summary: userMsgText,
          });
        }
        appendMessage({ sender: 'melissa', text: replyText, animate: true });
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
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'melissa',
        text: buildWelcomeMenu(),
        createdAt: new Date().toISOString(),
        animate: true,
      },
    ]);
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

  return (
    <div className="melissa-light-shell fixed inset-0 z-[1280] flex flex-col bg-white text-[#0F172A] h-[100dvh] w-screen overflow-hidden">
      {/* Minimal Modern Gemini-Inspired Top Header */}
      <header className="melissa-surface melissa-hairline flex items-center justify-between gap-3 border-b px-4 sm:px-6 py-3 pt-safe shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] via-[#0EA5E9] to-[#6366F1] text-white shadow-xs">
            <Sparkles className="h-4 w-4" />
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
            onClick={handleResetChat}
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95 transition"
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
            className={`melissa-hairline flex h-9 w-9 items-center justify-center rounded-full border transition ${
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
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-9 w-9 items-center justify-center rounded-full border hover:brightness-95 transition"
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

      {/* Detailed API Diagnostic Banner (Only for non-transient key/config issues) */}
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

      {/* Clean Modern Gemini-Style Conversation Stream */}
      <div className="flex-1 overflow-y-auto bg-white px-4 sm:px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {messages.map((m) => {
            const sqlSnippet =
              m.sender === 'melissa' && isAdmin ? extractSqlSnippet(m.text) : null;

            if (m.sender === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="melissa-bubble-user max-w-[85%] sm:max-w-[75%] rounded-3xl rounded-br-md px-4 py-3 text-[15px] leading-relaxed whitespace-pre-line">
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
              <div key={m.id} className="melissa-bubble-assistant space-y-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] via-[#0EA5E9] to-[#6366F1] text-white"
                    aria-hidden="true"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <span className="melissa-ink text-sm font-bold tracking-tight">Melissa</span>
                </div>

                <div className="pl-9 text-[15px] leading-[1.65] melissa-ink whitespace-pre-line">
                  <TypewriterText
                    text={m.text}
                    animate={Boolean(m.animate)}
                    onStep={scrollToBottom}
                  />

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
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] via-[#0EA5E9] to-[#6366F1] text-white animate-pulse">
                  <Sparkles className="h-3.5 w-3.5" />
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
              className="melissa-muted-surface melissa-hairline melissa-ink rounded-full border px-3 py-1.5 text-xs font-semibold hover:brightness-95 shrink-0 transition"
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
        <div className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-3xl border border-[#CBD5E1] bg-white p-1.5 shadow-sm focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/15 transition">
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
