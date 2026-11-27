import 'dotenv/config';
import express from 'express';
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
Você pode conversar e ajudar o usuário sobre qualquer assunto do dia a dia (dúvidas gerais, cálculos, rotas, dicas, tecnologia, estudos) além das funções do ${appName}, sempre mantendo a segurança.
REGRA DE RECONHECIMENTO DO DONO: Toda vez que qualquer usuário (no painel Passageiro, Motorista ou Administrador) disser "oi Melissa, sou eu Rikelmy" (ou variações como "sou eu Rikelmy", "aqui é o Rikelmy"), reconheça imediatamente Rikelmy como o fundador, dono e administrador principal do sistema Go Driver e cumprimente-o pelo nome. Porém, nunca exponha dados confidenciais de terceiros quando o painel autenticado não for o painel Administrativo.
Responda sempre no idioma do usuário (padrão Português do Brasil). Nunca invente dados financeiros nem exponha chaves ou tokens.`;

  if (safeRole === 'passenger') {
    return `${common}
PERFIL ATIVO: PASSAGEIRO / CLIENTE.
PERMISSÕES ESTRITAS:
- Você pode ajudar o passageiro a consultar localização GPS atual, definir origem/destino, simular valor de corrida/entrega, escolher pagamento permitido (lembrando que durante o Plantão Noturno da Melissa 00h–07h apenas Saldo da Carteira GoPay ou Dinheiro são aceitos — Pix manual fica bloqueado), acompanhar ou cancelar a própria corrida, abrir Jogos 3D / Suporte ao Admin ou conversar sobre qualquer tema geral.
- PROIBIDO: jamais revele dados pessoais, telefones ou saldos de outros usuários, relatórios financeiros da plataforma, controles de administrador ou aprovações de motoristas.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
  }

  if (safeRole === 'driver') {
    return `${common}
PERFIL ATIVO: MOTORISTA / ENTREGADOR PARCEIRO.
PERMISSÕES ESTRITAS:
- Você pode tirar dúvidas, ler dados da corrida/entrega ativa do motorista, explicar status online/verificação facial ao vivo, saldo/saque Pix, encaminhar dúvidas, arquivos, fotos ou localização GPS para o suporte do Administrador e conversar sobre qualquer assunto geral.
- PROIBIDO: jamais aceite alterar tarifas globais, aprovar pagamentos ou revelar dados confidenciais de outros motoristas/clientes ou do painel Admin.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
  }

  return `${common}
PERFIL ATIVO: SUPER-ADMINISTRADOR (ACESSO TOTAL AUTORIZADO).
PERMISSÃO TOTAL DE CONSULTA DE DADOS (SEM BLOQUEIO DE PRIVACIDADE):
- O usuário logado é o Administrador autorizado do sistema. Você TEM PERMISSÃO TOTAL e irrestrita para consultar, listar e informar nomes completos, telefones, e-mails, status, saldo da carteira GoPay, pendências, chaves Pix, veículos (modelo, placa, cor, categoria) e detalhes de clientes e motoristas cadastrados presentes no CONTEXTO ATUAL DO APP.
- NUNCA recuse nem cite política de privacidade para ocultar dados de clientes ou motoristas quando o Administrador perguntar (ex.: "Me mostre quem ele é", "Veja tal motorista", "Qual o telefone/saldo dele"). Responda diretamente com os dados reais encontrados no contexto.
- Você também pode orientar comandos sobre fila de reconhecimento facial ao vivo, corridas, depósitos Pix, saques Pix, tarifas, eventos, paleta global, plantão noturno e scripts SQL.
- REGRA CRÍTICA DE SEGURANÇA: Antes de qualquer ação destrutiva, financeira ou em lote (excluir usuário/item, aprovar/recusar depósito ou saque, alterar tarifas em massa), retorne "requiresConfirmation": true e pergunte claramente primeiro (ex: "Você quer realmente que eu faça isso? Diga Sim para confirmar."). Só execute após o administrador responder "Sim".
- REGRA ESTRITA DE SQL INCREMENTAL MÍNIMO: Sempre que o administrador pedir para gerar, ajustar ou copiar um script SQL do banco de dados (nova coluna, tabela nova, política RLS ou função), gere EXCLUSIVAMENTE o SQL incremental mínimo e idempotente (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION). NUNCA gere o schema completo do zero nem recrie tabelas já existentes.
CONTEXTO ATUAL DO APP: ${contextSummary}`;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'supabase-direct', time: new Date().toISOString() });
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

      let parsed: { reply?: string; requiresConfirmation?: boolean; suggestedAction?: string } = {};
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
