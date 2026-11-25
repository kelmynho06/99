import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Bike,
  Briefcase,
  Camera,
  Car,
  Check,
  ChevronRight,
  CreditCard,
  DownloadCloud,
  FileText,
  Globe,
  Headphones,
  Home,
  Lock,
  Moon,
  Package,
  Plus,
  Shield,
  ShieldCheck,
  Star,
  Sun,
  SunMoon,
  Trash2,
  User,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { getCurrentGpsPosition } from '../lib/capacitorDevice';
import {
  getInstalledNativeVersion,
  isNativeAndroidApp,
  syncNativeFloatingBubbleEnabled,
} from '../lib/floatingBubble';
import { formatBRL, searchAddresses } from '../lib/geo';
import { SUPPORTED_LANGUAGES, useTranslation } from '../lib/i18n';
import {
  anonymizeUserAccount,
  changeUserPassword,
  compressImageFileToDataUrl,
  getDriverVehiclesList,
  saveDriverVehiclesAndSelect,
  updateUserLanguagePref,
  updateUserProfileSettings,
} from '../lib/mobilityApi';
import {
  CURRENT_APP_VERSION,
  checkAndApplyWebAutoUpdate,
  checkForOtaUpdate,
  type OtaUpdateInfo,
} from '../lib/otaUpdate';
import { speakPtBr } from '../lib/sound';
import {
  getUserPreferences,
  isDarkThemeActive,
  saveUserPreferences,
  subscribeUserPreferences,
} from '../lib/userPrefs';
import type {
  DriverVehicle,
  PaymentMethod,
  PlatformConfig,
  SavedAddress,
  ThemeMode,
  UserPreferences,
  UserProfile,
} from '../types/mobility';
import { AvatarImage } from './AvatarImage';
import { LegalDocsModal } from './LegalDocsModal';
import { OtaUpdateModal } from './OtaUpdateModal';
import { PermissionsPromptModal } from './PermissionsPromptModal';
import { PWAInstallButton } from './PWAInstallButton';

export type SettingsSection =
  | 'menu'
  | 'profile'
  | 'password'
  | 'addresses'
  | 'vehicle'
  | 'prefs'
  | 'privacy';

