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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
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
  const sbUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const sbServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const sbVerifyKey = sbServiceKey || (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!mpToken) {
    return jsonResponse(
      { ok: false, error: 'MP_ACCESS_TOKEN não configurado no Cloudflare Worker.' },
      503
    );
  }
  if (!sbUrl || !sbServiceKey) {
    return jsonResponse(
      { ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no Worker.' },
      503
    );
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonResponse({ ok: false, error: 'Sessão não autenticada.' }, 401);
  }

  const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
    headers: {
      apikey: sbVerifyKey,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!userRes.ok) {
    return jsonResponse({ ok: false, error: 'Token de usuário inválido ou expirado.' }, 401);
  }
  const authUser = (await userRes.json()) as { id?: string; email?: string };
  if (!authUser?.id) {
    return jsonResponse({ ok: false, error: 'Usuário autenticado não identificado.' }, 401);
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
        403
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
    return jsonResponse({ ok: false, error: 'Payload JSON inválido.' }, 400);
  }

  const tipo = body.tipo === 'corrida' ? 'corrida' : 'recarga';
  const valor = Number(Number(body.valor || 0).toFixed(2));
  if (!Number.isFinite(valor) || valor < 1 || valor > 25000) {
    return jsonResponse({ ok: false, error: 'Informe um valor entre R$ 1,00 e R$ 25.000,00.' }, 400);
  }

  const corridaId = tipo === 'corrida' && body.corrida_id ? String(body.corrida_id) : null;
  if (tipo === 'corrida' && !corridaId) {
    return jsonResponse({ ok: false, error: 'corrida_id é obrigatório para Pix de corrida.' }, 400);
  }

  const payerEmail = String(authUser.email || body.email || 'cliente@godriver.app').trim();
  const payerName = String(body.nome || 'Cliente GoDriver').trim();
  const requestOrigin = new URL(request.url).origin;
  const externalRef = `${tipo}:${authUser.id}:${corridaId || 'wallet'}:${Date.now()}`;

  const mpPayload = {
    transaction_amount: valor,
    description:
      tipo === 'corrida'
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

  const mpData = (await mpRes.json()) as {
    id?: number | string;
    status?: string;
    message?: string;
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
      };
    };
  };

  if (!mpRes.ok || !mpData?.id) {
    return jsonResponse(
      {
        ok: false,
        error: mpData?.message || 'Erro ao gerar Pix no Mercado Pago.',
      },
      502
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

  const insertedRows = (await insertRes.json()) as Array<{ id?: string }>;
  const inserted = Array.isArray(insertedRows) ? insertedRows[0] : null;
  if (!insertRes.ok || !inserted?.id) {
    return jsonResponse(
      { ok: false, error: 'Pix criado no Mercado Pago, mas falhou ao registrar em pagamentos_pix.' },
      500
    );
  }

  return jsonResponse({
    ok: true,
    id: inserted.id,
    mp_payment_id: mpPaymentId,
    qr_code: qrCode,
    qr_code_base64: qrCodeBase64,
    valor,
    status: 'pendente',
  });
}

async function handleMercadoPagoWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  const mpToken = (env.MP_ACCESS_TOKEN || '').trim();
  const sbUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const sbServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!mpToken || !sbUrl || !sbServiceKey) {
    return jsonResponse({ ok: false, error: 'Configuração do servidor incompleta.' }, 503);
  }

  const url = new URL(request.url);
  let body: { type?: string; topic?: string; data?: { id?: string | number } } = {};
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
    return jsonResponse({ ok: true, ignored: true });
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
      return jsonResponse({ ok: false, error: 'Assinatura webhook inválida.' }, 401);
    }
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${mpToken}`,
    },
  });
  if (!mpRes.ok) {
    return jsonResponse({ ok: false, error: 'Não foi possível validar pagamento no Mercado Pago.' }, 502);
  }
  const mpPayment = (await mpRes.json()) as { status?: string; id?: number | string };

  if (mpPayment.status === 'approved') {
    await fetch(`${sbUrl}/rest/v1/rpc/process_mercadopago_pix_approved`, {
      method: 'POST',
      headers: {
        apikey: sbServiceKey,
        Authorization: `Bearer ${sbServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_mp_payment_id: String(mpPayment.id || paymentId) }),
    });
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

  return jsonResponse({ ok: true });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/mp-create-pix' && request.method === 'POST') {
      return handleCreatePix(request, env);
    }

    if (url.pathname === '/api/mp-webhook' && request.method === 'POST') {
      return handleMercadoPagoWebhook(request, env);
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({ ok: true, runtime: 'cloudflare-worker' });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
