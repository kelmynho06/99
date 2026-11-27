export interface MelissaHistoryItem {
  sender: 'user' | 'melissa';
  text: string;
}

export interface MelissaAttachmentPayload {
  base64: string;
  mimeType: string;
  name?: string;
}

export interface MelissaChatResult {
  ok: boolean;
  reply?: string;
  requiresConfirmation?: boolean;
  suggestedAction?: string;
  quotaExceeded?: boolean;
  missingApiKey?: boolean;
  errorCode?:
    | 'MISSING_API_KEY'
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
Fale com simpatia, naturalidade humana, clareza e objetividade (como uma conversa fluida por voz estilo Alexa).
Responda sempre no idioma do usuário (padrão Português do Brasil). Nunca invente dados financeiros nem exponha chaves ou tokens.`;

  if (safeRole === 'passenger') {
    return `${common}
PERFIL ATIVO: PASSAGEIRO / CLIENTE.
PERMISSÕES ESTRITAS:
- Você pode ajudar o passageiro a consultar localização GPS atual, definir origem/destino, simular valor de corrida/entrega, escolher pagamento permitido (lembrando que durante o Plantão Noturno da Melissa 00h–07h apenas Saldo da Carteira GoPay ou Dinheiro são aceitos — Pix manual fica bloqueado), acompanhar ou cancelar a própria corrida, ou abrir Jogos 3D / Suporte ao Admin.
- PROIBIDO: jamais revele dados de outros usuários, relatórios financeiros da plataforma, controles de administrador ou aprovações de motoristas.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
  }

  if (safeRole === 'driver') {
    return `${common}
PERFIL ATIVO: MOTORISTA / ENTREGADOR PARCEIRO.
PERMISSÕES ESTRITAS:
- Você pode tirar dúvidas, ler dados da corrida/entrega ativa do motorista, explicar status online/verificação facial ao vivo, saldo/saque Pix, e encaminhar dúvidas, arquivos, fotos ou localização GPS para o suporte do Administrador.
- PROIBIDO: jamais aceite alterar tarifas globais, aprovar pagamentos ou acessar dados de outros motoristas ou do painel Admin.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
  }

  return `${common}
PERFIL ATIVO: SUPER-ADMINISTRADOR.
PERMISSÕES COMPLETAS DE SUPER-ADMIN:
- Você pode consultar e orientar comandos sobre usuários, motoristas pendentes, fila de reconhecimento facial ao vivo, corridas, depósitos Pix, saques Pix de motoristas, tarifas, eventos, paleta global, plantão noturno e scripts SQL.
- REGRA CRÍTICA DE SEGURANÇA: Antes de qualquer ação destrutiva, financeira ou em lote (excluir usuário/item, aprovar/recusar depósito ou saque, alterar tarifas em massa), retorne "requiresConfirmation": true e pergunte claramente primeiro (ex: "Você quer realmente que eu faça isso? Diga Sim para confirmar."). Só execute após o administrador responder "Sim".
- REGRA ESTRITA DE SQL INCREMENTAL MÍNIMO: Sempre que o administrador pedir para gerar, ajustar ou copiar um script SQL do banco de dados (nova coluna, tabela nova, política RLS ou função), gere EXCLUSIVAMENTE o SQL incremental mínimo e idempotente (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION). NUNCA gere o schema completo do zero nem recrie tabelas já existentes.
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

function extractErrorDetails(err: unknown): { status: number | null; rawMessage: string } {
  const obj = (err || {}) as {
    status?: number;
    code?: number | string;
    message?: string;
    cause?: { message?: string };
  };
  const raw = redactPotentialSecrets(
    String(obj.message || obj.cause?.message || err || 'Erro desconhecido').replace(/\s+/g, ' ').trim()
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
  return { status, rawMessage: raw.slice(0, 220) };
}

function isQuotaErrorObj(status: number | null, rawMessage: string): boolean {
  if (status === 429) return true;
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  );
}

function diagnoseGeminiFailure(
  err: unknown,
  attemptedModels: string[]
): {
  quotaExceeded: boolean;
  errorCode: NonNullable<MelissaChatResult['errorCode']>;
  diagnosticError: string;
} {
  const { status, rawMessage } = extractErrorDetails(err);
  const lower = rawMessage.toLowerCase();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'este domínio';

  if (isQuotaErrorObj(status, rawMessage)) {
    return {
      quotaExceeded: true,
      errorCode: 'QUOTA_EXCEEDED',
      diagnosticError:
        'Cota da API Gemini excedida no momento (HTTP 429 / RESOURCE_EXHAUSTED). O chatbot local segue ativo.',
    };
  }

  if (
    lower.includes('referer') ||
    lower.includes('referrer') ||
    (status === 403 && lower.includes('blocked'))
  ) {
    return {
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
      quotaExceeded: false,
      errorCode: 'MODEL_UNAVAILABLE',
      diagnosticError: `Modelos (${attemptedModels.join(
        ', '
      )}) indisponíveis para esta chave ou região (${rawMessage}).`,
    };
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('cors')
  ) {
    return {
      quotaExceeded: false,
      errorCode: 'NETWORK_OR_CORS',
      diagnosticError: `Falha de rede ou CORS ao chamar a API do Gemini pelo navegador (${rawMessage}).`,
    };
  }

  return {
    quotaExceeded: false,
    errorCode: 'GEMINI_API_ERROR',
    diagnosticError: `Erro na API Gemini${
      status ? ` (HTTP ${status})` : ''
    }: ${rawMessage}. O chatbot local continua disponível.`,
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
        quotaExceeded?: boolean;
        requiresConfirmation?: boolean;
        suggestedAction?: string;
        code?: string;
        message?: string;
      };

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
        return {
          ok: true,
          reply: data.reply || 'Estou por aqui! Como posso ajudar?',
          requiresConfirmation: Boolean(data.requiresConfirmation),
          suggestedAction: data.suggestedAction || 'none',
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

  for (const model of MELISSA_GEMINI_MODEL_CHAIN) {
    attemptedModels.push(model);
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
            },
            required: ['reply', 'requiresConfirmation', 'suggestedAction'],
          },
        },
      });

      const rawText = (response.text || '').trim();
      if (!rawText) continue;

      let parsed: {
        reply?: string;
        requiresConfirmation?: boolean;
        suggestedAction?: string;
      } = {};
      try {
        parsed = JSON.parse(stripJsonCodeFences(rawText));
      } catch {
        parsed = { reply: rawText };
      }

      return {
        ok: true,
        reply: parsed.reply || rawText || 'Pronto! Como posso ajudar mais?',
        requiresConfirmation: Boolean(parsed.requiresConfirmation),
        suggestedAction: parsed.suggestedAction || 'none',
        source: 'cloudflare-client',
      };
    } catch (err) {
      lastError = err;
      const { status, rawMessage } = extractErrorDetails(err);
      const lower = rawMessage.toLowerCase();
      // Se for erro definitivo de autenticação/referrer, não adianta repetir em outro modelo
      if (
        status === 401 ||
        lower.includes('api_key_invalid') ||
        lower.includes('api key not valid') ||
        lower.includes('referer') ||
        lower.includes('referrer')
      ) {
        break;
      }
      // Se falhou apenas o schema JSON estruturado (HTTP 400 genérico), tenta sem schema no mesmo modelo
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
    }
  }

  const diagnosis = diagnoseGeminiFailure(lastError, attemptedModels);
  return {
    ok: false,
    quotaExceeded: diagnosis.quotaExceeded,
    errorCode: diagnosis.errorCode,
    diagnosticError: diagnosis.diagnosticError,
    message: `${diagnosis.diagnosticError} (Comandos rápidos do chatbot local continuam ativos: digite "menu", 1, 2, 3 ou 4.)`,
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