interface AccountSettingsModalProps {
  currentUser: UserProfile;
  platformConfig?: PlatformConfig;
  initialSection?: SettingsSection;
  onUserUpdated: (user: UserProfile) => void;
  onAccountDeleted: () => void;
  onOpenWallet?: () => void;
  onOpenSupport?: () => void;
  onClose: () => void;
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  currentUser,
  platformConfig,
  initialSection = 'menu',
  onUserUpdated,
  onAccountDeleted,
  onOpenWallet,
  onOpenSupport,
  onClose,
}) => {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Basic profile + photo personalization
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [phone, setPhone] = useState(currentUser.phone);
  const [email, setEmail] = useState(currentUser.email);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatar_url || null);
  const [bio, setBio] = useState(currentUser.bio || '');
  const [preferredPayment, setPreferredPayment] = useState<PaymentMethod>(
    currentUser.preferred_payment === 'wallet'
      ? 'wallet'
      : currentUser.preferred_payment === 'cash'
      ? 'cash'
      : 'pix'
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

  // Driver multi-vehicle & Pix
  const initialVehData = getDriverVehiclesList(currentUser);
  const [vehiclesList, setVehiclesList] = useState<DriverVehicle[]>(initialVehData.vehicles);
  const [activeVehicleId, setActiveVehicleId] = useState<string>(initialVehData.activeVehicleId);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehType, setNewVehType] = useState<'car' | 'moto' | 'delivery'>('moto');
  const [newVehModel, setNewVehModel] = useState('');
  const [newVehPlate, setNewVehPlate] = useState('');
  const [newVehColor, setNewVehColor] = useState('');

  const [vehicleType, setVehicleType] = useState<'car' | 'moto' | 'delivery'>(
    currentUser.driver?.vehicle_type || 'car'
  );
  const [vehicleModel, setVehicleModel] = useState(currentUser.driver?.vehicle_model || '');
  const [vehiclePlate, setVehiclePlate] = useState(currentUser.driver?.vehicle_plate || '');
  const [vehicleColor, setVehicleColor] = useState(currentUser.driver?.vehicle_color || '');
  const [pixKey, setPixKey] = useState(currentUser.driver?.pix_key || '');

  // Password change
  const [newPassword, setNewPassword] = useState('');

  // LGPD delete confirmation & Voice/Sounds/Permissions/Theme/Language/OTA
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [userPrefs, setUserPrefs] = useState<UserPreferences>(() => getUserPreferences());
  const [permsModalOpen, setPermsModalOpen] = useState(false);
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);
  const [checkingOta, setCheckingOta] = useState(false);
  const [otaUpdateInfo, setOtaUpdateInfo] = useState<OtaUpdateInfo | null>(null);
  const [installedVersion, setInstalledVersion] = useState(CURRENT_APP_VERSION);

  const localBiasCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const unsub = subscribeUserPreferences(setUserPrefs);
    getInstalledNativeVersion(CURRENT_APP_VERSION).then(setInstalledVersion).catch(() => {});
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

  useEffect(() => {
    setAvatarUrl(currentUser.avatar_url || null);
  }, [currentUser.avatar_url]);

  useEffect(() => {
    const next = getDriverVehiclesList(currentUser);
    setVehiclesList(next.vehicles);
    setActiveVehicleId(next.activeVehicleId);
    if (currentUser.driver) {
      setVehicleType(currentUser.driver.vehicle_type);
      setVehicleModel(currentUser.driver.vehicle_model);
      setVehiclePlate(currentUser.driver.vehicle_plate);
      setVehicleColor(currentUser.driver.vehicle_color);
      setPixKey(currentUser.driver.pix_key);
    }
  }, [currentUser]);

  const handleSelectSavedVehicle = async (veh: DriverVehicle) => {
    setFeedback(null);
    setSaving(true);
    try {
      const updated = await saveDriverVehiclesAndSelect(
        currentUser.id,
        vehiclesList,
        veh.id,
        pixKey
      );
      onUserUpdated(updated);
      setActiveVehicleId(veh.id);
      setVehicleType(veh.vehicle_type);
      setVehicleModel(veh.vehicle_model);
      setVehiclePlate(veh.vehicle_plate);
      setVehicleColor(veh.vehicle_color);
      setFeedback({
        type: 'ok',
        msg: `Veículo ativo alterado para ${
          veh.vehicle_type === 'moto'
            ? 'Moto'
            : veh.vehicle_type === 'delivery'
            ? 'Entregador'
            : 'Carro'
        } (${veh.vehicle_model}). Você receberá apenas solicitações compatíveis.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Erro ao trocar veículo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehModel.trim() || !newVehPlate.trim() || !newVehColor.trim()) {
      setFeedback({ type: 'err', msg: 'Preencha modelo, placa e cor do novo veículo.' });
      return;
    }
    setFeedback(null);
    setSaving(true);
    try {
      const created: DriverVehicle = {
        id: `veh-${Date.now().toString(36)}`,
        vehicle_type: newVehType,
        vehicle_model: newVehModel.trim(),
        vehicle_plate: newVehPlate.trim().toUpperCase(),
        vehicle_color: newVehColor.trim(),
      };
      const nextList = [...vehiclesList, created];
      const updated = await saveDriverVehiclesAndSelect(
        currentUser.id,
        nextList,
        created.id,
        pixKey
      );
      onUserUpdated(updated);
      setVehiclesList(nextList);
      setActiveVehicleId(created.id);
      setVehicleType(created.vehicle_type);
      setVehicleModel(created.vehicle_model);
      setVehiclePlate(created.vehicle_plate);
      setVehicleColor(created.vehicle_color);
      setNewVehModel('');
      setNewVehPlate('');
      setNewVehColor('');
      setShowAddVehicle(false);
      setFeedback({
        type: 'ok',
        msg: `Novo veículo (${created.vehicle_model}) cadastrado e ativado com sucesso!`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Erro ao cadastrar veículo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSavedVehicle = async (vehId: string) => {
    if (vehiclesList.length <= 1) return;
    setFeedback(null);
    setSaving(true);
    try {
      const nextList = vehiclesList.filter((v) => v.id !== vehId);
      const nextActive =
        vehId === activeVehicleId ? nextList[0].id : activeVehicleId;
      const updated = await saveDriverVehiclesAndSelect(
        currentUser.id,
        nextList,
        nextActive,
        pixKey
      );
      onUserUpdated(updated);
      setFeedback({ type: 'ok', msg: 'Veículo removido da sua conta.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Erro ao remover veículo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLanguageChange = async (langCode: string) => {
    const next = saveUserPreferences({ language: langCode });
    setUserPrefs(next);
    await updateUserLanguagePref(currentUser.id, langCode).catch(() => {});
    onUserUpdated({ ...currentUser, preferred_language: langCode });
    const meta = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
    setFeedback({
      type: 'ok',
      msg: `Idioma alterado para ${meta?.nativeName || langCode}.`,
    });
  };

  const handleThemeChange = (mode: ThemeMode) => {
    const next = saveUserPreferences({ theme_mode: mode });
    setUserPrefs(next);
  };

  const handleCheckOta = async () => {
    setCheckingOta(true);
    setFeedback(null);
    try {
      if (!isNativeAndroidApp()) {
        const reloaded = await checkAndApplyWebAutoUpdate();
        if (!reloaded) {
          setFeedback({
            type: 'ok',
            msg: `Site atualizado automaticamente (v${installedVersion}).`,
          });
        }
        return;
      }
      const info = await checkForOtaUpdate(platformConfig);
      if (info.hasUpdate) {
        setOtaUpdateInfo(info);
      } else {
        setFeedback({
          type: 'ok',
          msg: `Você já está na versão mais recente do APK (v${info.currentVersion}).`,
        });
      }
    } catch {
      setFeedback({
        type: 'err',
        msg: 'Não foi possível verificar atualizações agora.',
      });
    } finally {
      setCheckingOta(false);
    }
  };

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file, 512, 0.7);
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

  const activeDarkResolved = isDarkThemeActive(userPrefs.theme_mode);

  return (
    <div className="fixed inset-0 z-[1150] flex items-end sm:items-center justify-center bg-[#0F172A]/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="flex h-[90vh] sm:h-auto sm:max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white text-[#0F172A] shadow-2xl overflow-hidden border border-[#E2E8F0]">
        {/* Header */}
        <div className="aurora-surface-flow flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div className="flex items-center gap-2">
            {section !== 'menu' && (
              <button
                type="button"
                onClick={() => {
                  setSection('menu');
                  setFeedback(null);
                }}
                className="flex h-9 px-2.5 items-center justify-center rounded-xl bg-[#F1F5F9] border border-[#E2E8F0] text-xs font-bold text-[#0F172A] hover:bg-[#E2E8F0]"
              >
                {t.back}
              </button>
            )}
            <h3 className="font-display text-lg font-extrabold text-[#0F172A]">
              {section === 'menu' && t.settings_title}
              {section === 'profile' && 'Foto e Personalização'}
              {section === 'password' && 'Alterar Senha'}
              {section === 'addresses' && 'Endereços e Pagamento'}
              {section === 'vehicle' && 'Veículo e Chave Pix'}
              {section === 'prefs' && 'Idioma, Tema, Voz & Permissões'}
              {section === 'privacy' && t.privacy_security}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#E2E8F0] text-[#475569] hover:text-[#0F172A] hover:bg-[#F4F6F9]"
            aria-label="Fechar configurações"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white p-5 space-y-4">
          {feedback && (
            <div
              className={`rounded-2xl px-4 py-3 text-xs font-bold ${
                feedback.type === 'ok'
                  ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {feedback.msg}
            </div>
          )}

          {section === 'menu' && (
            <div className="space-y-4">
              {/* Profile Summary Card */}
              <div className="flex items-center gap-3.5 rounded-2xl bg-[#F4F6F9] p-4 border border-[#E2E8F0]">
                <AvatarImage
                  src={avatarUrl}
                  name={currentUser.full_name}
                  className="h-14 w-14 rounded-full object-cover border-2 border-[#2563EB] shrink-0"
                  fallbackClassName="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-white font-display text-xl font-extrabold"
                />
                <div className="min-w-0">
                  <p className="font-display text-base font-extrabold text-[#0F172A] truncate">
                    {currentUser.full_name}
                  </p>
                  <p className="text-xs text-[#475569] font-mono-num truncate">
                    {currentUser.phone} · {currentUser.email}
                  </p>
                  {currentUser.bio && (
                    <p className="mt-1 text-xs text-[#475569] truncate">{currentUser.bio}</p>
                  )}
                </div>
              </div>

              {/* Quick Theme & Language Switchers */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-extrabold text-[#0F172A]">
                    <SunMoon className="h-4 w-4 text-[#2563EB]" />
                    {t.theme_label}
                  </span>
                  <span className="text-[10px] font-bold text-[#475569]">
                    Ativo: {activeDarkResolved ? t.theme_dark : t.theme_light}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'light' as ThemeMode, label: t.theme_light, icon: Sun },
                    { id: 'dark' as ThemeMode, label: t.theme_dark, icon: Moon },
                    { id: 'auto' as ThemeMode, label: 'Auto 18h-06h', icon: SunMoon },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const active = userPrefs.theme_mode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleThemeChange(opt.id)}
                        className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border px-2 text-[11px] font-extrabold transition ${
                          active
                            ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-xs'
                            : 'bg-white text-[#475569] border-[#E2E8F0] hover:text-[#0F172A]'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#475569]">
                  {t.theme_auto_hint}
                </p>

                <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs font-extrabold text-[#0F172A] shrink-0">
                    <Globe className="h-4 w-4 text-[#2563EB]" />
                    {t.language_label}
                  </span>
                  <select
                    value={userPrefs.language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="min-h-[38px] max-w-[190px] rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-xs font-bold text-[#0F172A] outline-none focus:border-[#2563EB]"
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.nativeName} ({lang.label})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Navigation Menu List */}
              <div className="divide-y divide-[#E2E8F0] rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSection('profile')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                    <User className="h-4 w-4 text-[#475569]" />
                    Foto de perfil, nome, telefone e recado
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#475569]" />
                </button>

                {onOpenWallet && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenWallet();
                    }}
                    className="flex min-h-[58px] w-full items-center justify-between px-4 text-left bg-[#ECFDF5] hover:bg-[#D1FAE5]/70"
                  >
                    <span className="flex items-center gap-3 text-sm font-extrabold text-[#0F172A]">
                      <Wallet className="h-4 w-4 text-[#10B981]" />
                      <span>
                        {t.wallet_title} ({currentUser.role === 'driver' ? `${t.withdraw} / ${t.transfer}` : `${t.deposit} / ${t.transfer}`})
                        <span className="block text-[11px] font-mono-num font-bold text-[#059669]">
                          {t.wallet_balance}: {formatBRL(currentUser.wallet_balance || 0)}
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-[#059669]" />
                  </button>
                )}

                {currentUser.role === 'passenger' && (
                  <button
                    type="button"
                    onClick={() => setSection('addresses')}
                    className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                      <Home className="h-4 w-4 text-[#475569]" />
                      Endereços (Casa, Trabalho) e Pagamento
                    </span>
                    <ChevronRight className="h-4 w-4 text-[#475569]" />
                  </button>
                )}

                {currentUser.role === 'driver' && (
                  <button
                    type="button"
                    onClick={() => setSection('vehicle')}
                    className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                      <Car className="h-4 w-4 text-[#475569]" />
                      Veículo e Chave Pix de repasse
                    </span>
                    <ChevronRight className="h-4 w-4 text-[#475569]" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSection('password')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                    <Lock className="h-4 w-4 text-[#475569]" />
                    Alterar senha de acesso
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#475569]" />
                </button>

                <button
                  type="button"
                  onClick={() => setSection('prefs')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                    <Volume2 className="h-4 w-4 text-[#475569]" />
                    {t.voice_sounds_btn}
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#475569]" />
                </button>

                {onOpenSupport && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSupport();
                    }}
                    className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                      <Headphones className="h-4 w-4 text-[#2563EB]" />
                      {t.support_admin}
                    </span>
                    <ChevronRight className="h-4 w-4 text-[#475569]" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSection('privacy')}
                  className="flex min-h-[54px] w-full items-center justify-between px-4 text-left hover:bg-[#F4F6F9]"
                >
                  <span className="flex items-center gap-3 text-sm font-bold text-[#0F172A]">
                    <Shield className="h-4 w-4 text-[#475569]" />
                    {t.privacy_security}
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#475569]" />
                </button>
              </div>

              {/* Quick Accessibility 1-tap Mute/Unmute */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {userPrefs.voice_enabled || userPrefs.sounds_enabled ? (
                    <Volume2 className="h-4 w-4 text-[#2563EB] shrink-0" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-[#475569] shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-[#0F172A] truncate">
                      {t.quick_access_title}
                    </p>
                    <p className="text-[11px] text-[#475569] truncate">
                      {userPrefs.voice_enabled || userPrefs.sounds_enabled || userPrefs.notifications_enabled
                        ? t.quick_access_all_on
                        : t.quick_access_all_off}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const anyOn =
                      userPrefs.voice_enabled ||
                      userPrefs.sounds_enabled ||
                      userPrefs.notifications_enabled;
                    const next = saveUserPreferences({
                      voice_enabled: !anyOn,
                      sounds_enabled: !anyOn,
                      notifications_enabled: !anyOn,
                    });
                    setUserPrefs(next);
                  }}
                  className={`min-h-[36px] shrink-0 rounded-xl px-3 text-xs font-extrabold transition ${
                    userPrefs.voice_enabled || userPrefs.sounds_enabled
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#10B981] text-white'
                  }`}
                >
                  {userPrefs.voice_enabled || userPrefs.sounds_enabled
                    ? t.mute_all_btn
                    : t.unmute_all_btn}
                </button>
              </div>

              {/* App Version & OTA Check Card */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-4 py-3">
                <div>
                  <p className="text-[11px] font-bold text-[#475569]">
                    {t.app_version_label}
                  </p>
                  <p className="font-mono-num text-sm font-extrabold text-[#0F172A]">
                    v{installedVersion} · {platformConfig?.site_name || 'Go Driver Mobilidade'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={checkingOta}
                  onClick={handleCheckOta}
                  className="aurora-accent-flow inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 text-xs font-extrabold text-white disabled:opacity-50"
                >
                  <DownloadCloud className="h-3.5 w-3.5" />
                  {checkingOta ? t.checking_updates : t.check_updates}
                </button>
              </div>

              {/* Install Android APK & iOS PWA Section */}
              <PWAInstallButton
                variant="settings"
                apkUrl={platformConfig?.ota_apk_url}
                siteName={platformConfig?.site_name || 'Go Driver Mobilidade'}
              />
            </div>
          )}

          {section === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4">
                <div className="relative">
                  <AvatarImage
                    src={avatarUrl}
                    name={fullName || currentUser.full_name}
                    className="h-24 w-24 rounded-full object-cover border-4 border-[#2563EB] shadow"
                    fallbackClassName="flex h-24 w-24 items-center justify-center rounded-full bg-[#2563EB] text-white font-display text-3xl font-extrabold shadow"
                  />
                  <label className="aurora-accent-flow absolute -bottom-1 -right-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-white border-2 border-white shadow">
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
                  <label className="cursor-pointer text-xs font-extrabold text-[#2563EB] underline">
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
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  {t.profile_full_name}
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  {t.profile_phone}
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">{t.profile_email}</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  {t.profile_bio}
                </label>
                <input
                  type="text"
                  maxLength={90}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Ex: Ponto próximo à portaria principal"
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="aurora-accent-flow min-h-[48px] w-full rounded-2xl text-sm font-extrabold text-white"
              >
                {saving ? t.saving : t.save_changes}
              </button>
            </form>
          )}

          {section === 'addresses' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-[#475569] mb-1">
                  <Home className="h-3.5 w-3.5" /> Endereço de Casa
                </label>
                <input
                  type="text"
                  value={homeQuery}
                  onChange={(e) => searchSavedAddress(e.target.value, 'home')}
                  placeholder="Rua com número, bairro ou ponto de referência..."
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-[#475569] mb-1">
                  <Briefcase className="h-3.5 w-3.5" /> Endereço de Trabalho
                </label>
                <input
                  type="text"
                  value={workQuery}
                  onChange={(e) => searchSavedAddress(e.target.value, 'work')}
                  placeholder="Ex: Galeria Rui Barbosa, Av. Santo Antônio..."
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-[#475569] mb-1">
                  <Star className="h-3.5 w-3.5" /> Adicionar Local Favorito
                </label>
                <input
                  type="text"
                  value={favQuery}
                  onChange={(e) => searchSavedAddress(e.target.value, 'favorite')}
                  placeholder="Ex: Parque Euclides Dourado, hospital, mercado..."
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>

              {addrSuggestions.length > 0 && (
                <div className="rounded-2xl border border-[#E2E8F0] divide-y divide-[#E2E8F0] max-h-44 overflow-y-auto bg-white">
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
                      className="block w-full px-3.5 py-2.5 text-left text-xs hover:bg-[#F4F6F9]"
                    >
                      <p className="font-bold text-[#0F172A]">{s.address}</p>
                      <p className="text-[10px] text-[#475569] truncate">{s.subtitle}</p>
                    </button>
                  ))}
                </div>
              )}

              {favorites.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-[#475569]">Favoritos salvos</p>
                  {favorites.map((fav, idx) => (
                    <div
                      key={`${fav.address}-${idx}`}
                      className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F4F6F9] px-3 py-2 text-xs"
                    >
                      <span className="truncate font-semibold text-[#0F172A] pr-2">
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

              {onOpenWallet && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-4 text-[#0F172A]">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-[#059669]">Saldo GoPay disponível</p>
                    <p className="mt-0.5 font-mono-num text-xl font-extrabold text-[#10B981]">
                      {formatBRL(currentUser.wallet_balance || 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenWallet();
                    }}
                    className="aurora-accent-flow min-h-[42px] shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-extrabold text-white"
                  >
                    Abrir Carteira GoPay
                  </button>
                </div>
              )}

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-[#475569] mb-2">
                  <CreditCard className="h-3.5 w-3.5" /> Pagamento Preferencial
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'wallet' as PaymentMethod, label: 'Saldo App' },
                    { id: 'pix' as PaymentMethod, label: 'Pix' },
                    { id: 'cash' as PaymentMethod, label: 'Dinheiro' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPreferredPayment(m.id)}
                      className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                        preferredPayment === m.id
                          ? 'bg-[#2563EB] text-white border-[#2563EB]'
                          : 'bg-[#F4F6F9] text-[#0F172A] border-[#E2E8F0]'
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
                className="aurora-accent-flow min-h-[48px] w-full rounded-2xl text-sm font-extrabold text-white"
              >
                {saving ? t.saving : 'Salvar Favoritos'}
              </button>
            </form>
          )}

          {section === 'vehicle' && (
            <div className="space-y-4">
              {/* Registered Vehicles Switcher */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-[#0F172A]">
                      Meus Veículos Cadastrados ({vehiclesList.length})
                    </p>
                    <p className="text-[11px] text-[#475569]">
                      Você só recebe chamadas compatíveis com o veículo ativo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddVehicle((v) => !v)}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl bg-[#2563EB] px-3 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {showAddVehicle ? 'Fechar' : 'Novo Veículo'}
                  </button>
                </div>

                <div className="space-y-2">
                  {vehiclesList.map((veh) => {
                    const isActive = veh.id === activeVehicleId;
                    const Icon =
                      veh.vehicle_type === 'moto'
                        ? Bike
                        : veh.vehicle_type === 'delivery'
                        ? Package
                        : Car;
                    const typeLabel =
                      veh.vehicle_type === 'moto'
                        ? 'Moto (Corridas & Entregas Moto)'
                        : veh.vehicle_type === 'delivery'
                        ? 'Entregador (Entregas)'
                        : 'Carro (Pop, Negocia & Entregas Carro)';
                    return (
                      <div
                        key={veh.id}
                        className={`flex items-center justify-between gap-2 rounded-2xl border p-3 transition ${
                          isActive
                            ? 'border-[#2563EB] bg-white shadow-xs'
                            : 'border-[#E2E8F0] bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              isActive
                                ? 'bg-[#2563EB] text-white'
                                : 'bg-[#F4F6F9] text-[#475569]'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-extrabold text-[#0F172A] truncate">
                              {veh.vehicle_model || 'Veículo'} ·{' '}
                              <span className="font-mono-num">{veh.vehicle_plate}</span>
                            </p>
                            <p className="text-[10px] text-[#475569] truncate">
                              {typeLabel} · {veh.vehicle_color}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-1 text-[10px] font-extrabold text-[#059669]">
                              <Check className="h-3 w-3" />
                              Ativo
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleSelectSavedVehicle(veh)}
                              className="min-h-[34px] rounded-xl bg-[#2563EB] px-2.5 text-[11px] font-extrabold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                            >
                              Usar este
                            </button>
                          )}
                          {vehiclesList.length > 1 && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleRemoveSavedVehicle(veh.id)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                              aria-label="Remover veículo"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {showAddVehicle && (
                  <form
                    onSubmit={handleAddNewVehicle}
                    className="rounded-2xl border border-[#BFDBFE] bg-white p-3.5 space-y-2.5"
                  >
                    <p className="text-xs font-extrabold text-[#0F172A]">
                      Cadastrar Novo Veículo
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'car' as const, label: 'Carro' },
                        { id: 'moto' as const, label: 'Moto' },
                        { id: 'delivery' as const, label: 'Entregador' },
                      ].map((vt) => (
                        <button
                          key={vt.id}
                          type="button"
                          onClick={() => setNewVehType(vt.id)}
                          className={`min-h-[38px] rounded-xl border text-xs font-bold ${
                            newVehType === vt.id
                              ? 'bg-[#2563EB] text-white border-[#2563EB]'
                              : 'bg-[#F4F6F9] text-[#475569] border-[#E2E8F0]'
                          }`}
                        >
                          {vt.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      required
                      value={newVehModel}
                      onChange={(e) => setNewVehModel(e.target.value)}
                      placeholder="Modelo (Ex: Honda CG 160 / Onix)"
                      className="min-h-[42px] w-full rounded-xl border border-[#E2E8F0] bg-[#F4F6F9] px-3 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={newVehPlate}
                        onChange={(e) => setNewVehPlate(e.target.value.toUpperCase())}
                        placeholder="Placa (ABC1D23)"
                        className="min-h-[42px] rounded-xl border border-[#E2E8F0] bg-[#F4F6F9] px-3 font-mono-num text-xs uppercase text-[#0F172A] outline-none focus:border-[#2563EB]"
                      />
                      <input
                        type="text"
                        required
                        value={newVehColor}
                        onChange={(e) => setNewVehColor(e.target.value)}
                        placeholder="Cor"
                        className="min-h-[42px] rounded-xl border border-[#E2E8F0] bg-[#F4F6F9] px-3 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={saving}
                      className="aurora-accent-flow min-h-[42px] w-full rounded-xl text-xs font-extrabold text-white"
                    >
                      {saving ? t.saving : 'Adicionar e Ativar Veículo'}
                    </button>
                  </form>
                )}
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-3">
                <p className="text-xs font-extrabold text-[#0F172A]">
                  Editar Veículo Ativo & Chave Pix
                </p>
                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    Categoria do Veículo Ativo
                  </label>
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
                            ? 'bg-[#2563EB] text-white border-[#2563EB]'
                            : 'bg-[#F4F6F9] text-[#475569] border-[#E2E8F0]'
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
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    required
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                    placeholder="Placa"
                    className="min-h-[46px] rounded-2xl border border-[#E2E8F0] bg-white px-3.5 font-mono-num text-sm uppercase text-[#0F172A] outline-none focus:border-[#2563EB]"
                  />
                  <input
                    type="text"
                    required
                    value={vehicleColor}
                    onChange={(e) => setVehicleColor(e.target.value)}
                    placeholder="Cor"
                    className="min-h-[46px] rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    Chave Pix para repasses
                  </label>
                  <input
                    type="text"
                    required
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 font-mono-num text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="aurora-accent-flow min-h-[48px] w-full rounded-2xl text-sm font-extrabold text-white"
                >
                  {saving ? t.saving : 'Atualizar Veículo & Pix'}
                </button>
              </form>
            </div>
          )}

          {section === 'password' && (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1">
                  Nova senha (mínimo 6 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB]"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="aurora-accent-flow min-h-[48px] w-full rounded-2xl text-sm font-bold text-white"
              >
                {saving ? 'Alterando...' : 'Confirmar Nova Senha'}
              </button>
            </form>
          )}

          {section === 'prefs' && (
            <div className="space-y-3">
              {/* Accessibility 1-Tap Master Switch */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-4">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-[#0F172A]">
                    {t.access_general_title}
                  </p>
                  <p className="text-xs text-[#475569]">
                    {t.access_general_desc}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const anyOn =
                      userPrefs.voice_enabled ||
                      userPrefs.sounds_enabled ||
                      userPrefs.notifications_enabled;
                    const next = saveUserPreferences({
                      voice_enabled: !anyOn,
                      sounds_enabled: !anyOn,
                      notifications_enabled: !anyOn,
                    });
                    setUserPrefs(next);
                  }}
                  className={`min-h-[40px] shrink-0 rounded-xl px-3.5 text-xs font-extrabold transition ${
                    userPrefs.voice_enabled ||
                    userPrefs.sounds_enabled ||
                    userPrefs.notifications_enabled
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#10B981] text-white'
                  }`}
                >
                  {userPrefs.voice_enabled ||
                  userPrefs.sounds_enabled ||
                  userPrefs.notifications_enabled
                    ? t.mute_all_btn
                    : t.unmute_all_btn}
                </button>
              </div>

              {/* Language Selector Grid */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4 space-y-2.5">
                <p className="flex items-center gap-2 text-sm font-extrabold text-[#0F172A]">
                  <Globe className="h-4 w-4 text-[#2563EB]" />
                  {t.language_label}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`rounded-xl border px-2.5 py-2 text-left text-xs transition ${
                        userPrefs.language === lang.code
                          ? 'bg-[#2563EB] text-white border-[#2563EB] font-extrabold'
                          : 'bg-white text-[#0F172A] border-[#E2E8F0] font-bold'
                      }`}
                    >
                      <span className="block truncate">{lang.nativeName}</span>
                      <span className="block text-[10px] opacity-75 truncate">{lang.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Guide */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {userPrefs.voice_enabled ? (
                      <Volume2 className="h-5 w-5 text-[#2563EB] shrink-0 mt-0.5" />
                    ) : (
                      <VolumeX className="h-5 w-5 text-[#475569] shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm font-extrabold text-[#0F172A]">
                        {t.voice_assistant_title}
                      </p>
                      <p className="text-xs text-[#475569]">
                        {t.voice_assistant_desc}
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
                        speakPtBr('Oi! Aqui é a Évelyn, da Go Driver. Que bom falar com você — minha voz já está ativada!', true);
                      }
                    }}
                    className={`min-h-[36px] shrink-0 rounded-xl px-3.5 text-xs font-extrabold transition ${
                      userPrefs.voice_enabled
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-[#E2E8F0] text-[#475569]'
                    }`}
                  >
                    {userPrefs.voice_enabled ? t.voice_enabled_badge : t.voice_muted_badge}
                  </button>
                </div>
                {userPrefs.voice_enabled && (
                  <button
                    type="button"
                    onClick={() =>
                      speakPtBr('Oi! Aqui é a Évelyn, da Go Driver. Vou acompanhar cada detalhe da sua viagem com calma e clareza. Tudo pronto para seguir!', true)
                    }
                    className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-bold text-[#0F172A] hover:bg-[#F1F5F9]"
                  >
                    {t.voice_test_btn}
                  </button>
                )}
              </div>

              {/* System Notifications (Background only) */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Bell className="h-5 w-5 text-[#2563EB] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-extrabold text-[#0F172A]">
                      {t.bg_alerts_title}
                    </p>
                    <p className="text-xs text-[#475569]">
                      {t.bg_alerts_desc}
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
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#E2E8F0] text-[#475569]'
                  }`}
                >
                  {userPrefs.notifications_enabled ? t.alerts_active_badge : t.alerts_off_badge}
                </button>
              </div>

              {/* Background-Only Floating Bubble Toggle */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 text-[#2563EB] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-extrabold text-[#0F172A]">
                      {t.bubble_bg_title}
                    </p>
                    <p className="text-xs text-[#475569]">
                      {t.bubble_bg_desc}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const enabled = !(userPrefs.floating_bubble_enabled ?? true);
                    const next = saveUserPreferences({
                      floating_bubble_enabled: enabled,
                    });
                    setUserPrefs(next);
                    void syncNativeFloatingBubbleEnabled(enabled);
                  }}
                  className={`min-h-[36px] shrink-0 rounded-xl px-3.5 text-xs font-extrabold transition ${
                    (userPrefs.floating_bubble_enabled ?? true)
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#E2E8F0] text-[#475569]'
                  }`}
                >
                  {(userPrefs.floating_bubble_enabled ?? true) ? t.bubble_active_badge : t.bubble_hidden_badge}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setPermsModalOpen(true)}
                className="aurora-accent-flow flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                {t.permissions_btn}
              </button>
            </div>
          )}

          {section === 'privacy' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-4 text-xs text-[#475569] space-y-2 leading-relaxed">
                <p className="font-extrabold text-[#0F172A]">
                  Política de Privacidade, Segurança e Isolamento de Dados (RLS)
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
                  • Passageiros e entregadores validam a corrida ou entrega exclusivamente através
                  do código PIN de 4 dígitos (sem necessidade de fotos de pacotes).
                </p>
              </div>

              <button
                type="button"
                onClick={() => setLegalDocsOpen(true)}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9] text-xs font-extrabold text-[#0F172A] hover:bg-[#E2E8F0]"
              >
                <FileText className="h-4 w-4 text-[#2563EB]" />
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
                      className="min-h-[44px] flex-1 rounded-xl bg-white border border-[#E2E8F0] text-xs font-bold text-[#0F172A]"
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
          siteName={platformConfig?.site_name || 'Go Driver Mobilidade'}
          onClose={() => setPermsModalOpen(false)}
        />
      )}

      {legalDocsOpen && (
        <LegalDocsModal
          initialTab="terms"
          siteName={platformConfig?.site_name || 'Go Driver Mobilidade'}
          onClose={() => setLegalDocsOpen(false)}
        />
      )}

      {otaUpdateInfo && (
        <OtaUpdateModal
          updateInfo={otaUpdateInfo}
          siteName={platformConfig?.site_name || 'Go Driver Mobilidade'}
          onClose={() => setOtaUpdateInfo(null)}
        />
      )}
    </div>
  );
};
