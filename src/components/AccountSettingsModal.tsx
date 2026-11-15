import React, { useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Car,
  ChevronRight,
  CreditCard,
  Home,
  Lock,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { searchAddresses } from '../lib/geo';
import type { PaymentMethod, SavedAddress, UserProfile } from '../types/mobility';

interface AccountSettingsModalProps {
  currentUser: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
  onAccountDeleted: () => void;
  onClose: () => void;
}

type SettingsSection = 'menu' | 'profile' | 'password' | 'addresses' | 'vehicle' | 'privacy';

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  currentUser,
  onUserUpdated,
  onAccountDeleted,
  onClose,
}) => {
  const [section, setSection] = useState<SettingsSection>('menu');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Basic profile
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [phone, setPhone] = useState(currentUser.phone);
  const [email, setEmail] = useState(currentUser.email);
  const [preferredPayment, setPreferredPayment] = useState<PaymentMethod>(
    currentUser.preferred_payment || 'pix'
  );

  // Saved addresses (Passenger)
  const [homeQuery, setHomeQuery] = useState(currentUser.home_address?.address || '');
  const [homeAddr, setHomeAddr] = useState<SavedAddress | null>(currentUser.home_address || null);
  const [workQuery, setWorkQuery] = useState(currentUser.work_address?.address || '');
  const [workAddr, setWorkAddr] = useState<SavedAddress | null>(currentUser.work_address || null);
  const [addrSuggestions, setAddrSuggestions] = useState<
    Array<{ target: 'home' | 'work'; address: string; lat: number; lng: number }>
  >([]);

  // Driver vehicle & Pix
  const [vehicleType, setVehicleType] = useState<'car' | 'moto' | 'delivery'>(
    currentUser.driver?.vehicle_type || 'car'
  );
  const [vehicleModel, setVehicleModel] = useState(currentUser.driver?.vehicle_model || '');
  const [vehiclePlate, setVehiclePlate] = useState(currentUser.driver?.vehicle_plate || '');
  const [vehicleColor, setVehicleColor] = useState(currentUser.driver?.vehicle_color || '');
  const [pixKey, setPixKey] = useState(currentUser.driver?.pix_key || '');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // LGPD delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          phone,
          email,
          preferred_payment: preferredPayment,
          home_address: homeAddr,
          work_address: workAddr,
          ...(currentUser.driver
            ? {
                vehicle_type: vehicleType,
                vehicle_model: vehicleModel,
                vehicle_plate: vehiclePlate,
                vehicle_color: vehicleColor,
                pix_key: pixKey,
              }
            : {}),
        }),
      });
      const data = (await res.json()) as { user?: UserProfile; error?: string };
      if (!res.ok || !data.user) {
        setFeedback({ type: 'err', msg: data.error || 'Erro ao salvar alterações.' });
        return;
      }
      onUserUpdated(data.user);
      setFeedback({ type: 'ok', msg: 'Configurações atualizadas com sucesso.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setFeedback({ type: 'err', msg: data.error || 'Falha ao alterar senha.' });
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ type: 'ok', msg: 'Senha alterada com segurança.' });
    } finally {
      setSaving(false);
    }
  };

  const handleAnonymizeAccount = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/account`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onAccountDeleted();
      }
    } finally {
      setSaving(false);
    }
  };

  const searchSavedAddress = async (query: string, target: 'home' | 'work') => {
    if (target === 'home') setHomeQuery(query);
    else setWorkQuery(query);
    if (query.trim().length < 3) {
      setAddrSuggestions([]);
      return;
    }
    const results = await searchAddresses(query);
    setAddrSuggestions(results.map((r) => ({ ...r, target })));
  };

  return (
    <div className="fixed inset-0 z-[1150] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-xs">
      <div className="flex h-[88vh] sm:h-auto sm:max-h-[85vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            {section !== 'menu' && (
              <button
                type="button"
                onClick={() => {
                  setSection('menu');
                  setFeedback(null);
                }}
                className="flex h-9 px-2.5 items-center justify-center rounded-xl bg-neutral-100 text-xs font-bold text-neutral-800"
              >
                Voltar
              </button>
            )}
            <h3 className="font-display text-lg font-extrabold text-neutral-950">
              {section === 'menu' && 'Configurações'}
              {section === 'profile' && 'Dados da Conta'}
              {section === 'password' && 'Alterar Senha'}
              {section === 'addresses' && 'Endereços e Pagamento'}
              {section === 'vehicle' && 'Veículo e Chave Pix'}
              {section === 'privacy' && 'Privacidade e LGPD'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
            aria-label="Fechar configurações"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {feedback && (
            <div
              className={`rounded-2xl px-4 py-3 text-xs font-bold ${
                feedback.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {feedback.msg}
            </div>
          )}

          {section === 'menu' && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-neutral-50 p-4 border border-neutral-100">
                <p className="font-display text-base font-extrabold text-neutral-950">
                  {currentUser.full_name}
                </p>
                <p className="text-xs text-neutral-500 font-mono-num">
                  {currentUser.phone} · {currentUser.email}
                </p>
              </div>

              <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSection('profile')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                    <User className="h-4 w-4 text-neutral-600" />
                    Editar nome, telefone e e-mail
                  </span>
                  <ChevronRight className="h-4 w-4 text-neutral-400" />
                </button>

                {currentUser.role === 'passenger' && (
                  <button
                    type="button"
                    onClick={() => setSection('addresses')}
                    className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                      <Home className="h-4 w-4 text-neutral-600" />
                      Endereços (Casa, Trabalho) e Pagamento
                    </span>
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  </button>
                )}

                {currentUser.role === 'driver' && (
                  <button
                    type="button"
                    onClick={() => setSection('vehicle')}
                    className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                      <Car className="h-4 w-4 text-neutral-600" />
                      Veículo e Chave Pix de repasse
                    </span>
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSection('password')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                    <Lock className="h-4 w-4 text-neutral-600" />
                    Alterar senha de acesso
                  </span>
                  <ChevronRight className="h-4 w-4 text-neutral-400" />
                </button>

                <button
                  type="button"
                  onClick={() => setSection('privacy')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                    <Shield className="h-4 w-4 text-neutral-600" />
                    Privacidade, Segurança PIN e Exclusão (LGPD)
                  </span>
                  <ChevronRight className="h-4 w-4 text-neutral-400" />
                </button>
              </div>
            </div>
          )}

          {section === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Nome completo
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm outline-none focus:border-neutral-950"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Telefone / WhatsApp
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm outline-none focus:border-neutral-950"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm outline-none focus:border-neutral-950"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[48px] w-full rounded-2xl bg-[#FFCC00] text-sm font-extrabold text-neutral-950"
              >
                {saving ? 'Salvando...' : 'Salvar Dados'}
              </button>
            </form>
          )}

          {section === 'addresses' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 mb-1">
                  <Home className="h-3.5 w-3.5" /> Endereço de Casa
                </label>
                <input
                  type="text"
                  value={homeQuery}
                  onChange={(e) => searchSavedAddress(e.target.value, 'home')}
                  placeholder="Busque seu endereço residencial..."
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-xs outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 mb-1">
                  <Briefcase className="h-3.5 w-3.5" /> Endereço de Trabalho
                </label>
                <input
                  type="text"
                  value={workQuery}
                  onChange={(e) => searchSavedAddress(e.target.value, 'work')}
                  placeholder="Busque seu endereço comercial..."
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-xs outline-none focus:border-neutral-950"
                />
              </div>

              {addrSuggestions.length > 0 && (
                <div className="rounded-2xl border border-neutral-200 divide-y divide-neutral-100 max-h-40 overflow-y-auto">
                  {addrSuggestions.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        const saved: SavedAddress = {
                          label: s.target === 'home' ? 'Casa' : 'Trabalho',
                          address: s.address,
                          lat: s.lat,
                          lng: s.lng,
                        };
                        if (s.target === 'home') {
                          setHomeAddr(saved);
                          setHomeQuery(s.address);
                        } else {
                          setWorkAddr(saved);
                          setWorkQuery(s.address);
                        }
                        setAddrSuggestions([]);
                      }}
                      className="block w-full px-3.5 py-2.5 text-left text-xs hover:bg-neutral-50"
                    >
                      {s.address}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 mb-2">
                  <CreditCard className="h-3.5 w-3.5" /> Pagamento Preferencial
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'pix' as PaymentMethod, label: 'Pix' },
                    { id: 'cash' as PaymentMethod, label: 'Dinheiro' },
                    { id: 'card_machine' as PaymentMethod, label: 'Maquininha' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPreferredPayment(m.id)}
                      className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                        preferredPayment === m.id
                          ? 'bg-neutral-950 text-[#FFCC00] border-neutral-950'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="min-h-[48px] w-full rounded-2xl bg-[#FFCC00] text-sm font-extrabold text-neutral-950"
              >
                {saving ? 'Salvando...' : 'Salvar Favoritos'}
              </button>
            </form>
          )}

          {section === 'vehicle' && (
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">Categoria</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'car' as const, label: 'Carro' },
                    { id: 'moto' as const, label: 'Moto' },
                    { id: 'delivery' as const, label: 'Entrega' },
                  ].map((vt) => (
                    <button
                      key={vt.id}
                      type="button"
                      onClick={() => setVehicleType(vt.id)}
                      className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                        vehicleType === vt.id
                          ? 'bg-neutral-950 text-[#FFCC00] border-neutral-950'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                      }`}
                    >
                      {vt.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                required
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder="Modelo"
                className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="text"
                  required
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  placeholder="Placa"
                  className="min-h-[46px] rounded-2xl border border-neutral-200 px-3.5 font-mono-num text-sm uppercase"
                />
                <input
                  type="text"
                  required
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  placeholder="Cor"
                  className="min-h-[46px] rounded-2xl border border-neutral-200 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Chave Pix para repasses
                </label>
                <input
                  type="text"
                  required
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 font-mono-num text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[48px] w-full rounded-2xl bg-[#FFCC00] text-sm font-extrabold text-neutral-950"
              >
                {saving ? 'Salvando...' : 'Atualizar Veículo & Pix'}
              </button>
            </form>
          )}

          {section === 'password' && (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">Senha atual</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Nova senha (mínimo 6 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[48px] w-full rounded-2xl bg-neutral-950 text-sm font-bold text-[#FFCC00]"
              >
                {saving ? 'Alterando...' : 'Confirmar Nova Senha'}
              </button>
            </form>
          )}

          {section === 'privacy' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-700 space-y-2 leading-relaxed">
                <p className="font-extrabold text-neutral-950">
                  Política de Privacidade e Isolamento de Dados (RLS)
                </p>
                <p>
                  • Seus dados pessoais (CPF, e-mail, endereços favoritos e documentos) são isolados
                  por regras estritas de acesso (Row Level Security).
                </p>
                <p>
                  • Para passageiros, a localização GPS e placa do veículo são compartilhadas apenas
                  durante uma corrida ou entrega ativa.
                </p>
                <p>
                  • Todas as viagens e entregas exigem verificação presencial com Código PIN de 4
                  dígitos para proteger embarque, coleta e entrega.
                </p>
              </div>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-sm font-bold text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir / Anonimizar minha conta (LGPD)
                </button>
              ) : (
                <div className="rounded-2xl border border-red-300 bg-red-50 p-4 space-y-3">
                  <div className="flex items-start gap-2.5 text-red-800">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold">
                      Esta ação anonimiza irreversivelmente seu nome, CPF, telefone, e-mail e
                      documentos conforme a LGPD, encerrando seu acesso imediatamente.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="min-h-[44px] flex-1 rounded-xl bg-white border border-neutral-300 text-xs font-bold text-neutral-800"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleAnonymizeAccount}
                      className="min-h-[44px] flex-1 rounded-xl bg-red-600 text-xs font-bold text-white"
                    >
                      {saving ? 'Anonimizando...' : 'Confirmar Exclusão'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
