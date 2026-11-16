import React, { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { sendRideMessage } from '../lib/mobilityApi';
import type { RideMessage, UserProfile } from '../types/mobility';
import { AvatarImage } from './AvatarImage';

interface RideChatModalProps {
  rideId: string;
  currentUser: UserProfile;
  peerName: string;
  peerAvatarUrl?: string | null;
  isDelivery?: boolean;
  messages: RideMessage[];
  onMessageSent?: (msg: RideMessage) => void;
  onClose: () => void;
}

const RIDE_QUICK_REPLIES = [
  'Já estou no ponto de embarque',
  'Estou descendo agora!',
  'Qual a cor da sua blusa?',
  'Chego em 2 minutos',
];

const DELIVERY_QUICK_REPLIES = [
  'Já estou no local da coleta',
  'O pacote já está pronto para retirada',
  'Cheguei no endereço de entrega!',
  'Qual o código PIN de 4 dígitos?',
];

export const RideChatModal: React.FC<RideChatModalProps> = ({
  rideId,
  currentUser,
  peerName,
  peerAvatarUrl,
  isDelivery = false,
  messages,
  onMessageSent,
  onClose,
}) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const quickReplies = isDelivery ? DELIVERY_QUICK_REPLIES : RIDE_QUICK_REPLIES;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (content: string) => {
    const clean = content.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      const sent = await sendRideMessage(rideId, currentUser.id, currentUser.full_name, clean);
      onMessageSent?.(sent);
      setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="flex h-[82vh] sm:h-[560px] w-full max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-950 px-5 py-4 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <AvatarImage
              src={peerAvatarUrl}
              name={peerName}
              className="h-10 w-10 rounded-full object-cover border border-[#FFD100] shrink-0"
              fallbackClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#FFD100]">
                {isDelivery ? 'Chat da entrega (Motoboy ↔ Cliente)' : 'Chat da corrida'}
              </p>
              <h3 className="text-base font-bold truncate">{peerName}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
            aria-label="Fechar chat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-neutral-50 p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-500">
              {isDelivery
                ? `Combine os detalhes da coleta ou entrega com ${peerName}.`
                : `Envie uma mensagem para combinar o embarque com ${peerName}.`}
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === currentUser.id;
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      mine
                        ? 'bg-[#FFD100] text-neutral-950 font-medium rounded-br-sm'
                        : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-sm'
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="mt-1 text-[11px] text-neutral-400 font-mono-num">
                    {new Date(m.created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-neutral-100 bg-white px-3 pt-2.5 pb-safe">
          <div className="flex gap-2 overflow-x-auto pb-2.5 no-scrollbar">
            {quickReplies.map((qr) => (
              <button
                key={qr}
                type="button"
                onClick={() => sendMessage(qr)}
                className="shrink-0 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 active:scale-95 transition whitespace-nowrap"
              >
                {qr}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(text);
            }}
            className="flex items-center gap-2 pb-2"
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite sua mensagem..."
              className="min-h-[46px] flex-1 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-sm text-neutral-900 outline-none focus:border-neutral-900"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-[#FFD100] disabled:opacity-40 transition active:scale-95"
              aria-label="Enviar mensagem"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
