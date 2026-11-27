/// <reference lib="webworker" />

interface WorkerEnv {
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  ASSETS?: {
    fetch: (req: Request) => Promise<Response>;
  };
}

const DEFAULT_SUPABASE_URL = 'https://qonemlkgaoxolajrcnha.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mx8M_cWJw-UAyMgg1ddt6Q_qJucyBsY';

function cleanCredential(raw?: string): string {
  let val = (raw || '').trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  if (val.startsWith('{{') && val.endsWith('}}')) {
    val = val.slice(2, -2).trim();
  }
  return val;
}

function isMercadoPagoPublicKey(token: string): boolean {
  // Public Key no Mercado Pago usa formato UUID: APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return /^(APP_USR|TEST)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    token
  );
}

function resolveAllowedCorsOrigin(request?: Request): string | null {
  if (!request) return null;
  const origin = (request.headers.get('Origin') || '').trim();
  if (!origin) return null;

  try {
    const reqOrigin = new URL(request.url).origin;
    if (origin === reqOrigin) return origin;
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.workers.dev') ||
      host.endsWith('.pages.dev') ||
      origin === 'capacitor://localhost' ||
      origin === 'ionic://localhost'
    ) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function buildCorsHeaders(request?: Request): Record<string, string> {
  const allowedOrigin = resolveAllowedCorsOrigin(request);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function jsonResponse(body: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...buildCorsHeaders(request),
    },
  });
}

function resolveSupabaseUrl(env: WorkerEnv): string {
  const raw = cleanCredential(env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL);
  return raw
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/auth\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}

async function authenticateSupabaseUser(
  sbUrl: string,
  jwt: string,
  env: WorkerEnv,
  sbServiceKey: string
): Promise<{ id?: string; email?: string } | null> {
  const candidateKeys = Array.from(
    new Set(
      [
        cleanCredential(env.SUPABASE_ANON_KEY),
        cleanCredential(env.VITE_SUPABASE_ANON_KEY),
        DEFAULT_SUPABASE_PUBLISHABLE_KEY,
        sbServiceKey,
      ].filter(Boolean)
    )
  );

  for (const apiKey of candidateKeys) {
    try {
      const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${jwt}`,
        },
      });
      if (userRes.ok) {
        const authUser = (await userRes.json()) as { id?: string; email?: string };
        if (authUser?.id) return authUser;
      }
    } catch {
      // Try next apikey candidate
    }
  }
  return null;
}

function resolveValidPayerEmail(rawEmail: unknown, userId: string): string {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && !email.endsWith('.local')) {
    return email;
  }
  return `pagador.${userId.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'cliente'}@godriver.com.br`;
}

async function verifyMercadoPagoWebhookSignature(
  secret: string,
  xSignature: string,
  xRequestId: string,
  dataId: string
): Promise<boolean> {
  if (!secret) return true;
  if (!xSignature || !dataId) return false;
  const parts = Object.fromEntries(
    xSignature.split(',').map((kv) => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv.trim(), ''];
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId || ''};ts:${ts};`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(manifest));
  const computedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedHex.toLowerCase() === v1.toLowerCase();
}

interface MpPaymentCreateResult {
  ok: boolean;
  status: number;
  data: {
    id?: number | string;
    status?: string;
    message?: string;
    error?: string;
    cause?: Array<{ code?: string | number; description?: string }>;
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
      };
    };
  };
  errorMessage?: string;
}

