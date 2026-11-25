import React, { useState } from 'react';
import { Check, Cookie, FileText, Lock, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

export type LegalDocTab = 'terms' | 'privacy' | 'security' | 'cookies';

interface LegalDocsModalProps {
  initialTab?: LegalDocTab;
  siteName?: string;
  requireAcceptanceButton?: boolean;
  onAcceptAll?: () => void;
  onClose: () => void;
}

export const LegalDocsModal: React.FC<LegalDocsModalProps> = ({
  initialTab = 'terms',
  siteName = 'Go Driver Mobilidade',
  requireAcceptanceButton = false,
  onAcceptAll,
  onClose,
}) => {
  const { t, lang } = useTranslation();
  const [activeTab, setActiveTab] = useState<LegalDocTab>(initialTab);

  return (
    <div className="fixed inset-0 z-[1350] flex items-end sm:items-center justify-center bg-[#0F172A]/60 p-0 sm:p-4">
      <div className="flex h-[90vh] sm:h-auto sm:max-h-[88vh] w-full max-w-2xl flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden border border-[#E2E8F0]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="aurora-accent-flow flex h-10 w-10 items-center justify-center rounded-xl text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-extrabold text-[#0F172A]">
                {t.privacy_security}
              </h3>
              <p className="text-xs text-[#475569]">
                {siteName} · {t.legal_subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F172A]"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-[#E2E8F0] bg-[#F4F6F9] px-5 py-2.5 no-scrollbar">
          {[
            { id: 'terms' as LegalDocTab, label: t.legal_tab_terms, icon: FileText },
            { id: 'privacy' as LegalDocTab, label: t.legal_tab_privacy, icon: Lock },
            { id: 'security' as LegalDocTab, label: t.legal_tab_security, icon: ShieldCheck },
            { id: 'cookies' as LegalDocTab, label: t.legal_tab_cookies, icon: Cookie },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold whitespace-nowrap transition ${
                  active
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'bg-white border border-[#E2E8F0] text-[#475569] hover:bg-[#EFF6FF] hover:text-[#2563EB]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Legal Content */}
        <div className="flex-1 overflow-y-auto p-5 text-xs sm:text-sm text-[#475569] space-y-4 leading-relaxed">
          {activeTab === 'terms' && (
            <div className="space-y-3">
              <h4 className="font-display text-base font-extrabold text-[#0F172A]">
                1. {t.legal_tab_terms} — {siteName}
              </h4>
              {!lang.toLowerCase().startsWith('pt') && (
                <p className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E3A8A]">
                  {t.auth_hero_subtitle}
                </p>
              )}
              <p>
                Ao criar sua conta na plataforma <strong className="text-[#0F172A]">{siteName}</strong> (Web App, PWA ou
                aplicativo Android APK), você concorda integralmente com as normas operacionais,
                regras de pagamento e diretrizes de conduta descritas neste documento.
              </p>
              <p>
                <strong className="text-[#0F172A]">1.1. Perfis de Acesso:</strong> Passageiros têm acesso imediato para
                solicitação de viagens e entregas. Motoristas e Entregadores passam por análise de
                documentos obrigatórios (CNH válida e CRLV do veículo) e só operam após aprovação
                expressa da Administração.
              </p>
              <p>
                <strong className="text-[#0F172A]">1.2. Tarifas, Pagamentos e Débitos Pendentes:</strong> O usuário compromete-se
                a quitar o valor combinado da corrida ou entrega via Saldo GoPay, Pix Oficial da
                plataforma ou em Dinheiro ao motorista/entregador no destino. Em caso de não
                pagamento relatado e confirmado pela auditoria administrativa, o saldo devedor
                (&ldquo;Corrida não paga&rdquo;) será lançado na conta do cliente e somado
                automaticamente ao valor da próxima corrida até sua quitação integral.
              </p>
              <p>
                <strong className="text-[#0F172A]">1.3. Conferência Pix:</strong> Para maior segurança de ambas as partes,
                pagamentos realizados via Pix podem requerer validação e confirmação pelo
                Administrador da plataforma antes de liberar o motorista para uma nova corrida.
              </p>
              <p>
                <strong className="text-[#0F172A]">1.4. Suspensão e Auditoria:</strong> Contas com informações falsas,
                inadimplência recorrente ou violação de segurança podem ser suspensas pelo Super
                Admin.
              </p>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-3">
              <h4 className="font-display text-base font-extrabold text-[#0F172A]">
                2. {t.legal_tab_privacy} — {siteName}
              </h4>
              {!lang.toLowerCase().startsWith('pt') && (
                <p className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E3A8A]">
                  {t.privacy_security}
                </p>
              )}
              <p>
                A plataforma <strong className="text-[#0F172A]">{siteName}</strong> trata seus dados pessoais em estrita
                conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018).
              </p>
              <p>
                <strong className="text-[#0F172A]">2.1. Dados Coletados:</strong> Nome completo, telefone/WhatsApp, CPF, e-mail,
                foto de perfil opcional, localização GPS durante o uso do mapa/corrida e, para
                motoristas, fotos de CNH, CRLV e chave Pix de repasse.
              </p>
              <p>
                <strong className="text-[#0F172A]">2.2. Isolamento Estrito (Row Level Security):</strong> Passageiros acessam
                exclusivamente seus próprios registros e visualizam dados/placa/GPS do motorista
                somente durante uma corrida ativa. Documentos confidenciais (CNH/CRLV) são
                protegidos por controle de acesso e visíveis apenas para a equipe administrativa.
              </p>
              <p>
                <strong className="text-[#0F172A]">2.3. Permissões do Dispositivo:</strong> Solicitamos acesso à Localização
                (inclusive em segundo plano para motoristas em rota), Notificações pop-up, Câmera
                e Galeria de Fotos exclusivamente para envio de foto de perfil e documentos
                obrigatórios de cadastro (CNH/CRLV), além de instruções para modo irrestrito de
                bateria no Android. Você pode gerenciar essas permissões a qualquer momento nas
                configurações do app ou do Android.
              </p>
              <p>
                <strong className="text-[#0F172A]">2.4. Direito à Exclusão / Anonimização:</strong> Você pode solicitar a
                anonimização irreversível dos seus dados diretamente no menu{' '}
                <em>Configurações &gt; Privacidade e LGPD</em>.
              </p>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-3">
              <h4 className="font-display text-base font-extrabold text-[#0F172A]">
                3. {t.legal_tab_security} — {siteName}
              </h4>
              <p>
                <strong className="text-[#0F172A]">3.1. Código PIN no Embarque (Passageiros):</strong> Antes de iniciar qualquer
                corrida de passageiros, o sistema gera um código PIN exclusivo de 4 dígitos exibido
                no celular do cliente. O motorista deve validar esse PIN para iniciar a viagem,
                garantindo o embarque correto e seguro. A finalização no destino não exige PIN.
              </p>
              <p>
                <strong className="text-[#0F172A]">3.2. Entregas Seguras com PIN Opcional:</strong> Ao solicitar uma entrega de
                pacotes (Moto ou Carro), o remetente pode escolher se exige ou não o código PIN de 4
                dígitos de segurança. Quando habilitado, o entregador valida o PIN para confirmar a
                coleta e a entrega segura ao destinatário, sem necessidade de registro fotográfico do
                pacote.
              </p>
              <p>
                <strong className="text-[#0F172A]">3.3. Acompanhamento GPS e Guia por Voz:</strong> Tanto o motorista quanto o
                passageiro acompanham o trajeto em tempo real com indicação de velocidade e orientações
                por voz em português (com controle independente de áudio nas configurações).
              </p>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="space-y-3">
              <h4 className="font-display text-base font-extrabold text-[#0F172A]">
                4. {t.legal_tab_cookies} — {siteName}
              </h4>
              {!lang.toLowerCase().startsWith('pt') && (
                <p className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E3A8A]">
                  {t.cookies_notice_body}
                </p>
              )}
              <p>
                Utilizamos cookies essenciais e armazenamento local (<code>localStorage</code> / Cache
                PWA) para garantir o funcionamento contínuo tanto no navegador quanto no aplicativo
                Android (Capacitor):
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong className="text-[#0F172A]">Autenticação e Sessão:</strong> Mantém você conectado de forma segura com
                  o Supabase Auth sem exigir login repetitivo.
                </li>
                <li>
                  <strong className="text-[#0F172A]">Preferências de Idioma, Voz e Áudio:</strong> Salva o idioma
                  escolhido e preferências do guia por voz.
                </li>
                <li>
                  <strong className="text-[#0F172A]">Cache Offline PWA:</strong> Armazena ícones, estilos e mapa base para que
                  o aplicativo abra instantaneamente mesmo em redes móveis 3G/4G instáveis.
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E2E8F0] bg-[#F4F6F9] px-5 py-4 flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full sm:w-auto rounded-2xl border border-[#E2E8F0] bg-white px-5 text-xs font-bold text-[#0F172A]"
          >
            {t.close}
          </button>
          {requireAcceptanceButton && onAcceptAll && (
            <button
              type="button"
              onClick={() => {
                onAcceptAll();
                onClose();
              }}
              className="aurora-accent-flow flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-2 rounded-2xl px-6 text-sm font-extrabold text-white shadow-sm"
            >
              <Check className="h-4 w-4" />
              {t.legal_accept_btn}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
