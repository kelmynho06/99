import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  KeyRound,
  Printer,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { resolveBrandLogo } from '../lib/brandAssets';
import { formatBRL } from '../lib/geo';
import type {
  Pay66ReceiptResult,
  PlatformConfig,
  UserProfile,
  WalletTransaction,
} from '../types/mobility';
import { BorealLogoMark } from './BorealBrandAssets';

interface Receipt66PayModalProps {
  transaction?: WalletTransaction | null;
  receipt66?: Pay66ReceiptResult | null;
  currentUser: UserProfile;
  platformConfig?: PlatformConfig;
  onClose: () => void;
}

const TX_TYPE_LABEL: Record<WalletTransaction['type'], string> = {
  deposit: 'Depósito Pix BorealPay',
  ride_debit: 'Pagamento de Corrida via BorealPay',
  ride_refund: 'Estorno de Corrida BorealPay',
  admin_adjustment: 'Ajuste Administrativo BorealPay',
  ride_earning: 'Recebimento de Corrida BorealPay',
  payout: 'Repasse Pix',
  dispute_settlement: 'Acerto de Disputa',
  transfer_in: 'Transferência BorealPay Recebida',
  transfer_out: 'Transferência BorealPay Enviada',
  withdrawal: 'Saque Pix Solicitado',
  withdrawal_refund: 'Estorno de Saque Pix',
};

