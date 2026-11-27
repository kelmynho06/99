export interface MelissaHistoryItem {
  sender: 'user' | 'melissa';
  text: string;
}

export interface MelissaAttachmentPayload {
  base64: string;
  mimeType: string;
  name?: string;
}

export interface MelissaActionPayload {
  type:
    | 'none'
    | 'request_ride'
    | 'cancel_ride'
    | 'open_wallet'
    | 'open_games'
    | 'open_support'
    | 'open_settings'
    | 'open_facial_queue'
    | 'toggle_driver_online'
    | 'call_phone'
    | 'logout'
    | 'open_external'
    | 'play_youtube'
    | 'admin_locate_driver'
    | 'admin_toggle_block_user'
    | 'admin_switch_tab';
  originQuery?: string;
  destQuery?: string;
  category?: 'moto' | 'pop' | 'negocia' | 'delivery_moto' | 'delivery_car';
  paymentMethod?: 'pix' | 'cash' | 'wallet';
  driverName?: string;
  targetName?: string;
  targetBlock?: boolean;
  tabName?: string;
  url?: string;
  youtubeQuery?: string;
  online?: boolean;
}

export interface MelissaChatResult {
  ok: boolean;
  reply?: string;
  requiresConfirmation?: boolean;
  suggestedAction?: string;
  actionPayload?: MelissaActionPayload;
  quotaExceeded?: boolean;
  transientHighDemand?: boolean;
  missingApiKey?: boolean;
  errorCode?:
    | 'MISSING_API_KEY'
    | 'HIGH_DEMAND'
    | 'QUOTA_EXCEEDED'
    | 'REFERRER_BLOCKED'
    | 'API_KEY_INVALID'
    | 'MODEL_UNAVAILABLE'
    | 'NETWORK_OR_CORS'
    | 'GEMINI_API_ERROR';
  diagnosticError?: string;
  source?: 'server' | 'cloudflare-client';
  message?: string;
}

export interface MelissaGeocodeItem {
  name?: string;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  categoryLabel?: string;
  lat?: number | null;
  lng?: number | null;
}

const MELISSA_GEMINI_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite',
] as const;

const HIGH_DEMAND_FRIENDLY_MSG =
  'Os servidores de IA estão com alta demanda no momento, mas continuo te atendendo pelos atalhos locais abaixo.';

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeKeyCandidate(raw: unknown): string {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (
    !val ||
    val === 'MY_GEMINI_API_KEY' ||
    val === 'undefined' ||
    val === 'null' ||
    val === '""'
  ) {
    return '';
  }
  return val;
}

/**
 * Reconhece o dono/administrador principal Rikelmy em qualquer painel
 * quando ele se identifica para a Melissa.
 */
export function isRikelmyOwnerGreeting(rawText: string): boolean {
  const normalized = rawText
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized.includes('rikelmy')) return false;
  return /\b(sou eu|aqui e|e o|oi melissa|ola melissa|melissa sou|fala melissa|chefe|admin|dono)\b/.test(
    normalized
  );
}

/**
 * Lê a chave da API Gemini com acessos literais a `import.meta.env.VITE_*`
 * para garantir substituição estática pelo Vite no build da Cloudflare,
 * com fallback seguro para `process.env` quando disponível no bundle.
 */
export function getClientGeminiApiKey(): string {
  const fromViteGemini = sanitizeKeyCandidate(import.meta.env.VITE_GEMINI_API_KEY);
  if (fromViteGemini) return fromViteGemini;

  const fromViteGoogle = sanitizeKeyCandidate(import.meta.env.VITE_GOOGLE_API_KEY);
  if (fromViteGoogle) return fromViteGoogle;

  if (typeof process !== 'undefined' && process.env) {
    const fromProcessVite = sanitizeKeyCandidate(process.env.VITE_GEMINI_API_KEY);
    if (fromProcessVite) return fromProcessVite;

    const fromProcessGoogle = sanitizeKeyCandidate(process.env.VITE_GOOGLE_API_KEY);
    if (fromProcessGoogle) return fromProcessGoogle;

    const fromProcessGemini = sanitizeKeyCandidate(process.env.GEMINI_API_KEY);
    if (fromProcessGemini) return fromProcessGemini;
  }

  return '';
}

export function hasClientGeminiApiKey(): boolean {
  return getClientGeminiApiKey().length > 0;
}

