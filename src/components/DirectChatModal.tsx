import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Send, ShieldCheck, X } from 'lucide-react';
import { useAppConfig } from '../context/AppConfigContext';
import { useTranslation } from '../lib/i18n';
import { fetchDirectMessages, sendDirectMessage } from '../lib/mobilityApi';
import { supabase } from '../lib/supabase';
import type { DirectMessage, UserProfile } from '../types/mobility';
import { AvatarImage } from './AvatarImage';

interface DirectChatModalProps {
  threadUser: {
    id: string;
    full_name: string;
    role: UserProfile['role'];
    avatar_url?: string | null;
    phone?: string;
  };
  currentUser: UserProfile;
  onClose: () => void;
}

const ADMIN_QUICK_REPLIES = [
  'Olá! Tudo certo com seu cadastro ou corrida?',
  'Seu repasse Pix foi enviado, confira sua conta.',
  'Precisando de suporte no trajeto, fale por aqui.',
];

const USER_QUICK_REPLIES = [
  'Preciso de ajuda com uma corrida ou entrega',
  'Dúvida sobre pagamento Pix ou repasse',
  'Quero atualizar meus documentos',
];

export const DirectChatModal: React.FC<DirectChatModalProps> = ({
  threadUser,
  currentUser,
  onClose,
}) => {
  const { t } = useTranslation();
  const { config: appConfig } = useAppConfig();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const isAdmin = currentUser.role === 'admin';
  const quickReplies = isAdmin ? ADMIN_QUICK_REPLIES : USER_QUICK_REPLIES;

  useEffect(() => {
    let active = true;
    fetchDirectMessages(threadUser.id)
      .then((list) => {
        if (active) setMessages(list);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const channel = supabase
      .channel(`direct-chat-${threadUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `user_id=eq.${threadUser.id}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!row?.id) return;
          const incoming: DirectMessage = {
            id: String(row.id),
            user_id: String(row.user_id),
            sender_id: String(row.sender_id),
            sender_name: String(row.sender_name),
            sender_role: (row.sender_role as DirectMessage['sender_role']) || 'passenger',
            content: String(row.content),
            created_at: String(row.created_at),
          };
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
          );
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [threadUser.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (content: string) => {
    const clean = content.trim();
    if (!clean || sending) return;
    setSending(true);
    setErrMsg(null);
    try {
      const sent = await sendDirectMessage({
        userId: threadUser.id,
        senderId: currentUser.id,
        senderName: currentUser.full_name,
        senderRole: currentUser.role,
        content: clean,
      });
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setText('');
    } catch (err) {
      setErrMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível enviar. Verifique se o SQL incremental foi aplicado.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1250] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="flex h-[84vh] sm:h-[580px] w-full max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between bg-neutral-950 px-5 py-4 text-white">
          <div className="flex items-center gap-3 min-w-0">
            {isAdmin ? (
              <AvatarImage
                src={threadUser.avatar_url}
                name={threadUser.full_name}
                className="h-10 w-10 rounded-full object-cover border border-[#FFD100] shrink-0"
                fallbackClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 font-extrabold">
                <Headphones className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#FFD100] flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                {isAdmin ? 'Chat Direto · Super Admin' : 'Atendimento Oficial · Administração'}
              </p>
              <h3 className="text-base font-extrabold truncate">
                {isAdmin ? threadUser.full_name : `${appConfig.app_name} · ${t.support_admin}`}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-4 space-y-3">
          {loading ? (
            <p className="py-10 text-center text-xs text-neutral-500 dark:text-neutral-400">Carregando mensagens...</p>
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              {isAdmin
                ? `Inicie uma conversa direta com ${threadUser.full_name}.`
                : 'Envie uma mensagem direta para a administração da plataforma.'}
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === currentUser.id;
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <span className="mb-0.5 text-[10px] font-bold text-neutral-500 dark:text-neutral-400">
                    {m.sender_role === 'admin' ? 'Administração' : m.sender_name}
                  </span>
                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                      mine
                        ? 'bg-[#FFD100] text-neutral-950 font-semibold rounded-br-sm'
                        : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700 rounded-bl-sm'
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="mt-1 text-[10px] text-neutral-400 font-mono-num">
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

        {errMsg && (
          <div className="bg-red-50 dark:bg-red-950/50 border-t border-red-200 dark:border-red-900 px-4 py-2 text-xs font-semibold text-red-700 dark:text-red-300">
            {errMsg}
          </div>
        )}

        <div className="border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 pt-2.5 pb-safe">
          <div className="flex gap-2 overflow-x-auto pb-2.5 no-scrollbar">
            {quickReplies.map((qr) => (
              <button
                key={qr}
                type="button"
                onClick={() => handleSend(qr)}
                className="shrink-0 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 whitespace-nowrap"
              >
                {qr}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(text);
            }}
            className="flex items-center gap-2 pb-2"
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escreva sua mensagem..."
              className="min-h-[46px] flex-1 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-4 text-sm text-neutral-900 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-neutral-950 dark:bg-[#FFD100] text-[#FFD100] dark:text-neutral-950 disabled:opacity-40"
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
