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
  const raw = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  return raw.replace(/\/+$/, '');
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

async function handleCreatePix(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = (env.MP_ACCESS_TOKEN || '').trim();
  const sbUrl = resolveSupabaseUrl(env);
  const sbServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const sbVerifyKey = sbServiceKey || (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!mpToken) {
    return jsonResponse(
      { ok: false, error: 'MP_ACCESS_TOKEN não configurado nas variáveis do Cloudflare Worker.' },
      503,
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
    return jsonResponse({ ok: false, error: 'Sessão não autenticada.' }, 401, request);
  }

  const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
    headers: {
      apikey: sbVerifyKey,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!userRes.ok) {
    return jsonResponse({ ok: false, error: 'Token de usuário inválido ou expirado.' }, 401, request);
  }
  const authUser = (await userRes.json()) as { id?: string; email?: string };
  if (!authUser?.id) {
    return jsonResponse({ ok: false, error: 'Usuário autenticado não identificado.' }, 401, request);
  }

  // Verifica se Pix Automático está habilitado no Admin
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

  const payerEmail = String(authUser.email || body.email || 'cliente@godriver.app').trim();
  const payerName = String(body.nome || 'Cliente GoDriver').trim();
  const requestOrigin = new URL(request.url).origin;
  const externalRef = `${tipo}:${authUser.id}:${corridaId || 'wallet'}:${Date.now()}`;

  const mpPayload = {
    transaction_amount: valor,
    description: isRidePix
      ? `GoDriver Corrida #${String(corridaId).slice(-4)}`
      : 'Recarga Carteira GoPay · GoDriver',
    payment_method_id: 'pix',
    external_reference: externalRef,
    notification_url: `${requestOrigin}/api/mp-webhook`,
    payer: {
      email: payerEmail,
      first_name: payerName.split(' ')[0] || 'Cliente',
      last_name: payerName.split(' ').slice(1).join(' ') || 'GoDriver',
    },
  };

  const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mpToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(mpPayload),
  });

  const mpText = await mpRes.text();
  let mpData: {
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
  } = {};
  try {
    mpData = JSON.parse(mpText) as typeof mpData;
  } catch {
    // Non-JSON response from Mercado Pago
  }

  if (!mpRes.ok || !mpData?.id) {
    const causeMsg = mpData?.cause?.[0]?.description || mpData?.message || mpData?.error;
    return jsonResponse(
      {
        ok: false,
        error: causeMsg
          ? `Mercado Pago (${mpRes.status}): ${causeMsg}`
          : `Erro ao gerar Pix no Mercado Pago (HTTP ${mpRes.status}).`,
      },
      502,
      request
    );
  }

  const mpPaymentId = String(mpData.id);
  const qrCode = mpData.point_of_interaction?.transaction_data?.qr_code || '';
  const qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || '';

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

async function handleMercadoPagoWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = (env.MP_ACCESS_TOKEN || '').trim();
  const sbUrl = resolveSupabaseUrl(env);
  const sbServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

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

  const secret = (env.MP_WEBHOOK_SECRET || '').trim();
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
          return jsonResponse(
            {
              ok: true,
              runtime: 'cloudflare-worker',
              worker: '99',
              mp_configured: Boolean((env.MP_ACCESS_TOKEN || '').trim()),
              supabase_configured: Boolean(
                resolveSupabaseUrl(env) && (env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
              ),
            },
            200,
            request
          );
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