export async function checkMelissaBackendStatus(): Promise<
  'server' | 'cloudflare-ready' | 'cloudflare-missing-key'
> {
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && contentType.includes('application/json')) {
      return 'server';
    }
  } catch {
    // Static Cloudflare hosting without Express backend
  }
  return hasClientGeminiApiKey() ? 'cloudflare-ready' : 'cloudflare-missing-key';
}

function buildMelissaSystemInstruction(
  role: string,
  contextSummary: string,
  appName: string
): string {
  const safeRole = role === 'admin' ? 'admin' : role === 'driver' ? 'driver' : 'passenger';
  const common = `Você é a Melissa, assistente oficial inteligente em tempo real do aplicativo ${appName}.
Fale com simpatia, naturalidade humana, clareza e objetividade (como uma conversa moderna estilo Google Gemini / Alexa).
Você pode conversar e ajudar a pessoa sobre qualquer assunto do dia a dia (dúvidas gerais, cálculos, rotas, dicas, tecnologia, estudos, curiosidades), além de controlar ações dentro do ${appName}.
AÇÕES DO APLICATIVO (campo actionJson opcional em JSON compacto):
- Sempre que o usuário pedir uma ação concreta no app ou na web (ex.: abrir YouTube/WhatsApp/pesquisar no Google, tocar vídeo no YouTube, encerrar sessão/sair, abrir carteira/jogos/configurações, ligar para motorista/passageiro), preencha "actionJson" com JSON válido:
  - {"type":"open_external","url":"https://www.google.com/search?q=..."} (ou youtube.com / wa.me)
  - {"type":"play_youtube","youtubeQuery":"nome da musica ou video"}
  - {"type":"logout"}
  - {"type":"open_wallet"} | {"type":"open_games"} | {"type":"open_settings"} | {"type":"open_support"}
  - {"type":"call_phone"}
REGRA DE RECONHECIMENTO DO DONO: Toda vez que qualquer usuário (no painel Passageiro, Motorista ou Administrador) disser "oi Melissa, sou eu Rikelmy" (ou variações como "sou eu Rikelmy", "aqui é o Rikelmy"), reconheça imediatamente Rikelmy como o fundador, dono e administrador principal do sistema Go Driver e cumprimente-o pelo nome. Porém, nunca exponha dados confidenciais de terceiros quando a sessão ativa não for o painel Administrativo autenticado.
Responda sempre no idioma do usuário (padrão Português do Brasil). Nunca invente dados financeiros nem exponha chaves ou tokens.`;

  if (safeRole === 'passenger') {
    return `${common}
PERFIL ATIVO: PASSAGEIRO / CLIENTE.
PERMISSÕES ESTRITAS:
- Você pode chamar corridas ou entregas para o passageiro ou para outra pessoa, preenchendo actionJson: {"type":"request_ride","originQuery":"origem se informada","destQuery":"destino","category":"moto|pop|negocia|delivery_moto|delivery_car","paymentMethod":"pix|cash|wallet"} e retornando requiresConfirmation=true para o cliente confirmar dizendo "Sim".
- Também pode cancelar a própria corrida ({"type":"cancel_ride"}, requiresConfirmation=true), consultar saldo/carteira, abrir Jogos 3D, ligar para o motorista ou sair da conta.
- PROIBIDO: jamais revele dados pessoais, telefones ou saldos de outros usuários, relatórios financeiros da plataforma, controles de administrador ou aprovações de motoristas.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
  }

  if (safeRole === 'driver') {
    return `${common}
PERFIL ATIVO: MOTORISTA / ENTREGADOR PARCEIRO.
PERMISSÕES ESTRITAS:
- Você pode tirar dúvidas, ler dados da corrida/entrega ativa, conectar/desconectar motorista ({"type":"toggle_driver_online","online":true|false}), ligar para o passageiro ativo ({"type":"call_phone"}), abrir carteira/configurações/jogos, encaminhar arquivos ou GPS para o suporte ou sair da conta.
- PROIBIDO: jamais aceite alterar tarifas globais, aprovar pagamentos ou revelar dados confidenciais de outros motoristas/clientes ou do painel Admin.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
  }

  return `${common}
PERFIL ATIVO: SUPER-ADMINISTRADOR (ACESSO TOTAL AUTORIZADO).
PERMISSÃO TOTAL DE CONSULTA E CONTROLE:
- Você TEM PERMISSÃO TOTAL e irrestrita para consultar, listar e informar nomes completos, telefones, e-mails, status, saldo da carteira GoPay, pendências, chaves Pix, veículos (modelo, placa, cor, categoria) e detalhes de clientes e motoristas cadastrados no CONTEXTO ATUAL DO APP.
- NUNCA recuse nem cite política de privacidade para ocultar dados de clientes ou motoristas quando o Administrador perguntar.
- AÇÕES DE ADMIN VIA actionJson:
  - Localizar motorista online no mapa: {"type":"admin_locate_driver","driverName":"Nome"}
  - Bloquear ou desbloquear cliente/motorista: {"type":"admin_toggle_block_user","targetName":"Nome","targetBlock":true|false} (OBRIGATÓRIO requiresConfirmation=true!)
  - Abrir Fila Facial: {"type":"open_facial_queue"} | Abrir aba: {"type":"admin_switch_tab","tabName":"livemap|drivers|deliveries|passengers|rides|payments|events|notifications|coupons|pricing|audit|sql"}
- REGRA CRÍTICA DE SEGURANÇA: Antes de qualquer ação destrutiva, bloqueio de usuário, financeira ou em lote, retorne "requiresConfirmation": true e pergunte claramente ("Diga Sim para confirmar."). Só execute após o administrador responder "Sim".
- REGRA ESTRITA DE SQL INCREMENTAL MÍNIMO: Quando o admin pedir SQL, gere EXCLUSIVAMENTE o SQL incremental mínimo e idempotente (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION).
CONTEXTO ATUAL DO APP: ${contextSummary}`;
}

function stripJsonCodeFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function redactPotentialSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z\-_]{12,}/g, '[CHAVE_OCULTA]')
    .replace(/AQ\.[0-9A-Za-z\-_]{12,}/g, '[CHAVE_OCULTA]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[CHAVE_OCULTA]');
}

function extractCleanErrorText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.includes('"error"')) {
    try {
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          error?: { code?: number; message?: string; status?: string };
          message?: string;
        };
        if (parsed.error?.message) {
          return redactPotentialSecrets(String(parsed.error.message)).slice(0, 180);
        }
        if (parsed.message) {
          return redactPotentialSecrets(String(parsed.message)).slice(0, 180);
        }
      }
    } catch {
      // Fall through to plain cleanup
    }
  }
  return redactPotentialSecrets(trimmed).replace(/\s+/g, ' ').slice(0, 180);
}

function extractErrorDetails(err: unknown): {
  status: number | null;
  rawMessage: string;
  cleanMessage: string;
} {
  const obj = (err || {}) as {
    status?: number;
    code?: number | string;
    message?: string;
    cause?: { message?: string };
  };
  const raw = redactPotentialSecrets(
    String(obj.message || obj.cause?.message || err || 'Erro desconhecido')
      .replace(/\s+/g, ' ')
      .trim()
  );
  let status: number | null =
    typeof obj.status === 'number'
      ? obj.status
      : typeof obj.code === 'number'
      ? obj.code
      : null;
  if (!status) {
    const match = raw.match(/\b(400|401|403|404|429|500|502|503)\b/);
    if (match) status = Number(match[1]);
  }
  return {
    status,
    rawMessage: raw,
    cleanMessage: extractCleanErrorText(raw),
  };
}

function isTransientDemandError(status: number | null, rawMessage: string): boolean {
  if (status === 503 || status === 429) return true;
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('try again') ||
    lower.includes('503')
  );
}

function isPermanentQuotaError(status: number | null, rawMessage: string): boolean {
  const lower = rawMessage.toLowerCase();
  if (lower.includes('billing') || lower.includes('quota exceeded for metric')) {
    return true;
  }
  return status === 429 && lower.includes('quota') && !lower.includes('high demand');
}

