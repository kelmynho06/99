import React, { useState } from 'react';
import {
  Bike,
  Car,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Mail,
  MapPin,
  Package,
  Phone,
  ShieldCheck,
  Upload,
  User,
} from 'lucide-react';
import { useAppConfig } from '../context/AppConfigContext';
import { logAuditEvent } from '../lib/audit';
import { handleBrandImageError, resolveBrandLogo } from '../lib/brandAssets';
import { SUPPORTED_LANGUAGES, useTranslation } from '../lib/i18n';
import {
  compressImageFileToDataUrl,
  loginUser,
  registerUser,
} from '../lib/mobilityApi';
import { primeSpeechEngine } from '../lib/sound';
import {
  getUserPreferences,
  markExplicitLanguageChoice,
  saveUserPreferences,
} from '../lib/userPrefs';
import type { DriverServiceMode, PlatformConfig, UserProfile } from '../types/mobility';
import { LegalDocsModal, type LegalDocTab } from './LegalDocsModal';

interface AuthScreenProps {
  onAuthenticated: (user: UserProfile) => void;
  platformConfig?: PlatformConfig;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  platformConfig,
}) => {
  const { t, lang } = useTranslation();
  const { config: appConfig } = useAppConfig();
  const siteName = platformConfig?.site_name || appConfig.app_name || 'Go Driver Mobilidade';
  const customLogoUrl = platformConfig?.app_logo_url ?? appConfig.logo_url;
  const brandLogoUrl = resolveBrandLogo({
    app_logo_url: customLogoUrl,
  } as PlatformConfig);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [accountGoal, setAccountGoal] = useState<'passenger' | 'driver'>('passenger');
  const [showPassword, setShowPassword] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');

  const [vehicleType, setVehicleType] = useState<'car' | 'moto' | 'delivery'>('car');
  const [serviceMode, setServiceMode] = useState<DriverServiceMode>('both');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [cnhPreview, setCnhPreview] = useState<string>('');
  const [crlvPreview, setCrlvPreview] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalDocTab | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  const handleLanguageChange = (nextLang: string) => {
    markExplicitLanguageChoice();
    saveUserPreferences({ language: nextLang });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    primeSpeechEngine();
    setError(null);
    setInfoNotice(null);
    setLoading(true);
    try {
      const user = await loginUser(loginEmail, loginPassword);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth_err_login);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'cnh' | 'crlv'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file);
      if (target === 'cnh') setCnhPreview(compressed);
      else setCrlvPreview(compressed);
    } catch {
      setError(t.auth_err_image);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    primeSpeechEngine();
    setError(null);
    setInfoNotice(null);

    if (!acceptedTerms) {
      setError(t.auth_err_terms);
      return;
    }

    if (accountGoal === 'driver' && (!cnhPreview || !crlvPreview)) {
      setError(t.auth_err_driver_docs);
      return;
    }

    setLoading(true);
    try {
      const result = await registerUser({
        role: accountGoal,
        full_name: fullName,
        phone,
        email,
        cpf,
        password,
        ...(accountGoal === 'driver'
          ? {
              cnh_url: cnhPreview,
              crlv_url: crlvPreview,
              vehicle_type: vehicleType,
              service_mode: serviceMode,
              vehicle_model: vehicleModel,
              vehicle_plate: vehiclePlate,
              vehicle_color: vehicleColor,
              pix_key: pixKey,
            }
          : {}),
      });

      if (result.pendingEmailConfirmation) {
        setInfoNotice(t.auth_email_confirm_notice);
        setMode('login');
        setLoginEmail(email.trim().toLowerCase());
        return;
      }

      if (result.user) {
        void logAuditEvent({
          user: result.user,
          event_type: 'register',
          description: `Nova conta cadastrada (${result.user.role})`,
        });
        onAuthenticated(result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth_err_register);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col lg:flex-row">
      {/* Light vibrant showcase column */}
      <div className="relative overflow-hidden aurora-surface-flow border-b lg:border-b-0 lg:border-r border-[#E2E8F0] px-6 py-8 lg:w-[44%] lg:px-12 lg:py-12 flex flex-col justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-[#2563EB]/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-[#0EA5E9]/12 blur-3xl"
        />

        <div className="relative z-10">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <img
                src={brandLogoUrl}
                alt={siteName}
                referrerPolicy="no-referrer"
                onError={(e) => handleBrandImageError(e)}
                className="h-12 w-12 rounded-2xl object-cover bg-white shadow-md border border-[#E2E8F0]"
              />
              <div>
                <span className="font-display text-2xl font-extrabold tracking-tight text-[#0F172A] block leading-none">
                  {siteName}
                </span>
                <span className="mt-1 inline-block text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#2563EB]">
                  {t.brand_tagline}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={lang || getUserPreferences().language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                aria-label={t.language_label}
                className="min-h-[38px] rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-xs font-extrabold text-[#0F172A] outline-none shadow-xs cursor-pointer focus:border-[#2563EB]"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h1 className="mt-8 font-display text-3xl sm:text-4xl font-extrabold leading-tight text-[#0F172A] [text-wrap:balance]">
            {t.auth_hero_title}
          </h1>
          <p className="mt-3 text-sm sm:text-base font-medium text-[#475569] max-w-md">
            {t.auth_hero_subtitle}
          </p>
        </div>

        <div className="relative z-10 mt-8 hidden lg:grid grid-cols-1 gap-4">
          <div className="rounded-2xl bg-white/95 backdrop-blur-sm border border-[#E2E8F0] p-4 shadow-xs">
            <div className="flex items-center gap-3 text-[#2563EB]">
              <MapPin className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold text-[#0F172A]">{t.auth_feature_map_title}</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-[#475569]">
              {t.auth_feature_map_desc}
            </p>
          </div>
          <div className="rounded-2xl bg-white/95 backdrop-blur-sm border border-[#E2E8F0] p-4 shadow-xs">
            <div className="flex items-center gap-3 text-[#0EA5E9]">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold text-[#0F172A]">{t.auth_feature_sec_title}</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-[#475569]">
              {t.auth_feature_sec_desc}
            </p>
          </div>
        </div>

        <div className="relative z-10 mt-6 hidden lg:block text-xs font-semibold text-[#475569]">
          {siteName} · {t.auth_footer_platforms}
        </div>
      </div>

      {/* Form column */}
      <div className="flex-1 px-4 py-6 sm:px-8 lg:px-14 lg:py-10 flex items-start lg:items-center justify-center overflow-y-auto">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-sm border border-[#E2E8F0]">
          {/* Segmented mode switch */}
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#F4F6F9] p-1.5 border border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`min-h-[44px] rounded-xl text-sm font-bold transition ${
                mode === 'login'
                  ? 'aurora-accent-flow text-white shadow-sm'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {t.auth_tab_login}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`min-h-[44px] rounded-xl text-sm font-bold transition ${
                mode === 'register'
                  ? 'aurora-accent-flow text-white shadow-sm'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {t.auth_tab_register}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {infoNotice && (
            <div className="mt-4 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-sm font-medium text-[#059669]">
              {infoNotice}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1.5">
                  {t.auth_email_label}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder={t.auth_email_placeholder}
                    className="min-h-[48px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] pl-10 pr-4 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#475569] mb-1.5">
                  {t.auth_password_label}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={t.auth_password_placeholder}
                    className="min-h-[48px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] pl-10 pr-12 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center text-[#64748B] hover:text-[#0F172A]"
                    aria-label={t.auth_show_password}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="aurora-accent-flow min-h-[52px] w-full rounded-2xl text-base font-extrabold text-white shadow-sm hover:brightness-95 active:scale-[0.99] transition disabled:opacity-50"
              >
                {loading ? t.auth_logging_in : t.auth_login_btn}
              </button>

              <p className="text-center text-xs text-[#475569] pt-2">
                {t.auth_no_account}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className="font-extrabold text-[#2563EB] underline"
                >
                  {t.auth_create_now}
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-5 space-y-4">
              {/* Dual Profile Selector */}
              <div>
                <p className="text-xs font-bold text-[#475569] mb-2">
                  {t.auth_account_goal_q}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAccountGoal('passenger')}
                    className={`min-h-[68px] rounded-2xl border-2 p-3 text-left transition ${
                      accountGoal === 'passenger'
                        ? 'border-[#2563EB] bg-[#EFF6FF]'
                        : 'border-[#E2E8F0] bg-white hover:border-[#93C5FD]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        {t.passenger_role_badge}
                      </span>
                      {accountGoal === 'passenger' && (
                        <CheckCircle2 className="h-4 w-4 text-[#2563EB] shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[#475569]">
                      {t.auth_goal_passenger_desc}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountGoal('driver')}
                    className={`min-h-[68px] rounded-2xl border-2 p-3 text-left transition ${
                      accountGoal === 'driver'
                        ? 'border-[#2563EB] bg-[#EFF6FF]'
                        : 'border-[#E2E8F0] bg-white hover:border-[#93C5FD]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-[#0F172A]">
                        {t.driver_role_badge} / {t.deliverer_role_badge}
                      </span>
                      {accountGoal === 'driver' && (
                        <CheckCircle2 className="h-4 w-4 text-[#2563EB] shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[#475569]">
                      {t.auth_goal_driver_desc}
                    </p>
                  </button>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    {t.auth_full_name_label}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={t.auth_full_name_placeholder}
                      className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] pl-10 pr-3 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    {t.auth_phone_label}
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t.auth_phone_placeholder}
                      className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] pl-10 pr-3 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    {t.auth_doc_id_label}
                  </label>
                  <div className="relative">
                    <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                    <input
                      type="text"
                      required
                      value={cpf}
                      onChange={(e) => setCpf(e.target.value)}
                      placeholder={t.auth_doc_placeholder}
                      className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] pl-10 pr-3 text-sm font-mono-num text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    {t.auth_email_label}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.auth_email_placeholder}
                    className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#475569] mb-1">
                    {t.auth_password_label}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.auth_password_min_placeholder}
                    className="min-h-[46px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] px-3.5 text-sm text-[#0F172A] outline-none focus:border-[#2563EB] focus:bg-white"
                  />
                </div>
              </div>

              {/* Driver Extra Requirements */}
              {accountGoal === 'driver' && (
                <div className="space-y-3 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF]/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#0F172A]">
                    <FileText className="h-4 w-4 text-[#2563EB]" />
                    <span>{t.auth_driver_docs_title}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setVehicleType('car')}
                      className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'car'
                          ? 'aurora-accent-flow text-white border-[#2563EB]'
                          : 'bg-white text-[#475569] border-[#E2E8F0]'
                      }`}
                    >
                      <Car className="h-4 w-4" /> {t.auth_vehicle_car}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleType('moto')}
                      className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'moto'
                          ? 'aurora-accent-flow text-white border-[#2563EB]'
                          : 'bg-white text-[#475569] border-[#E2E8F0]'
                      }`}
                    >
                      <Bike className="h-4 w-4" /> {t.auth_vehicle_moto}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleType('delivery')}
                      className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'delivery'
                          ? 'aurora-accent-flow text-white border-[#2563EB]'
                          : 'bg-white text-[#475569] border-[#E2E8F0]'
                      }`}
                    >
                      <Package className="h-4 w-4" /> {t.auth_vehicle_delivery}
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#475569] mb-1">
                      Modalidade de trabalho
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'both', label: 'Ambos' },
                          { id: 'only_passenger', label: 'Só Passageiros' },
                          { id: 'only_delivery', label: 'Só Entregas' },
                        ] as Array<{ id: DriverServiceMode; label: string }>
                      ).map((modeOpt) => (
                        <button
                          key={modeOpt.id}
                          type="button"
                          onClick={() => setServiceMode(modeOpt.id)}
                          className={`min-h-[38px] rounded-xl border px-2 text-[11px] font-extrabold transition ${
                            serviceMode === modeOpt.id
                              ? 'bg-[#0F172A] text-white border-[#0F172A]'
                              : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#93C5FD]'
                          }`}
                        >
                          {modeOpt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder={t.auth_vehicle_model_ph}
                      className="min-h-[44px] rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                    <input
                      type="text"
                      required
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                      placeholder={t.auth_vehicle_plate_ph}
                      className="min-h-[44px] rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-mono-num uppercase text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                    <input
                      type="text"
                      required
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      placeholder={t.auth_vehicle_color_ph}
                      className="min-h-[44px] rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#475569] mb-1">
                      {t.auth_driver_pix_label}
                    </label>
                    <input
                      type="text"
                      required
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      placeholder={t.auth_driver_pix_ph}
                      className="min-h-[44px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs text-[#0F172A] outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#93C5FD] bg-white p-3 text-center hover:border-[#2563EB] transition">
                      {cnhPreview ? (
                        <img
                          src={cnhPreview}
                          alt={t.auth_cnh_photo}
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-[#2563EB]" />
                          <span className="mt-1.5 text-[11px] font-bold text-[#0F172A]">
                            {t.auth_cnh_photo}
                          </span>
                          <span className="text-[10px] text-[#64748B]">
                            {t.auth_tap_upload}
                          </span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => handleFileChange(e, 'cnh')}
                      />
                    </label>

                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#93C5FD] bg-white p-3 text-center hover:border-[#2563EB] transition">
                      {crlvPreview ? (
                        <img
                          src={crlvPreview}
                          alt={t.auth_crlv_doc}
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-[#2563EB]" />
                          <span className="mt-1.5 text-[11px] font-bold text-[#0F172A]">
                            {t.auth_crlv_doc}
                          </span>
                          <span className="text-[10px] text-[#64748B]">
                            {t.auth_tap_upload}
                          </span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => handleFileChange(e, 'crlv')}
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Terms, Security & Privacy Acceptance Box */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F4F6F9] p-3.5 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-[#CBD5E1] accent-[#2563EB]"
                  />
                  <span className="text-xs text-[#475569] leading-relaxed">
                    <strong>{t.auth_terms_prefix}</strong>{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('terms')}
                      className="font-extrabold text-[#2563EB] underline"
                    >
                      {t.auth_terms_link}
                    </button>
                    ,{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('security')}
                      className="font-extrabold text-[#2563EB] underline"
                    >
                      {t.auth_security_link}
                    </button>{' '}
                    &amp;{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('privacy')}
                      className="font-extrabold text-[#2563EB] underline"
                    >
                      {t.auth_privacy_link}
                    </button>
                    .
                  </span>
                </label>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setLegalModalTab('terms')}
                    className="text-[11px] font-extrabold text-[#2563EB] underline"
                  >
                    {t.auth_open_full_terms}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="aurora-accent-flow min-h-[52px] w-full rounded-2xl text-base font-extrabold text-white shadow-sm hover:brightness-95 active:scale-[0.99] transition disabled:opacity-50"
              >
                {loading
                  ? t.auth_creating_account
                  : accountGoal === 'driver'
                  ? t.auth_submit_driver
                  : t.auth_submit_passenger}
              </button>
            </form>
          )}
        </div>
      </div>

      {legalModalTab && (
        <LegalDocsModal
          initialTab={legalModalTab}
          siteName={siteName}
          requireAcceptanceButton={true}
          onAcceptAll={() => setAcceptedTerms(true)}
          onClose={() => setLegalModalTab(null)}
        />
      )}
    </div>
  );
};
