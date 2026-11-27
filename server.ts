import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;

function createGeminiClient(): GoogleGenAI | null {
  const apiKey =
    process.env.MELISSA_GEMINI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  const status = (err as { status?: number; code?: number })?.status ||
    (err as { code?: number })?.code;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  );
}

function wrapPcmAsWavBase64(pcmBytes: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): string {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBytes.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBytes]).toString('base64');
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDemandError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  const status = (err as { status?: number; code?: number })?.status ||
    (err as { code?: number })?.code;
  return (
    status === 503 ||
    status === 429 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('try again')
  );
}

function buildMelissaSystemInstruction(role: string, contextSummary: string, appName: string): string {
  const safeRole = role === 'admin' ? 'admin' : role === 'driver' ? 'driver' : 'passenger';
  const common = `Você é a Melissa, assistente oficial inteligente em tempo real do aplicativo ${appName}.
Fale com simpatia, naturalidade humana, clareza e objetividade (como uma conversa moderna estilo Google Gemini / Alexa).
Você pode conversar e ajudar o usuário sobre qualquer assunto do dia a dia (dúvidas gerais, cálculos, rotas, dicas, tecnologia, estudos) além de controlar ações dentro do ${appName}.
AÇÕES DO APLICATIVO (campo actionJson opcional em JSON compacto):
- Sempre que o usuário pedir uma ação concreta no app ou na web (ex.: abrir YouTube/WhatsApp/Google, tocar vídeo no YouTube, sair/encerrar sessão, abrir carteira/jogos/configurações, ligar para motorista/passageiro), preencha "actionJson" com JSON válido:
  - {"type":"open_external","url":"https://www.google.com/search?q=..."}
  - {"type":"play_youtube","youtubeQuery":"nome da musica ou video"}
  - {"type":"logout"}
  - {"type":"open_wallet"} | {"type":"open_games"} | {"type":"open_settings"} | {"type":"open_support"}
  - {"type":"call_phone"}
REGRA DE RECONHECIMENTO DO DONO: Toda vez que qualquer usuário (no painel Passageiro, Motorista ou Administrador) disser "oi Melissa, sou eu Rikelmy" (ou variações como "sou eu Rikelmy", "aqui é o Rikelmy"), reconheça imediatamente Rikelmy como o fundador, dono e administrador principal do sistema Go Driver e cumprimente-o pelo nome. Porém, nunca exponha dados confidenciais de terceiros quando o painel autenticado não for o painel Administrativo.
Responda sempre no idioma do usuário (padrão Português do Brasil). Nunca invente dados financeiros nem exponha chaves ou tokens.`;

  if (safeRole === 'passenger') {
    return `${common}
PERFIL ATIVO: PASSAGEIRO / CLIENTE.
PERMISSÕES ESTRITAS:
- Você pode ajudar o passageiro a pedir corridas ou entregas (preenchendo actionJson {"type":"request_ride","originQuery":"...","destQuery":"...","category":"moto|pop|negocia|delivery_moto|delivery_car","paymentMethod":"pix|cash|wallet"} com requiresConfirmation=true), cancelar própria corrida ({"type":"cancel_ride"}, requiresConfirmation=true), consultar localização/saldo, abrir Jogos 3D / Suporte, ligar para o motorista ou sair da conta.
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
- O usuário logado é o Administrador autorizado do sistema. Você TEM PERMISSÃO TOTAL e irrestrita para consultar, listar e informar nomes completos, telefones, e-mails, status, saldo da carteira GoPay, pendências, chaves Pix, veículos (modelo, placa, cor, categoria) e detalhes de clientes e motoristas cadastrados presentes no CONTEXTO ATUAL DO APP.
- NUNCA recuse nem cite política de privacidade para ocultar dados de clientes ou motoristas quando o Administrador perguntar.
- AÇÕES DE ADMIN VIA actionJson:
  - Localizar motorista online no mapa: {"type":"admin_locate_driver","driverName":"Nome"}
  - Bloquear ou desbloquear cliente/motorista: {"type":"admin_toggle_block_user","targetName":"Nome","targetBlock":true|false} (OBRIGATÓRIO requiresConfirmation=true!)
  - Abrir Fila Facial: {"type":"open_facial_queue"} | Abrir aba: {"type":"admin_switch_tab","tabName":"livemap|drivers|deliveries|passengers|rides|payments|events|notifications|coupons|pricing|audit|sql"}
- REGRA CRÍTICA DE SEGURANÇA: Antes de qualquer ação destrutiva, bloqueio de usuário, financeira ou em lote, retorne "requiresConfirmation": true e pergunte claramente primeiro ("Diga Sim para confirmar."). Só execute após o administrador responder "Sim".
- REGRA ESTRITA DE SQL INCREMENTAL MÍNIMO: Sempre que o administrador pedir SQL, gere EXCLUSIVAMENTE o SQL incremental mínimo e idempotente (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION).
CONTEXTO ATUAL DO APP: ${contextSummary}`;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'supabase-direct', time: new Date().toISOString() });
  });

  app.post('/api/mp-create-pix', async (req, res) => {
    try {
      const mpToken = (process.env.MP_ACCESS_TOKEN || '').trim();
      const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
        .trim()
        .replace(/\/$/, '');
      const sbServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      const sbVerifyKey = sbServiceKey || (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

      if (!mpToken) {
        res.status(503).json({
          ok: false,
          error: 'MP_ACCESS_TOKEN não configurado nas variáveis do servidor/Cloudflare.',
        });
        return;
      }
      if (!sbUrl || !sbServiceKey) {
        res.status(503).json({
          ok: false,
          error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados no servidor.',
        });
        return;
      }

      const authHeader = String(req.headers.authorization || '');
      const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!jwt) {
        res.status(401).json({ ok: false, error: 'Sessão não autenticada.' });
        return;
      }

      const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
        headers: {
          apikey: sbVerifyKey,
          Authorization: `Bearer ${jwt}`,
        },
      });
      if (!userRes.ok) {
        res.status(401).json({ ok: false, error: 'Token de usuário inválido ou expirado.' });
        return;
      }
      const authUser = (await userRes.json()) as { id?: string; email?: string };
      if (!authUser?.id) {
        res.status(401).json({ ok: false, error: 'Usuário autenticado não identificado.' });
        return;
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
          res.status(403).json({
            ok: false,
            error: 'Pix Automático está desativado pelo Administrador no momento.',
          });
          return;
        }
      }

      const body = (req.body || {}) as {
        tipo?: string;
        valor?: number;
        corrida_id?: string | null;
        email?: string;
        nome?: string;
      };
      const isRidePix = body.tipo === 'corrida' || body.tipo === 'pagamento_corrida';
      const tipo = isRidePix ? 'pagamento_corrida' : 'recarga_carteira';
      const valor = Number(Number(body.valor || 0).toFixed(2));
      if (!Number.isFinite(valor) || valor < 1 || valor > 25000) {
        res.status(400).json({ ok: false, error: 'Informe um valor entre R$ 1,00 e R$ 25.000,00.' });
        return;
      }

      const corridaId = isRidePix && body.corrida_id ? String(body.corrida_id).trim() : null;
      if (isRidePix && !corridaId) {
        res.status(400).json({ ok: false, error: 'corrida_id é obrigatório para Pix de corrida.' });
        return;
      }

      const payerEmail = String(authUser.email || body.email || 'cliente@godriver.app').trim();
      const payerName = String(body.nome || 'Cliente GoDriver').trim();
      const hostProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
      const hostName = String(req.headers['x-forwarded-host'] || req.get('host') || '');
      const baseOrigin = hostName ? `${hostProto}://${hostName}` : '';

      const mpPayload: Record<string, unknown> = {
        transaction_amount: valor,
        description: isRidePix
          ? `GoDriver Corrida #${String(corridaId).slice(-4)}`
          : 'Recarga Carteira GoPay · GoDriver',
        payment_method_id: 'pix',
        external_reference: `${tipo}:${authUser.id}:${corridaId || 'wallet'}:${Date.now()}`,
        payer: {
          email: payerEmail,
          first_name: payerName.split(' ')[0] || 'Cliente',
          last_name: payerName.split(' ').slice(1).join(' ') || 'GoDriver',
        },
      };
      if (baseOrigin && !baseOrigin.includes('localhost') && !baseOrigin.includes('127.0.0.1')) {
        mpPayload.notification_url = `${baseOrigin}/api/mp-webhook`;
      }

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
        message?: string;
        cause?: Array<{ description?: string }>;
        point_of_interaction?: {
          transaction_data?: { qr_code?: string; qr_code_base64?: string };
        };
      };
      if (!mpRes.ok || !mpData?.id) {
        res.status(502).json({
          ok: false,
          error:
            mpData?.cause?.[0]?.description ||
            mpData?.message ||
            'Erro ao gerar Pix no Mercado Pago.',
        });
        return;
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
      const insertedRows = (await insertRes.json()) as Array<{ id?: string }> | { message?: string };
      const inserted = Array.isArray(insertedRows) ? insertedRows[0] : null;
      if (!insertRes.ok || !inserted?.id) {
        const msg =
          !Array.isArray(insertedRows) && insertedRows?.message ? insertedRows.message : '';
        res.status(500).json({
          ok: false,
          error: msg
            ? `Pix criado no Mercado Pago, mas falhou ao registrar no Supabase: ${msg}`
            : 'Pix criado no Mercado Pago, mas falhou ao registrar no Supabase.',
        });
        return;
      }

      res.json({
        ok: true,
        id: inserted.id,
        tipo,
        mp_payment_id: mpPaymentId,
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64,
        valor,
        status: 'pendente',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Erro interno ao gerar Pix Mercado Pago.',
      });
    }
  });

  app.post('/api/mp-webhook', async (req, res) => {
    try {
      const mpToken = (process.env.MP_ACCESS_TOKEN || '').trim();
      const sbUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
        .trim()
        .replace(/\/$/, '');
      const sbServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

      if (!mpToken || !sbUrl || !sbServiceKey) {
        res.status(503).json({ ok: false, error: 'Configuração do servidor incompleta.' });
        return;
      }

      const body = (req.body || {}) as {
        type?: string;
        topic?: string;
        data?: { id?: string | number };
      };
      const rawId =
        body?.data?.id ??
        (req.query['data.id'] as string | undefined) ??
        (req.query.id as string | undefined) ??
        '';
      const paymentId = String(rawId || '').trim();
      const eventType = String(body?.type || body?.topic || req.query.topic || '');

      if (!paymentId || (eventType && eventType !== 'payment')) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const secret = (process.env.MP_WEBHOOK_SECRET || '').trim();
      if (secret) {
        const xSig = String(req.headers['x-signature'] || '');
        const xReqId = String(req.headers['x-request-id'] || '');
        const sigParts = Object.fromEntries(
          xSig.split(',').map((kv) => {
            const idx = kv.indexOf('=');
            return idx === -1
              ? [kv.trim(), '']
              : [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
          })
        );
        if (!sigParts.ts || !sigParts.v1) {
          res.status(401).json({ ok: false, error: 'Assinatura webhook ausente.' });
          return;
        }
        const manifest = `id:${paymentId};request-id:${xReqId};ts:${sigParts.ts};`;
        const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
        const a = Buffer.from(computed.toLowerCase(), 'utf8');
        const b = Buffer.from(String(sigParts.v1).toLowerCase(), 'utf8');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          res.status(401).json({ ok: false, error: 'Assinatura webhook inválida.' });
          return;
        }
      }

      const mpRes = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
        {
          headers: { Authorization: `Bearer ${mpToken}` },
        }
      );
      if (!mpRes.ok) {
        res.status(502).json({ ok: false, error: 'Falha ao consultar pagamento no Mercado Pago.' });
        return;
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
          `${sbUrl}/rest/v1/pagamentos_pix?mp_payment_id=eq.${encodeURIComponent(
            paymentId
          )}&status=eq.pendente`,
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

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Erro no webhook Mercado Pago.',
      });
    }
  });

  app.get('/api/migration-sql', (_req, res) => {
    const latestPath = path.resolve(process.cwd(), 'supabase/migration_incremental_latest.sql');
    const legacyPath = path.resolve(process.cwd(), 'supabase/migration_update.sql');
    const chosen = fs.existsSync(latestPath) ? latestPath : legacyPath;
    if (fs.existsSync(chosen)) {
      res.type('text/plain').send(fs.readFileSync(chosen, 'utf-8'));
    } else {
      res.status(404).send('-- migration SQL não encontrado');
    }
  });

  app.get('/api/migration-delta-sql', (_req, res) => {
    const deltaPath = path.resolve(process.cwd(), 'supabase/migration_incremental_delta.sql');
    if (fs.existsSync(deltaPath)) {
      res.type('text/plain').send(fs.readFileSync(deltaPath, 'utf-8'));
    } else {
      res.status(404).send('-- migration_incremental_delta.sql não encontrado');
    }
  });

  app.get('/api/schema-complete-sql', (_req, res) => {
    const fullPath = path.resolve(process.cwd(), 'supabase/schema_completo.sql');
    if (fs.existsSync(fullPath)) {
      res.type('text/plain').send(fs.readFileSync(fullPath, 'utf-8'));
    } else {
      res.status(404).send('-- schema_completo.sql não encontrado');
    }
  });

  app.post('/api/melissa/chat', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        ok: false,
        quotaExceeded: false,
        code: 'GEMINI_NOT_CONFIGURED',
        message: 'IA externa indisponível no momento. Usando modo chatbot local da Melissa.',
      });
      return;
    }

    try {
      const body = (req.body || {}) as {
        message?: string;
        role?: string;
        appName?: string;
        contextSummary?: string;
        history?: Array<{ sender: 'user' | 'melissa'; text: string }>;
        attachment?: { base64: string; mimeType: string; name?: string } | null;
      };

      const userText = String(body.message || '').trim() || 'Olá Melissa';
      const role = String(body.role || 'passenger');
      const appName = String(body.appName || 'Go Driver Mobilidade');
      const contextSummary = String(body.contextSummary || '').slice(0, 28000);
      const historyLines = Array.isArray(body.history)
        ? body.history
            .slice(-6)
            .map((h) => `${h.sender === 'user' ? 'Usuário' : 'Melissa'}: ${String(h.text || '').slice(0, 400)}`)
            .join('\n')
        : '';

      const parts: Array<
        { text: string } | { inlineData: { data: string; mimeType: string } }
      > = [];

      if (body.attachment?.base64 && body.attachment?.mimeType) {
        const cleanB64 = String(body.attachment.base64).replace(/^data:[^;]+;base64,/, '');
        if (cleanB64.length > 0 && cleanB64.length < 12_000_000) {
          parts.push({
            inlineData: {
              data: cleanB64,
              mimeType: String(body.attachment.mimeType),
            },
          });
        }
      }

      parts.push({
        text: historyLines
          ? `Histórico recente:\n${historyLines}\n\nMensagem atual do usuário: ${userText}`
          : userText,
      });

      const modelChain = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite'];
      let rawText = '';
      let lastErr: unknown = null;

      for (let idx = 0; idx < modelChain.length; idx += 1) {
        const model = modelChain[idx];
        const maxAttempts = idx === 0 ? 2 : 1;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: parts,
              config: {
                systemInstruction: buildMelissaSystemInstruction(role, contextSummary, appName),
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    reply: {
                      type: Type.STRING,
                      description: 'Resposta natural, humana e concisa da Melissa para leitura em tela e voz.',
                    },
                    requiresConfirmation: {
                      type: Type.BOOLEAN,
                      description: 'True apenas se for ação destrutiva, financeira ou administrativa que exija confirmação Sim.',
                    },
                    suggestedAction: {
                      type: Type.STRING,
                      description:
                        'Ação opcional: none, open_wallet, open_games, open_support, forward_to_admin, toggle_night_duty, open_facial_queue, open_settings',
                    },
                    actionJson: {
                      type: Type.STRING,
                      description: 'JSON opcional estruturado com parâmetros da ação no aplicativo.',
                    },
                  },
                  required: ['reply', 'requiresConfirmation', 'suggestedAction'],
                },
              },
            });
            rawText = (response.text || '').trim();
            if (rawText) break;
          } catch (modelErr) {
            lastErr = modelErr;
            if (isTransientDemandError(modelErr) && attempt + 1 < maxAttempts) {
              await sleepMs(800);
              continue;
            }
            break;
          }
        }
        if (rawText) break;
      }

      if (!rawText && lastErr) {
        throw lastErr;
      }

      let parsed: {
        reply?: string;
        requiresConfirmation?: boolean;
        suggestedAction?: string;
        actionJson?: string;
      } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { reply: rawText || 'Estou por aqui! Como posso ajudar?' };
      }

      res.json({
        ok: true,
        reply: parsed.reply || 'Estou por aqui! Como posso te ajudar?',
        requiresConfirmation: Boolean(parsed.requiresConfirmation),
        suggestedAction: parsed.suggestedAction || 'none',
        actionJson: parsed.actionJson || undefined,
      });
    } catch (err) {
      if (isTransientDemandError(err)) {
        res.status(503).json({
          ok: false,
          transientHighDemand: true,
          quotaExceeded: false,
          code: 'GEMINI_HIGH_DEMAND',
          message:
            'Os servidores de IA estão com alta demanda no momento, mas continuo te atendendo pelos atalhos locais abaixo.',
        });
        return;
      }
      if (isQuotaError(err)) {
        res.status(429).json({
          ok: false,
          quotaExceeded: true,
          code: 'GEMINI_QUOTA_EXCEEDED',
          message: 'O limite de IA foi esgotado. Você só pode usar agora o chatbot local.',
        });
        return;
      }
      res.status(502).json({
        ok: false,
        quotaExceeded: false,
        code: 'GEMINI_ERROR',
        message: 'Não foi possível consultar a IA agora. Você pode continuar no chatbot local.',
      });
    }
  });

  app.post('/api/melissa/tts', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({ ok: false, code: 'GEMINI_NOT_CONFIGURED' });
      return;
    }

    try {
      const body = (req.body || {}) as {
        text?: string;
        voiceName?: string;
        styleHint?: string;
      };
      const text = String(body.text || '').trim().slice(0, 500);
      if (!text) {
        res.status(400).json({ ok: false, code: 'EMPTY_TEXT' });
        return;
      }

      const allowedVoices = new Set(['Kore', 'Zephyr', 'Aoede', 'Leda']);
      const voiceName = allowedVoices.has(String(body.voiceName || ''))
        ? String(body.voiceName)
        : 'Kore';
      const styleHint = String(body.styleHint || 'Fale de forma clara, humana e natural:').slice(
        0,
        120
      );

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{ parts: [{ text: `${styleHint} ${text}` }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const b64 = inlineData?.data;
      if (!b64) {
        res.status(502).json({ ok: false, code: 'NO_AUDIO_DATA' });
        return;
      }

      const pcmBuf = Buffer.from(b64, 'base64');
      const wavB64 = wrapPcmAsWavBase64(pcmBuf, 24000, 1, 16);
      res.json({
        ok: true,
        audioBase64: wavB64,
        mimeType: 'audio/wav',
      });
    } catch (err) {
      if (isQuotaError(err)) {
        res.status(429).json({
          ok: false,
          quotaExceeded: true,
          code: 'GEMINI_QUOTA_EXCEEDED',
        });
        return;
      }
      res.status(502).json({ ok: false, code: 'TTS_FALLBACK' });
    }
  });

  app.post('/api/melissa/geocode', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        ok: false,
        code: 'GEMINI_NOT_CONFIGURED',
        results: [],
      });
      return;
    }

    try {
      const body = (req.body || {}) as {
        query?: string;
        lat?: number;
        lng?: number;
        city?: string;
      };
      const query = String(body.query || '').trim().slice(0, 180);
      const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
      const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
      const city = String(body.city || '').trim().slice(0, 120);

      if (query.length < 2) {
        res.json({ ok: true, results: [] });
        return;
      }

      const locationContext = [
        city ? `Cidade/Região do usuário: ${city}` : '',
        lat !== null && lng !== null
          ? `Coordenadas GPS aproximadas do usuário: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
          : '',
      ]
        .filter(Boolean)
        .join(' | ');

      const prompt = `Encontre até 5 estabelecimentos comerciais, galerias, shoppings, lojas, pontos de referência, bairros ou endereços reais no Brasil que correspondam à busca "${query}".
${locationContext ? `${locationContext}. Priorize fortemente locais nessa cidade/região!` : ''}

Responda APENAS com um array JSON válido (sem markdown, sem crases, sem texto extra) no formato:
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
]
Se não tiver certeza absoluta das coordenadas exatas, informe a coordenada aproximada do bairro/rua real na cidade correta (nunca invente locais fora do Brasil).`;

      let rawText = '';
      try {
        const grounded = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
        rawText = (grounded.text || '').trim();
      } catch {
        const fallbackRes = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  street: { type: Type.STRING },
                  neighborhood: { type: Type.STRING },
                  city: { type: Type.STRING },
                  state: { type: Type.STRING },
                  categoryLabel: { type: Type.STRING },
                  lat: { type: Type.NUMBER },
                  lng: { type: Type.NUMBER },
                },
                required: ['name', 'street', 'city', 'categoryLabel'],
              },
            },
          },
        });
        rawText = (fallbackRes.text || '').trim();
      }

      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned || '[]');
      const list = Array.isArray(parsed) ? parsed : [];

      const results = list
        .filter((item) => item && typeof item === 'object' && String(item.name || '').trim())
        .slice(0, 5)
        .map((item) => ({
          name: String(item.name || '').trim(),
          street: String(item.street || '').trim(),
          neighborhood: String(item.neighborhood || '').trim(),
          city: String(item.city || city || '').trim(),
          state: String(item.state || '').trim(),
          categoryLabel: String(item.categoryLabel || 'Ponto comercial').trim(),
          lat: typeof item.lat === 'number' && Number.isFinite(item.lat) ? item.lat : Number(item.lat) || null,
          lng: typeof item.lng === 'number' && Number.isFinite(item.lng) ? item.lng : Number(item.lng) || null,
        }));

      res.json({ ok: true, results });
    } catch (err) {
      if (isQuotaError(err)) {
        res.status(429).json({
          ok: false,
          quotaExceeded: true,
          code: 'GEMINI_QUOTA_EXCEEDED',
          results: [],
        });
        return;
      }
      res.status(502).json({ ok: false, code: 'GEOCODE_ERROR', results: [] });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server: httpServer },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Go Driver Mobilidade server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