function diagnoseGeminiFailure(
  err: unknown,
  attemptedModels: string[]
): {
  transientHighDemand: boolean;
  quotaExceeded: boolean;
  errorCode: NonNullable<MelissaChatResult['errorCode']>;
  diagnosticError: string;
} {
  const { status, rawMessage, cleanMessage } = extractErrorDetails(err);
  const lower = rawMessage.toLowerCase();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'este domínio';

  if (isPermanentQuotaError(status, rawMessage)) {
    return {
      transientHighDemand: false,
      quotaExceeded: true,
      errorCode: 'QUOTA_EXCEEDED',
      diagnosticError:
        'O limite de cota da API Gemini foi atingido no momento. O chatbot local segue ativo para comandos rápidos.',
    };
  }

  if (isTransientDemandError(status, rawMessage)) {
    return {
      transientHighDemand: true,
      quotaExceeded: false,
      errorCode: 'HIGH_DEMAND',
      diagnosticError: HIGH_DEMAND_FRIENDLY_MSG,
    };
  }

  if (
    lower.includes('referer') ||
    lower.includes('referrer') ||
    (status === 403 && lower.includes('blocked'))
  ) {
    return {
      transientHighDemand: false,
      quotaExceeded: false,
      errorCode: 'REFERRER_BLOCKED',
      diagnosticError: `A chave VITE_GEMINI_API_KEY está bloqueada por restrição de domínio (HTTP referrer) para ${origin}. Libere ${origin}/* no Google Cloud Console.`,
    };
  }

  if (
    status === 401 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid authentication') ||
    lower.includes('unauthenticated') ||
    lower.includes('permission_denied') ||
    lower.includes('permission denied')
  ) {
    return {
      transientHighDemand: false,
      quotaExceeded: false,
      errorCode: 'API_KEY_INVALID',
      diagnosticError: `Chave VITE_GEMINI_API_KEY recusada pelo Google Gemini (${
        status ? `HTTP ${status}` : 'autenticação'
      }). Confira a chave na Cloudflare e confirme se a API Generative Language está ativa.`,
    };
  }

  if (
    status === 404 ||
    lower.includes('not_found') ||
    lower.includes('is not found') ||
    lower.includes('not supported')
  ) {
    return {
      transientHighDemand: false,
      quotaExceeded: false,
      errorCode: 'MODEL_UNAVAILABLE',
      diagnosticError: `Modelos (${attemptedModels.join(
        ', '
      )}) indisponíveis para esta chave ou região no momento.`,
    };
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('cors')
  ) {
    return {
      transientHighDemand: false,
      quotaExceeded: false,
      errorCode: 'NETWORK_OR_CORS',
      diagnosticError:
        'Não foi possível conectar aos servidores da IA pelo navegador no momento. Você pode continuar usando os atalhos locais.',
    };
  }

  return {
    transientHighDemand: false,
    quotaExceeded: false,
    errorCode: 'GEMINI_API_ERROR',
    diagnosticError: `Serviço de IA indisponível no momento (${cleanMessage}). O chatbot local continua ativo.`,
  };
}