async function callMercadoPagoCreatePayment(
  mpToken: string,
  payload: Record<string, unknown>
): Promise<MpPaymentCreateResult> {
  const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mpToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const mpText = await mpRes.text();
  let mpData: MpPaymentCreateResult['data'] = {};
  try {
    mpData = JSON.parse(mpText) as MpPaymentCreateResult['data'];
  } catch {
    // Non-JSON response from Mercado Pago
  }

  const causeDesc = (mpData?.cause || [])
    .map((c) => [c.code ? `[${c.code}]` : '', c.description || ''].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ');
  const errorMessage = causeDesc || mpData?.message || mpData?.error || '';

  return {
    ok: mpRes.ok && Boolean(mpData?.id),
    status: mpRes.status,
    data: mpData,
    errorMessage,
  };
}

async function handleCreatePix(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = cleanCredential(env.MP_ACCESS_TOKEN);
  const sbUrl = resolveSupabaseUrl(env);
  const sbServiceKey = cleanCredential(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!mpToken) {
    return jsonResponse(
      { ok: false, error: 'MP_ACCESS_TOKEN não configurado nas variáveis do Cloudflare Worker.' },
      503,
      request
    );
  }
  if (isMercadoPagoPublicKey(mpToken)) {
    return jsonResponse(
      {
        ok: false,
        error:
          'A variável MP_ACCESS_TOKEN no Cloudflare está com a Chave Pública (Public Key UUID) em vez do Access Token secreto. No painel do Mercado Pago (Credenciais de produção), copie o campo "Access Token" (começa com APP_USR- seguido de números) e salve em MP_ACCESS_TOKEN no Cloudflare.',
      },
      400,
      request
    );
  }
  if (!sbUrl || !sbServiceKey) {
    return jsonResponse(
      {
        ok: false,
        error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no Cloudflare Worker.',
      },
      503,
      request
    );
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonResponse({ ok: false, error: 'Sessão não autenticada. Faça login novamente.' }, 401, request);
  }

  const authUser = await authenticateSupabaseUser(sbUrl, jwt, env, sbServiceKey);
  if (!authUser?.id) {
    return jsonResponse({ ok: false, error: 'Token de usuário inválido ou expirado. Faça login novamente.' }, 401, request);
  }

  const cfgRes = await fetch(
    `${sbUrl}/rest/v1/platform_settings?id=eq.1&select=mp_auto_pix_enabled`,
    {
      headers: {
        apikey: sbServiceKey,
        Authorization: `Bearer ${sbServiceKey}`,
      },
    }
  );
  if (cfgRes.ok) {
    const cfgRows = (await cfgRes.json()) as Array<{ mp_auto_pix_enabled?: boolean }>;
    if (cfgRows[0] && cfgRows[0].mp_auto_pix_enabled === false) {
      return jsonResponse(
        { ok: false, error: 'Pix Automático está desativado pelo Administrador no momento.' },
        403,
        request
      );
    }
  }

  let body: {
    tipo?: string;
    valor?: number;
    corrida_id?: string | null;
    email?: string;
    nome?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ ok: false, error: 'Payload JSON inválido.' }, 400, request);
  }

  const isRidePix = body.tipo === 'corrida' || body.tipo === 'pagamento_corrida';
  const tipo = isRidePix ? 'pagamento_corrida' : 'recarga_carteira';
  const valor = Number(Number(body.valor || 0).toFixed(2));
  if (!Number.isFinite(valor) || valor < 1 || valor > 25000) {
    return jsonResponse(
      { ok: false, error: 'Informe um valor entre R$ 1,00 e R$ 25.000,00.' },
      400,
      request
    );
  }

  const corridaId = isRidePix && body.corrida_id ? String(body.corrida_id).trim() : null;
  if (isRidePix && !corridaId) {
    return jsonResponse(
      { ok: false, error: 'corrida_id é obrigatório para pagamento de corrida via Pix.' },
      400,
      request
    );
  }

  const payerEmail = resolveValidPayerEmail(authUser.email || body.email, authUser.id);
  const cleanName = String(body.nome || 'Cliente GoDriver').replace(/[^\p{L}\s]/gu, '').trim() || 'Cliente GoDriver';
  const nameParts = cleanName.split(/\s+/).filter(Boolean);
  const requestOrigin = new URL(request.url).origin;
  const externalRef = `${tipo}:${authUser.id}:${corridaId || 'wallet'}:${Date.now()}`;

  const mpPayload: Record<string, unknown> = {
    transaction_amount: valor,
    description: isRidePix
      ? `GoDriver Corrida #${String(corridaId).slice(-4)}`
      : 'Recarga Carteira GoPay · GoDriver',
    payment_method_id: 'pix',
    external_reference: externalRef,
    payer: {
      email: payerEmail,
      first_name: nameParts[0] || 'Cliente',
      last_name: nameParts.slice(1).join(' ') || 'GoDriver',
    },
  };
  if (requestOrigin.startsWith('https://')) {
    mpPayload.notification_url = `${requestOrigin}/api/mp-webhook`;
  }

  let mpAttempt = await callMercadoPagoCreatePayment(mpToken, mpPayload);

  // Se o próprio dono da conta Mercado Pago testar pagando com o mesmo e-mail da conta vendedora,
  // o Mercado Pago recusa ("same user / collector cannot pay"). Fazemos 1 retry com alias neutro.
  if (
    !mpAttempt.ok &&
    mpAttempt.status === 400 &&
    /same|collector|payer|yourself|mesmo|próprio/i.test(mpAttempt.errorMessage || '')
  ) {
    const neutralEmail = `pagador.${authUser.id.replace(/[^a-z0-9]/gi, '').slice(0, 10)}@godriver.com.br`;
    mpAttempt = await callMercadoPagoCreatePayment(mpToken, {
      ...mpPayload,
      payer: {
        email: neutralEmail,
        first_name: nameParts[0] || 'Cliente',
        last_name: nameParts.slice(1).join(' ') || 'GoDriver',
      },
    });
  }

  if (!mpAttempt.ok) {
    const isAuthErr = mpAttempt.status === 401 || mpAttempt.status === 403;
    return jsonResponse(
      {
        ok: false,
        error: isAuthErr
          ? `Credencial MP_ACCESS_TOKEN recusada pelo Mercado Pago (HTTP ${mpAttempt.status}). Verifique se você salvou o Access Token de Produção (não a Public Key) nos segredos do Cloudflare Worker.`
          : mpAttempt.errorMessage
          ? `Mercado Pago (${mpAttempt.status}): ${mpAttempt.errorMessage}`
          : `Erro ao gerar Pix no Mercado Pago (HTTP ${mpAttempt.status}).`,
      },
      502,
      request
    );
  }

  const mpData = mpAttempt.data;
  const mpPaymentId = String(mpData.id);
  const qrCode = mpData.point_of_interaction?.transaction_data?.qr_code || '';
  const qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || '';

  if (!qrCode && !qrCodeBase64) {
    return jsonResponse(
      {
        ok: false,
        error:
          'O Mercado Pago criou o pagamento mas não retornou o QR Code Pix. Verifique no app do Mercado Pago se sua conta possui uma Chave Pix ativa cadastrada.',
      },
      502,
      request
    );
  }

  const insertRes = await fetch(`${sbUrl}/rest/v1/pagamentos_pix`, {
    method: 'POST',
    headers: {
      apikey: sbServiceKey,
      Authorization: `Bearer ${sbServiceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      usuario_id: authUser.id,
      corrida_id: corridaId,
      tipo,
      metodo_confirmacao: 'mercadopago_auto',
      mp_payment_id: mpPaymentId,
      valor,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      status: 'pendente',
    }),
  });

  const insertRawText = await insertRes.text();
  let insertedRows: Array<{ id?: string }> = [];
  let insertErrMsg = '';
  try {
    const parsed = JSON.parse(insertRawText) as Array<{ id?: string }> | { message?: string; hint?: string };
    if (Array.isArray(parsed)) {
      insertedRows = parsed;
    } else if (parsed && typeof parsed === 'object' && parsed.message) {
      insertErrMsg = parsed.message;
    }
  } catch {
    insertErrMsg = insertRawText.slice(0, 180);
  }

  const inserted = insertedRows[0] || null;
  if (!insertRes.ok || !inserted?.id) {
    return jsonResponse(
      {
        ok: false,
        error: insertErrMsg
          ? `Pix gerado no Mercado Pago, mas o Supabase recusou o registro em pagamentos_pix: ${insertErrMsg}. Execute o SQL incremental atualizado.`
          : 'Pix criado no Mercado Pago, mas falhou ao registrar em pagamentos_pix. Execute o SQL incremental atualizado.',
      },
      500,
      request
    );
  }

  return jsonResponse(
    {
      ok: true,
      id: inserted.id,
      tipo,
      mp_payment_id: mpPaymentId,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      valor,
      status: 'pendente',
    },
    200,
    request
  );
}

async function handleSyncPixStatus(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = cleanCredential(env.MP_ACCESS_TOKEN);
  const sbUrl = resolveSupabaseUrl(env);
  const sbServiceKey = cleanCredential(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!mpToken || !sbUrl || !sbServiceKey) {
    return jsonResponse({ ok: false, error: 'Configuração incompleta no Worker.' }, 503, request);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonResponse({ ok: false, error: 'Sessão não autenticada.' }, 401, request);
  }

  const authUser = await authenticateSupabaseUser(sbUrl, jwt, env, sbServiceKey);
  if (!authUser?.id) {
    return jsonResponse({ ok: false, error: 'Sessão inválida.' }, 401, request);
  }

  let body: { pagamento_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido.' }, 400, request);
  }
  const pagamentoId = String(body.pagamento_id || '').trim();
  if (!pagamentoId) {
    return jsonResponse({ ok: false, error: 'pagamento_id é obrigatório.' }, 400, request);
  }

  const rowRes = await fetch(
    `${sbUrl}/rest/v1/pagamentos_pix?id=eq.${encodeURIComponent(pagamentoId)}&select=id,usuario_id,mp_payment_id,status&limit=1`,
    {
      headers: {
        apikey: sbServiceKey,
        Authorization: `Bearer ${sbServiceKey}`,
      },
    }
  );
  if (!rowRes.ok) {
    return jsonResponse({ ok: false, error: 'Falha ao consultar pagamentos_pix.' }, 500, request);
  }
  const rows = (await rowRes.json()) as Array<{
    id: string;
    usuario_id: string;
    mp_payment_id?: string | null;
    status: string;
  }>;
  const row = rows[0];
  if (!row) {
    return jsonResponse({ ok: false, error: 'Pagamento não encontrado.' }, 404, request);
  }
  if (row.usuario_id !== authUser.id) {
    return jsonResponse({ ok: false, error: 'Acesso negado a este pagamento.' }, 403, request);
  }
  if (row.status === 'aprovado') {
    return jsonResponse({ ok: true, status: 'aprovado' }, 200, request);
  }
  if (!row.mp_payment_id) {
    return jsonResponse({ ok: true, status: row.status }, 200, request);
  }

  const mpRes = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(row.mp_payment_id)}`,
    {
      headers: { Authorization: `Bearer ${mpToken}` },
    }
  );
  if (!mpRes.ok) {
    return jsonResponse({ ok: true, status: row.status }, 200, request);
  }
  const mpPayment = (await mpRes.json()) as { status?: string; id?: string | number };
  if (mpPayment.status === 'approved') {
    await fetch(`${sbUrl}/rest/v1/rpc/process_mercadopago_pix_approved`, {
      method: 'POST',
      headers: {
        apikey: sbServiceKey,
        Authorization: `Bearer ${sbServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_mp_payment_id: String(mpPayment.id || row.mp_payment_id) }),
    });
    return jsonResponse({ ok: true, status: 'aprovado' }, 200, request);
  }

  return jsonResponse({ ok: true, status: row.status }, 200, request);
}

async function handleMercadoPagoWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = cleanCredential(env.MP_ACCESS_TOKEN);
  const sbUrl = resolveSupabaseUrl(env);
  const sbServiceKey = cleanCredential(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!mpToken || !sbUrl || !sbServiceKey) {
    return jsonResponse(
      { ok: false, error: 'Configuração do servidor incompleta.' },
      503,
      request
    );
  }

  const url = new URL(request.url);
  let body: { type?: string; topic?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Query param notifications may have empty JSON body
  }

  const rawId =
    body?.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '';
  const paymentId = String(rawId || '').trim();
  const eventType = String(body?.type || body?.topic || url.searchParams.get('topic') || '');

  if (!paymentId || (eventType && eventType !== 'payment')) {
    return jsonResponse({ ok: true, ignored: true }, 200, request);
  }

  const secret = cleanCredential(env.MP_WEBHOOK_SECRET);
  if (secret) {
    const valid = await verifyMercadoPagoWebhookSignature(
      secret,
      request.headers.get('x-signature') || '',
      request.headers.get('x-request-id') || '',
      paymentId
    );
    if (!valid) {
      return jsonResponse({ ok: false, error: 'Assinatura webhook inválida.' }, 401, request);
    }
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${mpToken}`,
    },
  });
  if (!mpRes.ok) {
    return jsonResponse(
      { ok: false, error: 'Não foi possível validar pagamento no Mercado Pago.' },
      502,
      request
    );
  }
  const mpPayment = (await mpRes.json()) as { status?: string; id?: number | string };

  if (mpPayment.status === 'approved') {
    const rpcRes = await fetch(`${sbUrl}/rest/v1/rpc/process_mercadopago_pix_approved`, {
      method: 'POST',
      headers: {
        apikey: sbServiceKey,
        Authorization: `Bearer ${sbServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_mp_payment_id: String(mpPayment.id || paymentId) }),
    });
    if (!rpcRes.ok) {
      const errTxt = await rpcRes.text().catch(() => '');
      return jsonResponse(
        { ok: false, error: `Falha ao confirmar Pix no Supabase: ${errTxt.slice(0, 160)}` },
        500,
        request
      );
    }
  } else if (mpPayment.status === 'cancelled' || mpPayment.status === 'rejected') {
    await fetch(
      `${sbUrl}/rest/v1/pagamentos_pix?mp_payment_id=eq.${encodeURIComponent(paymentId)}&status=eq.pendente`,
      {
        method: 'PATCH',
        headers: {
          apikey: sbServiceKey,
          Authorization: `Bearer ${sbServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelado' }),
      }
    );
  }

  return jsonResponse({ ok: true, status: mpPayment.status || 'processed' }, 200, request);
}

async function handleHealthCheck(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = cleanCredential(env.MP_ACCESS_TOKEN);
  const sbUrl = resolveSupabaseUrl(env);
  const sbServiceKey = cleanCredential(env.SUPABASE_SERVICE_ROLE_KEY);
  const webhookSecret = cleanCredential(env.MP_WEBHOOK_SECRET);

  const mpConfigured = Boolean(mpToken);
  const mpIsPublicKey = mpConfigured && isMercadoPagoPublicKey(mpToken);

  let pagamentosPixReachable = false;
  let supabaseHost = '';
  try {
    supabaseHost = sbUrl ? new URL(sbUrl).hostname : '';
  } catch {
    supabaseHost = '';
  }

  if (sbUrl && sbServiceKey) {
    try {
      const probe = await fetch(`${sbUrl}/rest/v1/pagamentos_pix?select=id&limit=1`, {
        headers: {
          apikey: sbServiceKey,
          Authorization: `Bearer ${sbServiceKey}`,
        },
      });
      pagamentosPixReachable = probe.ok;
    } catch {
      pagamentosPixReachable = false;
    }
  }

  return jsonResponse(
    {
      ok: true,
      runtime: 'cloudflare-worker',
      worker: 'godriver-mobilidade',
      mp_configured: mpConfigured,
      mp_token_format_ok: mpConfigured && !mpIsPublicKey,
      mp_key_looks_like_public_key: mpIsPublicKey,
      webhook_secret_configured: Boolean(webhookSecret),
      supabase_configured: Boolean(sbUrl && sbServiceKey),
      supabase_url_host: supabaseHost,
      pagamentos_pix_reachable: pagamentosPixReachable,
    },
    200,
    request
  );
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: buildCorsHeaders(request),
        });
      }

      try {
        if (pathname === '/api/mp-create-pix') {
          if (request.method !== 'POST') {
            return jsonResponse({ ok: false, error: 'Use POST para /api/mp-create-pix.' }, 405, request);
          }
          return await handleCreatePix(request, env);
        }

        if (pathname === '/api/mp-sync-payment') {
          if (request.method !== 'POST') {
            return jsonResponse({ ok: false, error: 'Use POST para /api/mp-sync-payment.' }, 405, request);
          }
          return await handleSyncPixStatus(request, env);
        }

        if (pathname === '/api/mp-webhook') {
          if (request.method === 'GET') {
            return jsonResponse({ ok: true, endpoint: '/api/mp-webhook' }, 200, request);
          }
          if (request.method !== 'POST') {
            return jsonResponse({ ok: false, error: 'Método não permitido.' }, 405, request);
          }
          return await handleMercadoPagoWebhook(request, env);
        }

        if (pathname === '/api/health') {
          return await handleHealthCheck(request, env);
        }

        return jsonResponse({ ok: false, error: 'Endpoint de API não encontrado.' }, 404, request);
      } catch (err) {
        return jsonResponse(
          {
            ok: false,
            error: err instanceof Error ? err.message : 'Erro interno no Worker GoDriver.',
          },
          500,
          request
        );
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
