import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Camera,
  Car,
  ChevronRight,
  CreditCard,
  FileText,
  Home,
  Lock,
  Shield,
  ShieldCheck,
  Star,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { getCurrentGpsPosition } from '../lib/capacitorDevice';
import { searchAddresses } from '../lib/geo';
import {
  anonymizeUserAccount,
  changeUserPassword,
  compressImageFileToDataUrl,
  updateUserProfileSettings,
} from '../lib/mobilityApi';
import { playSoundCue, speakPtBr } from '../lib/sound';
import {
  getUserPreferences,
  saveUserPreferences,
  subscribeUserPreferences,
} from '../lib/userPrefs';
import type {
  PaymentMethod,
  PlatformConfig,
  SavedAddress,
  UserPreferences,
  UserProfile,
} from '../types/mobility';
import { LegalDocsModal } from './LegalDocsModal';
import { PermissionsPromptModal } from './PermissionsPromptModal';

interface AccountSettingsModalProps {
  currentUser: UserProfile;
  platformConfig?: PlatformConfig;
  onUserUpdated: (user: UserProfile) => void;
  onAccountDeleted: () => void;
  onClose: () => void;
}

type SettingsSection =
  | 'menu'
  | 'profile'
  | 'password'
  | 'addresses'
  | 'vehicle'
  | 'prefs'
  | 'privacy';

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  currentUser,
  platformConfig,
  onUserUpdated,
  onAccountDeleted,
  onClose,
}) => {
  const [section, setSection] = useState<SettingsSection>('menu');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Basic profile + photo personalization
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [phone, setPhone] = useState(currentUser.phone);
  const [email, setEmail] = useState(currentUser.email);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatar_url || null);
  const [bio, setBio] = useState(currentUser.bio || '');
  const [preferredPayment, setPreferredPayment] = useState<PaymentMethod>(
    currentUser.preferred_payment === 'cash' ? 'cash' : 'pix'
  );

  // Saved addresses (Passenger)
  const [homeQuery, setHomeQuery] = useState(currentUser.home_address?.address || '');
  const [homeAddr, setHomeAddr] = useState<SavedAddress | null>(currentUser.home_address || null);
  const [workQuery, setWorkQuery] = useState(currentUser.work_address?.address || '');
  const [workAddr, setWorkAddr] = useState<SavedAddress | null>(currentUser.work_address || null);
  const [favorites, setFavorites] = useState<SavedAddress[]>(currentUser.favorites || []);
  const [favQuery, setFavQuery] = useState('');
  const [addrSuggestions, setAddrSuggestions] = useState<
    Array<{ target: 'home' | 'work' | 'favorite'; address: string; subtitle: string; lat: number; lng: number }>
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
  const [newPassword, setNewPassword] = useState('');

  // LGPD delete confirmation & Voice/Sounds/Permissions
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [userPrefs, setUserPrefs] = useState<UserPreferences>(() => getUserPreferences());
  const [permsModalOpen, setPermsModalOpen] = useState(false);
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);

  const localBiasCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const unsub = subscribeUserPreferences(setUserPrefs);
    getCurrentGpsPosition().then((pos) => {
      if (pos) {
        localBiasCoordsRef.current = { lat: pos.lat, lng: pos.lng };
      }
    });
    return () => {
      unsub();
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file, 500);
      setAvatarUrl(compressed);
    } catch {
      setFeedback({ type: 'err', msg: 'Não foi possível processar esta foto.' });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const updated = await updateUserProfileSettings(currentUser, {
        full_name: fullName,
        phone,
        email,
        avatar_url: avatarUrl,
        bio,
        preferred_payment: preferredPayment,
        home_address: homeAddr,
        work_address: workAddr,
        favorites,
        ...(currentUser.driver
          ? {
              vehicle_type: vehicleType,
              vehicle_model: vehicleModel,
              vehicle_plate: vehiclePlate,
              vehicle_color: vehicleColor,
              pix_key: pixKey,
            }
          : {}),
      });
      onUserUpdated(updated);
      setFeedback({ type: 'ok', msg: 'Perfil atualizado com sucesso!' });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Erro ao salvar alterações.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      await changeUserPassword(newPassword);
      setNewPassword('');
      setFeedback({ type: 'ok', msg: 'Senha alterada com segurança.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Falha ao alterar senha.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAnonymizeAccount = async () => {
    setSaving(true);
    try {
      await anonymizeUserAccount();
      onAccountDeleted();
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Falha ao anonimizar conta.',
      });
    } finally {
      setSaving(false);
    }
  };

  const searchSavedAddress = (query: string, target: 'home' | 'work' | 'favorite') => {
    if (target === 'home') setHomeQuery(query);
    else if (target === 'work') setWorkQuery(query);
    else setFavQuery(query);

    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchAbortRef.current?.abort();

    if (query.trim().length < 2) {
      setAddrSuggestions([]);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    searchTimerRef.current = window.setTimeout(async () => {
      const bias = localBiasCoordsRef.current;
      const results = await searchAddresses(query, bias?.lat, bias?.lng, controller.signal);
      if (!controller.signal.aborted) {
        setAddrSuggestions(results.map((r) => ({ ...r, target })));
      }
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-[1150] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="flex h-[88vh] sm:h-auto sm:max-h-[88vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
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
              {section === 'menu' && 'Meu Perfil e Configurações'}
              {section === 'profile' && 'Foto e Personalização'}
              {section === 'password' && 'Alterar Senha'}
              {section === 'addresses' && 'Endereços e Pagamento'}
              {section === 'vehicle' && 'Veículo e Chave Pix'}
              {section === 'prefs' && 'Voz, Sons e Permissões'}
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
              <div className="flex items-center gap-3.5 rounded-2xl bg-neutral-50 p-4 border border-neutral-100">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={currentUser.full_name}
                    className="h-14 w-14 rounded-full object-cover border-2 border-[#FFD100] shrink-0"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] font-display text-xl font-extrabold">
                    {currentUser.full_name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-display text-base font-extrabold text-neutral-950 truncate">
                    {currentUser.full_name}
                  </p>
                  <p className="text-xs text-neutral-500 font-mono-num truncate">
                    {currentUser.phone} · {currentUser.email}
                  </p>
                  {currentUser.bio && (
                    <p className="mt-1 text-xs text-neutral-700 truncate">{currentUser.bio}</p>
                  )}
                </div>
              </div>

              <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSection('profile')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                    <User className="h-4 w-4 text-neutral-600" />
                    Foto de perfil, nome, telefone e recado
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
                  onClick={() => setSection('prefs')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-neutral-50"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-neutral-900">
                    <Volume2 className="h-4 w-4 text-neutral-600" />
                    Voz (PT-BR), Sons, Notificações & Permissões
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
                    Privacidade, Termos, Segurança PIN e LGPD
                  </span>
                  <ChevronRight className="h-4 w-4 text-neutral-400" />
                </button>
              </div>
            </div>
          )}

          {section === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Photo Avatar Uploader */}
              <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="relative">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Foto de perfil"
                      className="h-24 w-24 rounded-full object-cover border-4 border-[#FFD100] shadow"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] font-display text-3xl font-extrabold shadow">
                      {fullName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <label className="absolute -bottom-1 -right-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[#FFD100] text-neutral-950 border-2 border-white shadow">
                    <Camera className="h-4 w-4" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarSelected}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer text-xs font-extrabold text-neutral-950 underline">
                    Escolher foto da galeria / câmera
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarSelected}
                      className="hidden"
                    />
                  </label>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl(null)}
                      className="text-xs font-bold text-red-600"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

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
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Recado / Observação pessoal (opcional)
                </label>
                <input
                  type="text"
                  maxLength={90}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Ex: Ponto próximo à portaria principal"
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-sm outline-none focus:border-neutral-950"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[48px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950"
              >
                {saving ? 'Salvando...' : 'Salvar Perfil Personalizado'}
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
                  placeholder="Rua com número, bairro ou ponto de referência..."
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
                  placeholder="Ex: Galeria Rui Barbosa, Av. Santo Antônio..."
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-xs outline-none focus:border-neutral-950"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 mb-1">
                  <Star className="h-3.5 w-3.5" /> Adicionar Local Favorito
                </label>
                <input
                  type="text"
                  value={favQuery}
                  onChange={(e) => searchSavedAddress(e.target.value, 'favorite')}
                  placeholder="Ex: Parque Euclides Dourado, hospital, mercado..."
                  className="min-h-[46px] w-full rounded-2xl border border-neutral-200 px-3.5 text-xs outline-none focus:border-neutral-950"
                />
              </div>

              {addrSuggestions.length > 0 && (
                <div className="rounded-2xl border border-neutral-200 divide-y divide-neutral-100 max-h-44 overflow-y-auto">
                  {addrSuggestions.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        const saved: SavedAddress = {
                          label:
                            s.target === 'home'
                              ? 'Casa'
                              : s.target === 'work'
                              ? 'Trabalho'
                              : s.address.split('·')[0].trim(),
                          address: s.address,
                          lat: s.lat,
                          lng: s.lng,
                        };
                        if (s.target === 'home') {
                          setHomeAddr(saved);
                          setHomeQuery(s.address);
                        } else if (s.target === 'work') {
                          setWorkAddr(saved);
                          setWorkQuery(s.address);
                        } else {
                          setFavorites((prev) =>
                            prev.some((f) => f.address === saved.address) ? prev : [...prev, saved]
                          );
                          setFavQuery('');
                        }
                        setAddrSuggestions([]);
                      }}
                      className="block w-full px-3.5 py-2.5 text-left text-xs hover:bg-neutral-50"
                    >
                      <p className="font-bold text-neutral-900">{s.address}</p>
                      <p className="text-[10px] text-neutral-500 truncate">{s.subtitle}</p>
                    </button>
                  ))}
                </div>
              )}

              {favorites.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-neutral-500">Favoritos salvos</p>
                  {favorites.map((fav, idx) => (
                    <div
                      key={`${fav.address}-${idx}`}
                      className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs"
                    >
                      <span className="truncate font-semibold text-neutral-800 pr-2">
                        {fav.label} · {fav.address}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setFavorites((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-red-600 font-bold shrink-0 px-2 py-1"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 mb-2">
                  <CreditCard className="h-3.5 w-3.5" /> Pagamento Preferencial
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'pix' as PaymentMethod, label: 'Pix (Copia e Cola)' },
                    { id: 'cash' as PaymentMethod, label: 'Dinheiro' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPreferredPayment(m.id)}
                      className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                        preferredPayment === m.id
                          ? 'bg-neutral-950 text-[#FFD100] border-neutral-950'
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
                className="min-h-[48px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950"
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
                    { id: 'delivery' as const, label: 'Entregador' },
                  ].map((vt) => (
                    <button
                      key={vt.id}
                      type="button"
                      onClick={() => setVehicleType(vt.id)}
                      className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                        vehicleType === vt.id
                          ? 'bg-neutral-950 text-[#FFD100] border-neutral-950'
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
                className="min-h-[48px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950"
              >
                {saving ? 'Salvando...' : 'Atualizar Veículo & Pix'}
              </button>
            </form>
          )}

          {section === 'password' && (
            <form onSubmit={handleChangePassword} className="space-y-3">
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
                className="min-h-[48px] w-full rounded-2xl bg-neutral-950 text-sm font-bold text-[#FFD100]"
              >
                {saving ? 'Alterando...' : 'Confirmar Nova Senha'}
              </button>
            </form>
          )}

          {section === 'prefs' && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {userPrefs.voice_enabled ? (
                      <Volume2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <VolumeX className="h-5 w-5 text-neutral-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm font-extrabold text-neutral-950">
                        Guia por Voz (Português BR)
                      </p>
                      <p className="text-xs text-neutral-600">
                        Lê instruções de rota e avisos da corrida em voz alta.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = saveUserPreferences({
                        voice_enabled: !userPrefs.voice_enabled,
                      });
                      setUserPrefs(next);
                      if (next.voice_enabled) {
                        speakPtBr('Guia por voz ativado em português.');
                      }
                    }}
                    className={`min-h-[36px] shrink-0 rounded-xl px-3.5 text-xs font-extrabold transition ${
                      userPrefs.voice_enabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-200 text-neutral-700'
                    }`}
                  >
                    {userPrefs.voice_enabled ? 'Ativada' : 'Silenciada'}
                  </button>
                </div>
                {userPrefs.voice_enabled && (
                  <button
                    type="button"
                    onClick={() =>
                      speakPtBr('Vire à direita em duzentos metros rumo ao destino.')
                    }
                    className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-900"
                  >
                    Testar voz agora
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {userPrefs.sounds_enabled ? (
                      <Volume2 className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <VolumeX className="h-5 w-5 text-neutral-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm font-extrabold text-neutral-950">
                        Sons e Toques de Alerta
                      </p>
                      <p className="text-xs text-neutral-600">
                        Toca campainha em novas chamadas, aceite e chegada no local.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = saveUserPreferences({
                        sounds_enabled: !userPrefs.sounds_enabled,
                      });
                      setUserPrefs(next);
                      if (next.sounds_enabled) {
                        void playSoundCue('accepted');
                      }
                    }}
                    className={`min-h-[36px] shrink-0 rounded-xl px-3.5 text-xs font-extrabold transition ${
                      userPrefs.sounds_enabled
                        ? 'bg-neutral-950 text-[#FFD100]'
                        : 'bg-neutral-200 text-neutral-700'
                    }`}
                  >
                    {userPrefs.sounds_enabled ? 'Ativados' : 'Mudos'}
                  </button>
                </div>
                {userPrefs.sounds_enabled && (
                  <button
                    type="button"
                    onClick={() => void playSoundCue('offer')}
                    className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-900"
                  >
                    Testar toque sonoro
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Bell className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-extrabold text-neutral-950">
                      Notificações Pop-up no Sistema
                    </p>
                    <p className="text-xs text-neutral-600">
                      Alertas visuais no Android/navegador durante corridas.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = saveUserPreferences({
                      notifications_enabled: !userPrefs.notifications_enabled,
                    });
                    setUserPrefs(next);
                  }}
                  className={`min-h-[36px] shrink-0 rounded-xl px-3.5 text-xs font-extrabold transition ${
                    userPrefs.notifications_enabled
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-200 text-neutral-700'
                  }`}
                >
                  {userPrefs.notifications_enabled ? 'Ativas' : 'Desativadas'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setPermsModalOpen(true)}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                Gerenciar Permissões Android / Navegador (GPS, Câmera, Fotos)
              </button>
            </div>
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
                  • Passageiros validam embarque com PIN de 4 dígitos; em entregas o PIN é opcional
                  e há foto comprobatória no destino.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setLegalDocsOpen(true)}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-neutral-300 bg-white text-xs font-extrabold text-neutral-950 hover:bg-neutral-50"
              >
                <FileText className="h-4 w-4" />
                Ler Termos de Uso, Segurança, Privacidade e Cookies
              </button>

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

      {permsModalOpen && (
        <PermissionsPromptModal
          siteName={platformConfig?.site_name || 'Velo99'}
          onClose={() => setPermsModalOpen(false)}
        />
      )}

      {legalDocsOpen && (
        <LegalDocsModal
          initialTab="terms"
          siteName={platformConfig?.site_name || 'Velo99'}
          onClose={() => setLegalDocsOpen(false)}
        />
      )}
    </div>
  );
};