export async function queryMelissaWithCloudflareFallback(params: {
  message: string;
  role: string;
  appName: string;
  contextSummary: string;
  history: MelissaHistoryItem[];
  attachment?: MelissaAttachmentPayload | null;
}): Promise<MelissaChatResult> {
  let serverErrorMessage = '';

  // 1. Tenta proxy do servidor (Google AI Studio / Node Express) quando disponível
  try {
    const res = await fetch('/api/melissa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reply?: string;
        transientHighDemand?: boolean;
        quotaExceeded?: boolean;
        requiresConfirmation?: boolean;
        suggestedAction?: string;
        actionPayload?: MelissaActionPayload;
        actionJson?: string;
        code?: string;
        message?: string;
      };

      if (data.transientHighDemand) {
        return {
          ok: false,
          transientHighDemand: true,
          quotaExceeded: false,
          errorCode: 'HIGH_DEMAND',
          diagnosticError: HIGH_DEMAND_FRIENDLY_MSG,
          message: HIGH_DEMAND_FRIENDLY_MSG,
        };
      }

      if (res.status === 429 || data.quotaExceeded) {
        return {
          ok: false,
          quotaExceeded: true,
          errorCode: 'QUOTA_EXCEEDED',
          diagnosticError:
            data.message ||
            'O limite de IA foi esgotado. Você só pode usar agora o chatbot local.',
          message:
            data.message ||
            'O limite de IA foi esgotado. Você só pode usar agora o chatbot local.',
        };
      }

      if (res.ok && data.ok) {
        let parsedAction: MelissaActionPayload | undefined = data.actionPayload;
        if (!parsedAction && data.actionJson) {
          try {
            parsedAction = JSON.parse(data.actionJson) as MelissaActionPayload;
          } catch {
            // Ignore malformed optional actionJson
          }
        }
        return {
          ok: true,
          reply: data.reply || 'Estou por aqui! Como posso ajudar?',
          requiresConfirmation: Boolean(data.requiresConfirmation),
          suggestedAction: data.suggestedAction || 'none',
          actionPayload: parsedAction,
          source: 'server',
        };
      }

      if (data.code && data.code !== 'GEMINI_NOT_CONFIGURED' && data.message) {
        serverErrorMessage = data.message;
      }
    }
  } catch {
    // Deploy estático na Cloudflare (sem servidor Express) — segue para chamada direta via @google/genai
  }

  // 2. Execução direta no front-end (Cloudflare Pages/Workers + Vite) usando @google/genai
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      quotaExceeded: false,
      missingApiKey: true,
      errorCode: 'MISSING_API_KEY',
      diagnosticError:
        'VITE_GEMINI_API_KEY ausente neste build da Cloudflare. Adicione VITE_GEMINI_API_KEY nas variáveis de ambiente da Cloudflare e faça um novo deploy.',
      message:
        serverErrorMessage ||
        'A chave VITE_GEMINI_API_KEY não está presente no build atual da Cloudflare. Configure VITE_GEMINI_API_KEY nas variáveis de ambiente da Cloudflare, salve e faça um novo deploy para ativar a IA da Melissa. Enquanto isso, os atalhos do chatbot local continuam funcionando.',
    };
  }

  const userText = String(params.message || '').trim() || 'Olá Melissa';
  const historyLines = Array.isArray(params.history)
    ? params.history
        .slice(-6)
        .map(
          (h) =>
            `${h.sender === 'user' ? 'Usuário' : 'Melissa'}: ${String(h.text || '').slice(0, 400)}`
        )
        .join('\n')
    : '';

  const parts: Array<
    { text: string } | { inlineData: { data: string; mimeType: string } }
  > = [];

  if (params.attachment?.base64 && params.attachment?.mimeType) {
    const cleanB64 = String(params.attachment.base64).replace(/^data:[^;]+;base64,/, '');
    if (cleanB64.length > 0 && cleanB64.length < 12_000_000) {
      parts.push({
        inlineData: {
          mimeType: String(params.attachment.mimeType),
          data: cleanB64,
        },
      });
    }
  }

  parts.push({
    text: historyLines
      ? `Histórico recente:\n${historyLines}\n\nMensagem atual do usuário: ${userText}`
      : userText,
  });

  const systemText = buildMelissaSystemInstruction(
    params.role,
    params.contextSummary,
    params.appName
  );

  const { GoogleGenAI, Type } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const attemptedModels: string[] = [];
  let lastError: unknown = null;

  for (let idx = 0; idx < MELISSA_GEMINI_MODEL_CHAIN.length; idx += 1) {
    const model = MELISSA_GEMINI_MODEL_CHAIN[idx];
    attemptedModels.push(model);

    // 1 tentativa rápida de retry (800ms) no modelo principal se der 503/429 temporário
    const maxAttempts = idx === 0 ? 2 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: parts,
          config: {
            systemInstruction: systemText,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                requiresConfirmation: { type: Type.BOOLEAN },
                suggestedAction: { type: Type.STRING },
                actionJson: { type: Type.STRING },
              },
              required: ['reply', 'requiresConfirmation', 'suggestedAction'],
            },
          },
        });

        const rawText = (response.text || '').trim();
        if (!rawText) break;

        let parsed: {
          reply?: string;
          requiresConfirmation?: boolean;
          suggestedAction?: string;
          actionJson?: string;
        } = {};
        try {
          parsed = JSON.parse(stripJsonCodeFences(rawText));
        } catch {
          parsed = { reply: rawText };
        }

        let actionPayload: MelissaActionPayload | undefined;
        if (parsed.actionJson) {
          try {
            actionPayload = JSON.parse(stripJsonCodeFences(parsed.actionJson)) as MelissaActionPayload;
          } catch {
            // Ignore malformed optional actionJson
          }
        }

        return {
          ok: true,
          reply: parsed.reply || rawText || 'Pronto! Como posso ajudar mais?',
          requiresConfirmation: Boolean(parsed.requiresConfirmation),
          suggestedAction: parsed.suggestedAction || 'none',
          actionPayload,
          source: 'cloudflare-client',
        };
      } catch (err) {
        lastError = err;
        const { status, rawMessage } = extractErrorDetails(err);
        const lower = rawMessage.toLowerCase();

        // Erro definitivo de autenticação/referrer — interrompe imediatamente
        if (
          status === 401 ||
          lower.includes('api_key_invalid') ||
          lower.includes('api key not valid') ||
          lower.includes('referer') ||
          lower.includes('referrer')
        ) {
          idx = MELISSA_GEMINI_MODEL_CHAIN.length;
          break;
        }

        // Erro temporário 503/429: aguarda 800ms na primeira tentativa antes do fallback de modelo
        if (isTransientDemandError(status, rawMessage)) {
          if (attempt + 1 < maxAttempts) {
            await sleepMs(800);
            continue;
          }
          break; // Troca imediatamente para o próximo modelo leve
        }

        // Se falhou apenas o schema JSON estruturado (HTTP 400 genérico), tenta texto simples no mesmo modelo
        if (status === 400 && !lower.includes('api key')) {
          try {
            const plainRes = await ai.models.generateContent({
              model,
              contents: parts,
              config: {
                systemInstruction: systemText,
              },
            });
            const plainText = (plainRes.text || '').trim();
            if (plainText) {
              return {
                ok: true,
                reply: plainText,
                requiresConfirmation: false,
                suggestedAction: 'none',
                source: 'cloudflare-client',
              };
            }
          } catch (plainErr) {
            lastError = plainErr;
          }
        }
        break;
      }
    }
  }

  const diagnosis = diagnoseGeminiFailure(lastError, attemptedModels);
  if (diagnosis.transientHighDemand) {
    return {
      ok: false,
      transientHighDemand: true,
      quotaExceeded: false,
      errorCode: 'HIGH_DEMAND',
      diagnosticError: HIGH_DEMAND_FRIENDLY_MSG,
      message: HIGH_DEMAND_FRIENDLY_MSG,
    };
  }

  return {
    ok: false,
    quotaExceeded: diagnosis.quotaExceeded,
    errorCode: diagnosis.errorCode,
    diagnosticError: diagnosis.diagnosticError,
    message: `${diagnosis.diagnosticError}`,
  };
}