function parseCounterparty(tx: WalletTransaction, currentUser: UserProfile): {
  sender: string;
  recipient: string;
  recipientKey: string;
  note: string;
} {
  const desc = tx.description || '';
  const parts = desc.split('·').map((p) => p.trim());
  const head = parts[0] || '';
  const note = parts.slice(1).join(' · ');
  const fallbackMyKey =
    currentUser.pay66_key ||
    `BOREAL-${currentUser.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  if (tx.sender_name || tx.recipient_name) {
    return {
      sender: tx.sender_name || (tx.amount < 0 ? currentUser.full_name : 'Usuário BorealPay'),
      recipient: tx.recipient_name || (tx.amount >= 0 ? currentUser.full_name : 'Usuário BorealPay'),
      recipientKey: tx.recipient_key || fallbackMyKey,
      note: note || desc,
    };
  }

  if (tx.type === 'transfer_out') {
    const match = head.match(/(?:Enviado para|Transferência (?:66\s?Pay|BorealPay) enviada para)\s+(.+)/i);
    return {
      sender: currentUser.full_name,
      recipient: match?.[1]?.trim() || 'Usuário BorealPay',
      recipientKey: tx.recipient_key || 'Conta BorealPay',
      note,
    };
  }
  if (tx.type === 'transfer_in') {
    const match = head.match(/(?:Recebido de|Transferência (?:66\s?Pay|BorealPay) recebida de)\s+(.+)/i);
    return {
      sender: match?.[1]?.trim() || 'Usuário BorealPay',
      recipient: currentUser.full_name,
      recipientKey: tx.recipient_key || fallbackMyKey,
      note,
    };
  }
  return {
    sender: tx.amount >= 0 ? 'Ecossistema BorealPay' : currentUser.full_name,
    recipient: tx.amount >= 0 ? currentUser.full_name : 'Ecossistema BorealPay',
    recipientKey: tx.recipient_key || fallbackMyKey,
    note: desc,
  };
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(/\s+/);
  let line = '';
  let curY = y;

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

interface NormalizedReceipt {
  id: string;
  authCode: string;
  typeLabel: string;
  isPositive: boolean;
  amount: number;
  createdAt: string;
  senderName: string;
  recipientName: string;
  recipientKey: string;
  description: string;
  isInternalBorealPay: boolean;
}

async function generateReceiptPngBlob(
  receipt: NormalizedReceipt,
  siteName: string
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 840;
  canvas.height = 1180;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');

  const absAmount = formatBRL(Math.abs(receipt.amount));
  const dateLabel = new Date(receipt.createdAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Light Aurora Canvas Background
  ctx.fillStyle = '#F7FBFA';
  ctx.fillRect(0, 0, 840, 1180);

  // Header Aurora Gradient Band
  const headerGrad = ctx.createLinearGradient(0, 0, 840, 220);
  headerGrad.addColorStop(0, '#047857');
  headerGrad.addColorStop(0.55, '#0D9488');
  headerGrad.addColorStop(1, '#0891B2');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, 840, 220);

  // Boreal Emblem Badge
  ctx.fillStyle = '#0F2421';
  ctx.beginPath();
  ctx.roundRect(56, 48, 84, 84, 22);
  ctx.fill();
  ctx.fillStyle = '#6EE7B7';
  ctx.font = '900 42px sans-serif';
  ctx.fillText('B', 82, 106);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 30px sans-serif';
  ctx.fillText('BorealPay — Comprovante de Transferência', 164, 88);
  ctx.fillStyle = '#CCFBF1';
  ctx.font = '600 21px sans-serif';
  ctx.fillText(`${siteName} · Documento Digital Oficial`, 164, 124);

  // Crisp White Card
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(44, 175, 752, 935, 32);
  ctx.fill();
  ctx.strokeStyle = '#C9E8DF';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Status badge
  ctx.fillStyle = '#ECFDF5';
  ctx.beginPath();
  ctx.roundRect(84, 214, 290, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#047857';
  ctx.font = '800 19px sans-serif';
  ctx.fillText('CONCLUÍDO COM SUCESSO', 106, 243);

  // Internal BorealPay disclaimer pill
  if (receipt.isInternalBorealPay) {
    ctx.fillStyle = '#F0FDFA';
    ctx.beginPath();
    ctx.roundRect(84, 270, 672, 42, 16);
    ctx.fill();
    ctx.strokeStyle = '#99F6E4';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#0F766E';
    ctx.font = '700 18px sans-serif';
    ctx.fillText('Transferência interna BorealPay (não é Pix bancário)', 104, 297);
  }

  // Amount
  ctx.fillStyle = '#5F7D78';
  ctx.font = '700 22px sans-serif';
  ctx.fillText(receipt.typeLabel, 84, 355);

  ctx.fillStyle = receipt.isPositive ? '#047857' : '#0F2421';
  ctx.font = '900 60px sans-serif';
  ctx.fillText(`${receipt.isPositive ? '+' : '-'} ${absAmount}`, 84, 428);

  // Divider
  ctx.strokeStyle = '#E0EFEA';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(84, 466);
  ctx.lineTo(756, 466);
  ctx.stroke();

  const drawRow = (label: string, value: string, startY: number): number => {
    ctx.fillStyle = '#5F7D78';
    ctx.font = '700 18px sans-serif';
    ctx.fillText(label, 84, startY);
    ctx.fillStyle = '#0F2421';
    ctx.font = '700 23px sans-serif';
    return wrapCanvasText(ctx, value, 84, startY + 32, 672, 30) + 20;
  };

  let y = 510;
  y = drawRow('DATA E HORA', dateLabel, y);
  y = drawRow('ORIGEM', receipt.senderName, y);
  y = drawRow('DESTINO', receipt.recipientName, y);
  y = drawRow('CHAVE BOREALPAY', receipt.recipientKey, y);
  y = drawRow('DESCRIÇÃO / OBSERVAÇÃO', receipt.description, y);
  drawRow('CÓDIGO DE AUTENTICAÇÃO', receipt.authCode, Math.min(y, 995));

  ctx.fillStyle = '#334E4A';
  ctx.font = '600 18px sans-serif';
  ctx.fillText(`Autenticado pelo ecossistema ${siteName} / BorealPay`, 84, 1145);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar imagem PNG do comprovante.'));
    }, 'image/png');
  });
}

export const Receipt66PayModal: React.FC<Receipt66PayModalProps> = ({
  transaction,
  receipt66,
  currentUser,
  platformConfig,
  onClose,
}) => {
  const siteName = platformConfig?.site_name || 'Boreal Mobilidade';
  const customLogo = platformConfig?.app_logo_url;
  const brandLogo = resolveBrandLogo(platformConfig);
  const [busyAction, setBusyAction] = useState<'download' | 'pdf' | 'share' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const normalized = useMemo<NormalizedReceipt | null>(() => {
    if (receipt66) {
      const isDriverReceiver =
        currentUser.role === 'driver' ||
        receipt66.recipient_key === currentUser.pay66_key;
      return {
        id: receipt66.tx_id || receipt66.ride_id,
        authCode: receipt66.auth_code,
        typeLabel: isDriverReceiver
          ? 'Recebimento de Corrida BorealPay'
          : 'Pagamento de Corrida via BorealPay',
        isPositive: isDriverReceiver,
        amount: Math.abs(receipt66.amount),
        createdAt: receipt66.created_at,
        senderName: receipt66.sender_name,
        recipientName: receipt66.recipient_name,
        recipientKey: receipt66.recipient_key,
        description: `Corrida #${receipt66.ride_id.slice(-4)} quitada na carteira BorealPay`,
        isInternalBorealPay: true,
      };
    }

    if (!transaction) return null;
    const party = parseCounterparty(transaction, currentUser);
    const isInternal =
      transaction.type !== 'deposit' &&
      transaction.type !== 'withdrawal' &&
      transaction.type !== 'withdrawal_refund' &&
      transaction.type !== 'payout';

    return {
      id: transaction.id,
      authCode:
        transaction.auth_code ||
        `BPAY-${transaction.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      typeLabel: TX_TYPE_LABEL[transaction.type] || 'Movimentação BorealPay',
      isPositive: transaction.amount >= 0,
      amount: Math.abs(transaction.amount),
      createdAt: transaction.created_at,
      senderName: party.sender,
      recipientName: party.recipient,
      recipientKey: party.recipientKey,
      description: party.note || transaction.description,
      isInternalBorealPay: isInternal,
    };
  }, [receipt66, transaction, currentUser]);

  if (!normalized) return null;

  const absAmount = formatBRL(normalized.amount);
  const dateLabel = new Date(normalized.createdAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const receiptSummaryText = [
    `BorealPay — Comprovante de Transferência (${siteName})`,
    normalized.isInternalBorealPay ? 'Transferência interna BorealPay (não é Pix bancário)' : '',
    `Tipo: ${normalized.typeLabel}`,
    `Valor: ${normalized.isPositive ? '+' : '-'} ${absAmount}`,
    `Data: ${dateLabel}`,
    `Origem: ${normalized.senderName}`,
    `Destino: ${normalized.recipientName}`,
    `Chave BorealPay: ${normalized.recipientKey}`,
    `Descrição: ${normalized.description}`,
    `Autenticação: ${normalized.authCode}`,
  ]
    .filter(Boolean)
    .join('\n');

  const handleDownloadPng = async () => {
    setBusyAction('download');
    setFeedback(null);
    try {
      const blob = await generateReceiptPngBlob(normalized, siteName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprovante-borealpay-${normalized.authCode.slice(-8)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setFeedback('Comprovante salvo em PNG!');
    } catch {
      setFeedback('Não foi possível baixar o PNG neste dispositivo.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrintPdf = () => {
    setBusyAction('pdf');
    setFeedback(null);
    try {
      window.print();
      setFeedback('Visualização de impressão / PDF aberta.');
    } catch {
      setFeedback('Impressão PDF indisponível neste aparelho. Use Baixar PNG.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleShare = async () => {
    setBusyAction('share');
    setFeedback(null);
    try {
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === 'function') {
        try {
          const blob = await generateReceiptPngBlob(normalized, siteName);
          const file = new File(
            [blob],
            `comprovante-borealpay-${normalized.authCode.slice(-8)}.png`,
            { type: 'image/png' }
          );
          if (!nav.canShare || nav.canShare({ files: [file] })) {
            await nav.share({
              title: `BorealPay — Comprovante · ${absAmount}`,
              text: receiptSummaryText,
              files: [file],
            });
            setFeedback('Comprovante compartilhado!');
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
        }

        await nav.share({
          title: `BorealPay — Comprovante · ${absAmount}`,
          text: receiptSummaryText,
        });
        setFeedback('Comprovante compartilhado!');
        return;
      }

      await navigator.clipboard.writeText(receiptSummaryText);
      setFeedback('Comprovante copiado para compartilhar!');
    } catch {
      try {
        await navigator.clipboard.writeText(receiptSummaryText);
        setFeedback('Comprovante copiado!');
      } catch {
        setFeedback('Não foi possível compartilhar agora.');
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[1550] flex items-end sm:items-center justify-center bg-[#0F2421]/65 backdrop-blur-xs p-0 sm:p-4">
      <div className="print-only-sheet w-full max-w-md rounded-t-[28px] sm:rounded-[28px] bg-[#F7FBFA] dark:bg-[#081312] text-[#0F2421] dark:text-white border border-[#DCEEE8] dark:border-emerald-950 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-[#047857] via-[#0D9488] to-[#0891B2] px-5 py-4 text-white">
          <div className="flex items-center gap-3 min-w-0">
            {customLogo ? (
              <img
                src={brandLogo}
                alt={siteName}
                className="h-10 w-10 rounded-xl object-cover border border-white/30 shrink-0"
              />
            ) : (
              <BorealLogoMark className="h-10 w-10 rounded-xl shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="font-display text-sm sm:text-base font-black tracking-tight leading-tight truncate">
                BorealPay — Comprovante
              </h3>
              <p className="text-[11px] font-bold text-[#CCFBF1]">{siteName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="no-print flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Amount & Status Card */}
          <div className="rounded-3xl bg-white dark:bg-[#0D1A18] border border-[#DCEEE8] dark:border-emerald-950 p-4 text-center space-y-2 shadow-2xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] dark:bg-emerald-950/60 border border-[#A7F3D0] dark:border-emerald-800 px-3 py-1 text-[11px] font-extrabold text-[#047857] dark:text-[#6EE7B7]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Transação Concluída
            </span>
            {normalized.isInternalBorealPay && (
              <div className="rounded-xl bg-[#F0FDFA] dark:bg-teal-950/40 border border-[#99F6E4] dark:border-teal-800 px-3 py-1.5 text-[11px] font-extrabold text-[#0F766E] dark:text-[#2DD4BF]">
                Transferência interna BorealPay (não é Pix bancário)
              </div>
            )}
            <p className="text-xs font-bold text-[#5F7D78] dark:text-neutral-400">{normalized.typeLabel}</p>
            <p
              className={`font-display font-mono-num text-3xl font-black ${
                normalized.isPositive
                  ? 'text-[#047857] dark:text-[#6EE7B7]'
                  : 'text-[#0F2421] dark:text-white'
              }`}
            >
              {normalized.isPositive ? '+' : '-'} {absAmount}
            </p>
          </div>

          {/* Receipt Details */}
          <div className="rounded-3xl bg-white dark:bg-[#0D1A18] border border-[#DCEEE8] dark:border-emerald-950 divide-y divide-[#EDF6F3] dark:divide-emerald-950/70 text-xs shadow-2xs">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[#5F7D78] dark:text-neutral-400 font-semibold">Data e hora</span>
              <span className="font-mono-num font-bold text-[#0F2421] dark:text-white text-right">{dateLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[#5F7D78] dark:text-neutral-400 font-semibold">Origem</span>
              <span className="font-bold text-[#0F2421] dark:text-white text-right truncate max-w-[62%]">
                {normalized.senderName}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[#5F7D78] dark:text-neutral-400 font-semibold">Destino</span>
              <span className="font-bold text-[#0F2421] dark:text-white text-right truncate max-w-[62%]">
                {normalized.recipientName}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[#5F7D78] dark:text-neutral-400 font-semibold flex items-center gap-1">
                <KeyRound className="h-3.5 w-3.5 text-[#047857] dark:text-[#6EE7B7]" />
                Chave BorealPay
              </span>
              <span className="font-mono-num font-bold text-[#047857] dark:text-[#6EE7B7] text-right truncate max-w-[62%]">
                {normalized.recipientKey}
              </span>
            </div>
            <div className="px-4 py-3 space-y-1">
              <span className="text-[#5F7D78] dark:text-neutral-400 font-semibold block">Descrição</span>
              <p className="font-medium text-[#0F2421] dark:text-neutral-100 leading-snug">{normalized.description}</p>
            </div>
            <div className="px-4 py-3 space-y-1">
              <span className="text-[#5F7D78] dark:text-neutral-400 font-semibold flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-[#0D9488] dark:text-[#2DD4BF]" />
                Código de Autenticação
              </span>
              <p className="font-mono text-[11px] font-bold text-[#334E4A] dark:text-neutral-200 break-all">
                {normalized.authCode}
              </p>
            </div>
          </div>

          {feedback && (
            <div className="no-print flex items-center justify-center gap-1.5 rounded-2xl bg-[#ECFDF5] dark:bg-emerald-950/60 border border-[#A7F3D0] dark:border-emerald-800 px-3 py-2 text-xs font-bold text-[#047857] dark:text-[#6EE7B7]">
              <Check className="h-4 w-4" />
              <span>{feedback}</span>
            </div>
          )}

          {/* Actions */}
          <div className="no-print grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={busyAction !== null}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border border-[#DCEEE8] dark:border-emerald-900 bg-white dark:bg-[#0D1A18] px-2.5 text-[11px] font-extrabold text-[#0F2421] dark:text-white hover:bg-[#F1F8F6] active:scale-95 transition whitespace-nowrap disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-[#047857] dark:text-[#6EE7B7]" />
              <span>{busyAction === 'download' ? '...' : 'Baixar PNG'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              disabled={busyAction !== null}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border border-[#DCEEE8] dark:border-emerald-900 bg-white dark:bg-[#0D1A18] px-2.5 text-[11px] font-extrabold text-[#0F2421] dark:text-white hover:bg-[#F1F8F6] active:scale-95 transition whitespace-nowrap disabled:opacity-50"
            >
              <Printer className="h-4 w-4 text-[#0D9488] dark:text-[#2DD4BF]" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={busyAction !== null}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl bg-[#047857] px-2.5 text-[11px] font-extrabold text-white shadow-md hover:bg-[#065F46] active:scale-95 transition whitespace-nowrap disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" />
              <span>{busyAction === 'share' ? '...' : 'Compartilhar'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
