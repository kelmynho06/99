import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
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
  getNightDutyWindowStatus,
  sendDirectMessage,
  uploadSupportAttachment,
} from '../lib/mobilityApi';
import {
  ASSISTANT_VOICE_PRESETS,
  listAvailableMelissaVoices,
  speakWithMelissaNaturalVoice,
  stopSpeech,
} from '../lib/sound';
import { getUserPreferences, saveUserPreferences } from '../lib/userPrefs';
import type { AssistantVoiceId, PlatformConfig, Ride, UserProfile } from '../types/mobility';

interface ChatMessage {
  id: string;
  sender: 'user' | 'melissa';
  text: string;
  attachmentName?: string;
  attachmentUrl?: string;
  gpsCoords?: { lat: number; lng: number } | null;
  createdAt: string;
  badge?: string;
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

export const MelissaAssistantModal: React.FC<MelissaAssistantModalProps> = ({
  open,
  currentUser,
  platformConfig,
  activeRide,
  onlineDriversCount = 0,
  adminStatsSummary = '',
  onClose,
  onOpenGames,
  onOpenWallet,
  onOpenSupport,
  onOpenSettings,
  onOpenFacialQueue,
  onTriggerAdminAction,
}) => {
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
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirmation | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    base64: string;
    mimeType: string;
    name: string;
  } | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const alexaActiveRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const buildWelcomeMenu = useCallback((): string => {
    if (currentUser.role === 'admin' || currentUser.is_admin) {
      return `Olá, ${firstName}! Sou a Melissa em tempo real no Painel Administrativo.\n\nAtalhos rápidos (responda o número ou fale comigo):\n1. Resumo operacional e financeiro\n2. Ver fila de reconhecimento facial ao vivo\n3. Status do Plantão Noturno (${nightDuty.startTime} às ${nightDuty.endTime})\n4. Abrir Configurações / Paleta / SQL\n\nPara alterações críticas ou exclusões, sempre vou confirmar com você ("Sim") antes de executar.`;
    }
    if (currentUser.role === 'driver') {
      return `Olá, ${firstName}! Sou a Melissa, sua assistente na ${appName}.\n\nComo posso ajudar agora?\n1. Ver meu saldo GoPay e saques Pix\n2. Status da corrida/entrega ativa\n3. Abrir Central com 10 Jogos 3D\n4. Enviar mensagem, foto ou GPS direto para o Administrador\n\nPode falar normalmente estilo Alexa ou usar o chat abaixo.`;
    }
    return `Olá, ${firstName}! Sou a Melissa da ${appName}.\n\nAtalhos instantâneos:\n1. Ver meu saldo GoPay (${formatBRL(currentUser.wallet_balance)})\n2. Regras de pagamento & Plantão Noturno\n3. Jogar na Central com 10 Jogos 3D\n4. Enviar mensagem, foto ou GPS para o Suporte / Admin\n\nSe preferir, toque no microfone para conversar comigo sem parar!`;
  }, [appName, currentUser.is_admin, currentUser.role, currentUser.wallet_balance, firstName, nightDuty.endTime, nightDuty.startTime]);

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