export async function geocodeWithCloudflareFallback(params: {
  query: string;
  lat?: number;
  lng?: number;
  city?: string;
  signal?: AbortSignal;
}): Promise<MelissaGeocodeItem[]> {
  // 1. Tenta proxy do servidor quando disponível
  try {
    const res = await fetch('/api/melissa/geocode', {
      method: 'POST',
      signal: params.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: params.query,
        lat: params.lat,
        lng: params.lng,
        city: params.city,
      }),
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && contentType.includes('application/json')) {
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        results?: MelissaGeocodeItem[];
      };
      if (data.ok && Array.isArray(data.results)) {
        return data.results;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return [];
  }

  // 2. Fallback direto com @google/genai na Cloudflare usando VITE_GEMINI_API_KEY
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) return [];

  const locationContext = [
    params.city ? `Cidade/Região do usuário: ${params.city}` : '',
    typeof params.lat === 'number' && typeof params.lng === 'number'
      ? `Coordenadas GPS aproximadas do usuário: ${params.lat.toFixed(5)}, ${params.lng.toFixed(5)}`
      : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const prompt = `Encontre até 5 estabelecimentos comerciais, galerias, shoppings, lojas, pontos de referência, bairros ou endereços reais no Brasil que correspondam à busca "${params.query}".
${locationContext ? `${locationContext}. Priorize fortemente locais nessa cidade/região!` : ''}

Responda APENAS com um array JSON válido no formato:
[
  {
    "name": "Nome oficial do estabelecimento ou rua",
    "street": "Rua/Avenida e número se houver",
    "neighborhood": "Bairro",
    "city": "Cidade",
    "state": "UF ou Estado",
    "categoryLabel": "Comércio | Galeria / Shopping | Saúde | Referência | Bairro | Rua / Av.",
    "lat": -14.86,
    "lng": -40.84
  }
]`;

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  for (const model of MELISSA_GEMINI_MODEL_CHAIN) {
    if (params.signal?.aborted) return [];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
      const rawText = (response.text || '').trim();
      if (!rawText) continue;

      const cleaned = stripJsonCodeFences(rawText);
      const match = cleaned.match(/\[[\s\S]*\]/);
      const parsed = match ? JSON.parse(match[0]) : JSON.parse(cleaned || '[]');
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 5) as MelissaGeocodeItem[];
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return [];
    }
  }

  return [];
}