    setBrowserVoices(listAvailableMelissaVoices());
    setMessages((prev) =>
      prev.length > 0
        ? prev
        : [
            {
              id: 'welcome-melissa',
              sender: 'melissa',
              text: buildWelcomeMenu(),
              createdAt: new Date().toISOString(),
              badge: 'Chatbot Local Rápido',
            },
          ]
    );
  }, [buildWelcomeMenu, open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const speakReply = useCallback(
    async (text: string) => {
      if (!getUserPreferences().voice_enabled) return;
      setSpeaking(true);
      try {
        await speakWithMelissaNaturalVoice(text, { interrupt: true });
      } finally {
        setSpeaking(false);
      }
    },
    []
  );

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
    async (contentText: string, extra?: {
      attachmentUrl?: string | null;
      attachmentName?: string | null;
      attachmentType?: string | null;
      gpsLat?: number | null;
      gpsLng?: number | null;
    }) => {
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

  // Local instant WhatsApp-style rule engine (zero AI quota consumed!)
  const tryLocalChatbotResponse = useCallback(
    async (
      rawText: string
    ): Promise<{ handled: boolean; reply?: string; badge?: string }> => {
      const normalized = rawText
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

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
              badge: 'Ação Confirmada',
            };
          }
          if (action === 'open_facial' && onOpenFacialQueue) {
            onOpenFacialQueue();
            return {
              handled: true,
              reply: 'Confirmado! Abrindo a Fila de Reconhecimento Facial ao Vivo agora.',
              badge: 'Ação Confirmada',
            };
          }
          if (action === 'open_support' && onOpenSupport) {
            onOpenSupport();
            return {
              handled: true,
              reply: 'Confirmado! Abri o chat de suporte direto.',
              badge: 'Ação Confirmada',
            };
          }
          if (onTriggerAdminAction) {
            onTriggerAdminAction(pendingConfirm.summary);
          }
          return {
            handled: true,
            reply: `Confirmado! ${pendingConfirm.summary} — verifique os detalhes na tela correspondente do painel para concluir com segurança.`,
            badge: 'Super-Admin Confirmado',
          };
        }
        if (/^(nao|n|cancela|cancelar|deixa|parar)$/.test(normalized)) {
          setPendingConfirm(null);
          return {
            handled: true,
            reply: 'Tudo bem, cancelei essa solicitação. Nenhuma alteração foi feita.',
            badge: 'Cancelado',
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
          badge: 'Chatbot Local · Zero Cota',
        };
      }

      // Option 1: Saldo / Resumo
      if (normalized === '1' || /(meu saldo|quanto tenho|carteira|gopay|resumo)/.test(normalized)) {
        if (currentUser.role === 'admin' || currentUser.is_admin) {
          return {
            handled: true,
            reply: `Resumo operacional atual: ${adminStatsSummary || `${onlineDriversCount} motorista(s) online neste momento.`}\n\nSe quiser abrir a Fila Facial ao Vivo diga "2" ou abra pelo topo.`,
            badge: 'Admin Instantâneo',
          };
        }
        return {
          handled: true,
          reply: `Seu saldo disponível no GoPay é ${formatBRL(currentUser.wallet_balance)}. ${
            Number(currentUser.reserved_balance || 0) > 0
              ? `Você também possui ${formatBRL(Number(currentUser.reserved_balance || 0))} em reserva para corrida em andamento.`
              : ''
          }\n\nDiga "abrir carteira" se quiser gerenciar depósitos, transferências ou saques Pix.`,
          badge: 'Saldo Instantâneo',
        };
      }

      // Option 2: Active ride / Night Duty / Facial queue
      if (normalized === '2') {
        if (currentUser.role === 'admin' || currentUser.is_admin) {
          setPendingConfirm({
            action: 'open_facial',
            summary: 'Abrir Fila de Reconhecimento Facial ao Vivo',
          });
          return {
            handled: true,
            reply: 'Você quer que eu abra agora a Fila de Reconhecimento Facial ao Vivo? Responda "Sim" para confirmar.',
            badge: 'Confirmação Admin',
          };
        }
        if (currentUser.role === 'driver') {
          if (activeRide) {
            return {
              handled: true,
              reply: `Corrida/Entrega ativa: ${activeRide.origin_address} até ${activeRide.destination_address}. Valor ${formatBRL(activeRide.final_fare ?? activeRide.estimated_fare)} · Pagamento: ${activeRide.payment_method.toUpperCase()} · Status: ${activeRide.status}.`,
              badge: 'Corrida Ativa',
            };
          }
          return {
            handled: true,
            reply: `Você não tem corrida em andamento agora. Seu veículo ativo é ${currentUser.driver?.vehicle_model || 'Cadastrado'} (${currentUser.driver?.vehicle_plate || 'sem placa'}).`,
            badge: 'Status Motorista',
          };
        }
        return {
          handled: true,
          reply: nightDuty.isActive
            ? `Plantão Noturno da Melissa ATIVO (${nightDuty.startTime} às ${nightDuty.endTime}): neste horário, apenas Saldo da Carteira GoPay ou Dinheiro estão liberados para corridas. Depósitos Pix manuais e Pix na hora retornam às ${nightDuty.endTime}.`
            : `No momento estamos fora do Plantão Noturno (${nightDuty.startTime} às ${nightDuty.endTime}): Saldo GoPay, Pix e Dinheiro funcionam normalmente!`,
          badge: 'Plantão Noturno',
        };
      }

      // Option 3: Games 3D or Night Duty info for admin
      if (normalized === '3' || /(jogo|jogos|game|3d|brincar|passatempo)/.test(normalized)) {
        if (currentUser.role === 'admin' || currentUser.is_admin) {
          return {
            handled: true,
            reply: `Plantão Noturno da Melissa configurado das ${nightDuty.startTime} às ${nightDuty.endTime} · Estado atual: ${
              nightDuty.enabled
                ? nightDuty.isActive
                  ? 'EM PLANTÃO AGORA (somente Saldo Carteira e Dinheiro)'
                  : 'Habilitado (aguardando horário noturno)'
                : 'Desativado'
            }.`,
            badge: 'Plantão Noturno',
          };
        }
        if (onOpenGames) {
          onOpenGames();
          return {
            handled: true,
            reply: 'Abri a Central com 10 Jogos 3D para você se divertir enquanto aguarda!',
            badge: 'Central 3D',
          };
        }
      }

      // Option 4: Open Support / Forward to Admin
      if (normalized === '4' || /(suporte|falar com admin|reclamacao|ajuda admin|chamar admin)/.test(normalized)) {
        if (currentUser.role === 'admin' || currentUser.is_admin) {
          onOpenSettings?.();
          return {
            handled: true,
            reply: 'Você pode ajustar a Paleta Global, SQL Incremental/Completo e Voz Padrão diretamente nas abas do painel.',
            badge: 'Painel Admin',
          };
        }
        return {
          handled: true,
          reply:
            'Você pode digitar aqui mesmo ou enviar foto, arquivo ou sua localização GPS pelos ícones abaixo que eu encaminho direto para o Administrador (ou abrir o chat completo de Suporte na barra de ações).',
          badge: 'Suporte Direto',
        };
      }

      if (/(abrir carteira|deposito|sacar pix)/.test(normalized) && onOpenWallet) {
        onOpenWallet();
        return {
          handled: true,
          reply: 'Prontinho! Abri sua carteira GoPay.',
          badge: 'Atalho Local',
        };
      }

      // Admin destructive safety prompt
      if (
        (currentUser.role === 'admin' || currentUser.is_admin) &&
        /(excluir|deletar|apagar|remover|banir|suspender|zerar)/.test(normalized)
      ) {
        setPendingConfirm({
          action: 'delete_prompt',
          summary: rawText.trim(),
        });
        return {
          handled: true,
          reply:
            'Atenção de segurança: você quer realmente que eu exclua/aplique essa ação crítica? Responda "Sim" para confirmar ou "Não" para cancelar.',
          badge: 'Confirmação Obrigatória',
        };
      }

      // RBAC block for non-admin asking admin info
      if (
        currentUser.role !== 'admin' &&
        !currentUser.is_admin &&
        /(todos usuarios|aprovar motorista|sql|painel admin|faturamento da plataforma|excluir conta de)/.test(
          normalized
        )
      ) {
        return {
          handled: true,
          reply:
            'Por segurança e privacidade da Go Driver, essa função é exclusiva do Administrador. Posso te ajudar com suas próprias corridas, carteira GoPay, jogos 3D ou encaminhar uma solicitação ao Suporte.',
          badge: 'Segurança RBAC',
        };
      }

      // Admin minimal incremental SQL quick helper
      if (
        (currentUser.role === 'admin' || currentUser.is_admin) &&
        /(sql.*notific|notific.*sql|sql.*lida|sql.*incremental|gerar sql|sql minimo)/.test(
          normalized
        )
      ) {
        return {
          handled: true,
          reply: `Aqui está o SQL incremental mínimo e idempotente (sem recriar tabelas existentes):\n\nALTER TABLE public.app_notifications\n  ADD COLUMN IF NOT EXISTS lida BOOLEAN NOT NULL DEFAULT FALSE,\n  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;\n\nDROP POLICY IF EXISTS "app_notifications_mark_own_read" ON public.app_notifications;\nCREATE POLICY "app_notifications_mark_own_read"\n  ON public.app_notifications FOR UPDATE\n  TO authenticated\n  USING (target_scope = 'user' AND target_user_id = auth.uid())\n  WITH CHECK (target_scope = 'user' AND target_user_id = auth.uid());\n\nSe precisar de outro campo específico, me diga o nome da tabela e da coluna que gero somente o ALTER TABLE / CREATE POLICY mínimo!`,
          badge: 'SQL Incremental Mínimo',
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
      currentUser.is_admin,
      currentUser.role,
      currentUser.wallet_balance,
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

      // If user attached a file/photo and is passenger/driver, also let them forward to Admin if requested
      if (attachSnapshot && currentUser.role !== 'admin' && /(admin|suporte|comprovante|documento|ajuda)/i.test(userMsgText)) {
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
              badge: localRes.badge || 'Chatbot Local',
            });
            setThinking(false);
            await speakReply(localRes.reply);
            return;
          }
        }

        if (quotaExhausted) {
          const fallbackMsg =
            'O limite de IA foi esgotado. Você só pode usar agora o chatbot local. Digite "menu" ou escolha 1, 2, 3 ou 4.';
          appendMessage({ sender: 'melissa', text: fallbackMsg, badge: 'Chatbot Local' });
          setThinking(false);
          await speakReply(fallbackMsg);
          return;
        }

        const contextParts = [
          `Usuário: ${currentUser.full_name} (${currentUser.role})`,
          `Saldo carteira GoPay: ${formatBRL(currentUser.wallet_balance)}`,
          `Plantão Noturno (${nightDuty.startTime}-${nightDuty.endTime}): ${
            nightDuty.isActive ? 'ATIVO (Pix manual bloqueado; só Carteira GoPay e Dinheiro)' : 'Inativo'
          }`,
          activeRide
            ? `Corrida ativa (${activeRide.status}): ${activeRide.origin_address} -> ${activeRide.destination_address}, valor ${formatBRL(activeRide.final_fare ?? activeRide.estimated_fare)}, pagamento ${activeRide.payment_method}`
            : 'Sem corrida ativa no momento.',
          currentUser.role === 'admin' || currentUser.is_admin ? `Resumo Admin: ${adminStatsSummary}` : '',
        ]
          .filter(Boolean)
          .join(' | ');

        const res = await fetch('/api/melissa/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMsgText,
            role: currentUser.is_admin ? 'admin' : currentUser.role,
            appName,
            contextSummary: contextParts,
            history: messages.slice(-6).map((m) => ({ sender: m.sender, text: m.text })),
            attachment: attachSnapshot,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          reply?: string;
          quotaExceeded?: boolean;
          requiresConfirmation?: boolean;
          suggestedAction?: string;
          message?: string;
        };

        if (res.status === 429 || data.quotaExceeded) {
          setQuotaExhausted(true);
          const quotaMsg = 'O limite de IA foi esgotado. Você só pode usar agora o chatbot local.';
          appendMessage({ sender: 'melissa', text: quotaMsg, badge: 'Limite Atingido · Modo Local' });
          setThinking(false);
          await speakReply(quotaMsg);
          return;
        }

        if (!res.ok || !data.ok) {
          const fallback =
            data.message ||
            'Estou operando no chatbot local no momento. Digite "menu" ou envie um número de 1 a 4.';
          appendMessage({ sender: 'melissa', text: fallback, badge: 'Modo Local' });
          setThinking(false);
          await speakReply(fallback);
          return;
        }

        const replyText = data.reply || 'Pronto! Como posso ajudar mais?';
        if (data.requiresConfirmation && (currentUser.role === 'admin' || currentUser.is_admin)) {
          setPendingConfirm({
            action: 'financial_prompt',
            summary: userMsgText,
          });
        }
        appendMessage({ sender: 'melissa', text: replyText, badge: 'Melissa IA' });
        setThinking(false);
        await speakReply(replyText);

        if (data.suggestedAction === 'open_games') onOpenGames?.();
        if (data.suggestedAction === 'open_wallet') onOpenWallet?.();
      } catch {
        const offlineMsg =
          'Sem resposta da IA externa no momento — você pode usar todos os atalhos locais (digite "menu", 1, 2, 3 ou 4).';
        appendMessage({ sender: 'melissa', text: offlineMsg, badge: 'Chatbot Local' });
        await speakReply(offlineMsg);
      } finally {
        setThinking(false);
      }
    },
    [
      activeRide,
      adminStatsSummary,
      appName,
      appendMessage,
      currentUser.full_name,
      currentUser.id,
      currentUser.is_admin,
      currentUser.role,
      currentUser.wallet_balance,
      forwardPayloadToAdmin,
      input,
      messages,
      nightDuty.endTime,
      nightDuty.isActive,
      nightDuty.startTime,
      onOpenGames,
      onOpenWallet,
      pendingAttachment,
      quotaExhausted,
      speakReply,
      thinking,
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
        badge: 'Aviso de Áudio',
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
        badge: 'Anexo',
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
        badge: 'GPS',
      });
      return;
    }
    const gpsText = `Localização GPS enviada: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
    appendMessage({
      sender: 'user',
      text: gpsText,
      gpsCoords: { lat: pos.lat, lng: pos.lng },
    });

    if (currentUser.role !== 'admin' && !currentUser.is_admin) {
      try {
        await forwardPayloadToAdmin(gpsText, { gpsLat: pos.lat, gpsLng: pos.lng });
        const reply =
          'Sua localização GPS exata foi encaminhada em tempo real para o Administrador!';
        appendMessage({ sender: 'melissa', text: reply, badge: 'GPS Encaminhado' });
        await speakReply(reply);
      } catch {
        appendMessage({
          sender: 'melissa',
          text: `Sua coordenada atual é ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}.`,
          badge: 'GPS Local',
        });
      }
    } else {
      appendMessage({
        sender: 'melissa',
        text: `Sua coordenada GPS atual como Admin é ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}.`,
        badge: 'GPS',
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
        'Encaminhei sua mensagem agora mesmo para o Administrador com sua identificação! Se preferir, você também pode abrir o chat direto de Suporte pelo menu.';
      appendMessage({ sender: 'melissa', text: okMsg, badge: 'Enviado ao Admin' });
      await speakReply(okMsg);
    } catch {
      onOpenSupport?.();
    }
  };

  const handleResetChat = () => {
    stopSpeech();
    setPendingConfirm(null);
    setPendingAttachment(null);
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'melissa',
        text: buildWelcomeMenu(),
        createdAt: new Date().toISOString(),
        badge: 'Chatbot Local Rápido',
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

  const roleLabel =
    currentUser.is_admin || currentUser.role === 'admin'
      ? 'Administrador'
      : currentUser.role === 'driver'
      ? 'Parceiro'
      : 'Passageiro';

  return (
    <div className="melissa-light-shell fixed inset-0 z-[1280] flex flex-col bg-[#F8FAFC] text-[#0F172A] h-[100dvh] w-screen overflow-hidden">
      {/* Top Clean Bright Header */}
      <header
        className="melissa-surface melissa-hairline flex items-center justify-between gap-2 border-b border-[#E2E8F0] px-4 py-3 pt-safe shrink-0 shadow-xs"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--color-tint, #EFF6FF) 55%, #FFFFFF) 0%, #FFFFFF 100%)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white transition ${
              alexaListening || speaking ? 'aurora-accent-flow scale-105' : 'aurora-accent-flow'
            }`}
          >
            <Bot className="h-5 w-5" />
            {(alexaListening || speaking) && (
              <span
                className="absolute -inset-1 rounded-2xl border-2 animate-ping opacity-45"
                style={{ borderColor: 'var(--color-glow, #0EA5E9)' }}
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="melissa-ink font-display text-base font-extrabold truncate">
                Melissa
              </h2>
              <span className="melissa-ink-muted text-xs font-semibold shrink-0">
                · {roleLabel}
              </span>
            </div>
            <p className="melissa-ink-muted text-[11px] font-medium truncate">
              {alexaListening
                ? 'Ouvindo continuamente estilo Alexa...'
                : speaking
                ? 'Falando com você agora...'
                : quotaExhausted
                ? 'Modo chatbot local ativo'
                : 'Assistente inteligente em tempo real'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleResetChat}
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-10 w-10 items-center justify-center rounded-xl border hover:brightness-95 transition"
            title="Nova conversa"
            aria-label="Nova conversa"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowVoicePanel((v) => !v)}
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-10 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold hover:brightness-95 transition"
            title="Escolher Voz da Melissa"
          >
            <Sparkles className="h-4 w-4" style={{ color: 'var(--color-primary, #2563EB)' }} />
            <span className="hidden sm:inline">Voz</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = saveUserPreferences({ voice_enabled: !prefs.voice_enabled });
              setPrefs(next);
              if (!next.voice_enabled) stopSpeech();
            }}
            className={`melissa-hairline flex h-10 w-10 items-center justify-center rounded-xl border transition ${
              prefs.voice_enabled
                ? 'bg-[#EFF6FF]'
                : 'melissa-muted-surface melissa-ink-muted'
            }`}
            style={
              prefs.voice_enabled
                ? {
                    backgroundColor: 'var(--color-tint, #EFF6FF)',
                    color: 'var(--color-primary, #2563EB)',
                    borderColor: 'color-mix(in srgb, var(--color-primary, #2563EB) 28%, transparent)',
                  }
                : undefined
            }
            aria-label={prefs.voice_enabled ? 'Silenciar voz' : 'Ativar voz'}
          >
            {prefs.voice_enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-10 w-10 items-center justify-center rounded-full border hover:brightness-95 transition"
            aria-label="Fechar Melissa"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Collapsible Voice Selection Drawer */}
      {showVoicePanel && (
        <div className="melissa-surface melissa-hairline border-b px-4 py-3 space-y-2.5 shrink-0 shadow-xs">
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-extrabold tracking-wide"
              style={{ color: 'var(--color-primary, #2563EB)' }}
            >
              Personalizar Voz da Melissa
            </span>
            <button
              type="button"
              onClick={() => setShowVoicePanel(false)}
              className="melissa-ink-muted text-xs font-bold hover:underline"
            >
              Ocultar
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ASSISTANT_VOICE_PRESETS.map((preset) => {
              const active = (prefs.assistant_voice_id || 'melissa-maps') === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    const next = saveUserPreferences({
                      assistant_voice_id: preset.id as AssistantVoiceId,
                    });
                    setPrefs(next);
                    void speakReply(`Olá! Esta é a minha voz ${preset.label}.`);
                  }}
                  className="rounded-xl border p-2.5 text-left transition"
                  style={
                    active
                      ? {
                          borderColor: 'var(--color-primary, #2563EB)',
                          backgroundColor: 'var(--color-tint, #EFF6FF)',
                        }
                      : {
                          borderColor: '#E2E8F0',
                          backgroundColor: '#F8FAFC',
                        }
                  }
                >
                  <p className="melissa-ink text-xs font-extrabold">{preset.label}</p>
                  <p className="melissa-ink-muted text-[11px] mt-0.5 line-clamp-2">
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>
          {browserVoices.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="melissa-ink-muted text-xs font-bold shrink-0">
                Voz do aparelho:
              </label>
              <select
                value={prefs.assistant_voice_name || ''}
                onChange={(e) => {
                  const next = saveUserPreferences({ assistant_voice_name: e.target.value });
                  setPrefs(next);
                }}
                className="flex-1 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-semibold text-[#0F172A]"
              >
                <option value="">Automática (Melissa Neural / Maps)</option>
                {browserVoices.slice(0, 12).map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Quota Warning Banner */}
      {quotaExhausted && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 shrink-0">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
          <span>O limite de IA foi esgotado. Você só pode usar agora o chatbot local.</span>
        </div>
      )}

      {/* Bright, High-Contrast Messenger Conversation Area */}
      <div
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4"
        style={{
          background:
            'radial-gradient(circle at top center, color-mix(in srgb, var(--color-tint, #EFF6FF) 42%, #F8FAFC) 0%, #F8FAFC 55%)',
        }}
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m) => {
            const sqlSnippet =
              m.sender === 'melissa' && (currentUser.role === 'admin' || currentUser.is_admin)
                ? extractSqlSnippet(m.text)
                : null;
            const timeLabel = new Date(m.createdAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={m.id}
                className={`flex items-end gap-2.5 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.sender === 'melissa' && (
                  <div
                    className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow-xs aurora-accent-flow"
                    aria-hidden="true"
                  >
                    <Bot className="h-4 w-4" />
                  </div>
                )}

                <div
                  className={`max-w-[88%] sm:max-w-[76%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed whitespace-pre-line ${
                    m.sender === 'user'
                      ? 'aurora-accent-flow text-white rounded-br-sm shadow-md'
                      : 'melissa-surface melissa-hairline melissa-ink border rounded-bl-sm shadow-xs'
                  }`}
                >
                  {m.sender === 'melissa' && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#64748B]">
                      <span
                        className="font-extrabold"
                        style={{ color: 'var(--color-primary, #2563EB)' }}
                      >
                        Melissa
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{timeLabel}</span>
                      {m.badge && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{m.badge}</span>
                        </>
                      )}
                    </div>
                  )}

                  {m.attachmentUrl && m.attachmentUrl.startsWith('data:image') && (
                    <img
                      src={m.attachmentUrl}
                      alt={m.attachmentName || 'Anexo'}
                      className="mb-2 max-h-48 rounded-xl object-cover border border-black/10"
                    />
                  )}

                  {m.attachmentName && !m.attachmentUrl?.startsWith('data:image') && (
                    <div className="mb-2 flex items-center gap-2 rounded-xl bg-black/5 px-2.5 py-1.5 text-xs font-bold">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">{m.attachmentName}</span>
                    </div>
                  )}

                  <p className={m.sender === 'user' ? 'text-white' : 'melissa-ink'}>{m.text}</p>

                  {sqlSnippet && (
                    <div className="mt-3 pt-2.5 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-[#475569]">
                        SQL Incremental Mínimo pronto para o Supabase
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopySqlFromMsg(m.id, sqlSnippet)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold text-white aurora-accent-flow shrink-0"
                      >
                        {copiedMsgId === m.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Copiado!</span>
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

                  {m.sender === 'user' && (
                    <p className="mt-1 text-right font-mono-num text-[10px] text-white/80">
                      {timeLabel}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {thinking && (
            <div className="flex justify-start items-center gap-2.5">
              <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white aurora-accent-flow">
                <Bot className="h-4 w-4" />
              </div>
              <div className="melissa-surface melissa-hairline melissa-ink-muted rounded-2xl border px-4 py-2.5 text-xs font-bold shadow-xs">
                Melissa está preparando a resposta...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="melissa-surface melissa-hairline border-t px-3 py-2 shrink-0">
        <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-x-auto no-scrollbar">
          {['1', '2', '3', '4'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => void handleSendText(num)}
              className="melissa-muted-surface melissa-hairline melissa-ink rounded-xl border px-3 py-1.5 text-xs font-bold hover:brightness-95 shrink-0 transition"
            >
              Opção {num}
            </button>
          ))}

          {pendingConfirm && (
            <>
              <button
                type="button"
                onClick={() => void handleSendText('Sim')}
                className="inline-flex items-center gap-1 rounded-xl bg-[#10B981] px-3 py-1.5 text-xs font-extrabold text-white shrink-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sim, confirmar
              </button>
              <button
                type="button"
                onClick={() => void handleSendText('Não')}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-extrabold text-white shrink-0"
              >
                Não
              </button>
            </>
          )}

          {onOpenGames && currentUser.role !== 'admin' && !currentUser.is_admin && (
            <button
              type="button"
              onClick={onOpenGames}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold shrink-0 transition"
              style={{
                backgroundColor: 'var(--color-tint, #EFF6FF)',
                color: 'var(--color-primary, #2563EB)',
                borderColor: 'color-mix(in srgb, var(--color-primary, #2563EB) 28%, transparent)',
              }}
            >
              <Gamepad2 className="h-3.5 w-3.5" />
              10 Jogos 3D
            </button>
          )}

          {currentUser.role !== 'admin' && !currentUser.is_admin && (
            <button
              type="button"
              onClick={handleForwardSupport}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-extrabold text-amber-900 shrink-0"
            >
              Enviar ao Suporte Admin
            </button>
          )}
        </div>
      </div>

      {/* Attachment preview */}
      {pendingAttachment && (
        <div
          className="border-t px-4 py-2 flex items-center justify-between text-xs font-bold shrink-0"
          style={{
            backgroundColor: 'var(--color-tint, #EFF6FF)',
            borderColor: '#E2E8F0',
            color: 'var(--color-primary, #2563EB)',
          }}
        >
          <span className="truncate">Anexo pronto: {pendingAttachment.name}</span>
          <button
            type="button"
            onClick={() => setPendingAttachment(null)}
            className="ml-2 text-red-600 font-extrabold"
          >
            Remover
          </button>
        </div>
      )}

      {/* Bright Clean Composer + Alexa Mic */}
      <footer className="melissa-surface melissa-hairline border-t px-3 py-3 pb-safe shrink-0">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
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
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-11 w-10 items-center justify-center rounded-xl border hover:brightness-95 shrink-0 transition"
            title="Enviar Foto"
          >
            <Camera className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="melissa-muted-surface melissa-hairline melissa-ink flex h-11 w-10 items-center justify-center rounded-xl border hover:brightness-95 shrink-0 transition"
            title="Enviar Documento"
          >
            <FileText className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleSendGpsToAdmin}
            className="melissa-muted-surface melissa-hairline flex h-11 w-10 items-center justify-center rounded-xl border hover:brightness-95 shrink-0 transition"
            style={{ color: 'var(--color-primary, #2563EB)' }}
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
            placeholder="Converse com a Melissa ou digite 1, 2, 3..."
            className="min-w-0 flex-1 rounded-2xl border border-[#CBD5E1] bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white transition"
          />

          <button
            type="button"
            onClick={toggleAlexaContinuous}
            className={`flex h-11 w-11 items-center justify-center rounded-2xl transition shrink-0 ${
              alexaListening ? 'bg-red-600 text-white shadow-md animate-pulse' : 'border'
            }`}
            style={
              alexaListening
                ? undefined
                : {
                    backgroundColor: 'var(--color-tint, #EFF6FF)',
                    borderColor: 'color-mix(in srgb, var(--color-primary, #2563EB) 28%, transparent)',
                    color: 'var(--color-primary, #2563EB)',
                  }
            }
            title={alexaListening ? 'Parar modo Alexa' : 'Ativar microfone contínuo estilo Alexa'}
          >
            {alexaListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          <button
            type="button"
            disabled={thinking || (!input.trim() && !pendingAttachment)}
            onClick={() => void handleSendText()}
            className="aurora-accent-flow flex h-11 w-11 items-center justify-center rounded-2xl text-white disabled:opacity-45 active:scale-95 transition shrink-0"
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </footer>
    </div>
  );
};
