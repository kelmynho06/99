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
import { resolveBrandLogo } from '../lib/brandAssets';
import { SUPPORTED_LANGUAGES, useTranslation } from '../lib/i18n';
import {
  compressImageFileToDataUrl,
  loginUser,
  registerUser,
} from '../lib/mobilityApi';
import {
  getUserPreferences,
  markExplicitLanguageChoice,
  saveUserPreferences,
} from '../lib/userPrefs';
import type { PlatformConfig, UserProfile } from '../types/mobility';
import { LegalDocsModal, type LegalDocTab } from './LegalDocsModal';
import { PWAInstallButton } from './PWAInstallButton';

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
  const siteName = platformConfig?.site_name || appConfig.app_name || '66 Mobilidade';
  const brandLogoUrl = resolveBrandLogo({
    app_logo_url: platformConfig?.app_logo_url ?? appConfig.logo_url,
  } as PlatformConfig);
  const primaryColor = platformConfig?.primary_color || appConfig.primary_color || '#FFD100';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [accountGoal, setAccountGoal] = useState<'passenger' | 'driver'>('passenger');
  const [showPassword, setShowPassword] = useState(false);

  // Login form (zero prefilled fictitious credentials)
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Registration form
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');

  // Driver specific fields
  const [vehicleType, setVehicleType] = useState<'car' | 'moto' | 'delivery'>('car');
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
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-950 flex flex-col lg:flex-row">
      {/* Brand showcase column */}
      <div
        className="px-6 py-8 lg:w-[44%] lg:px-12 lg:py-12 flex flex-col justify-between"
        style={{ backgroundColor: primaryColor }}
      >
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <img
                src={brandLogoUrl}
                alt={siteName}
                className="h-12 w-12 rounded-2xl object-cover shadow-md border border-neutral-950/15"
              />
              <span className="font-display text-2xl font-extrabold tracking-tight text-neutral-950">
                {siteName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={lang || getUserPreferences().language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                aria-label={t.language_label}
                className="min-h-[38px] rounded-xl border border-neutral-950/20 bg-white/90 px-2.5 text-xs font-extrabold text-neutral-950 outline-none shadow-xs cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
              <PWAInstallButton />
            </div>
          </div>

          <h1 className="mt-8 font-display text-3xl sm:text-4xl font-extrabold leading-tight text-neutral-950 [text-wrap:balance]">
            {t.auth_hero_title}
          </h1>
          <p className="mt-3 text-sm sm:text-base font-medium text-neutral-900/80 max-w-md">
            {t.auth_hero_subtitle}
          </p>
        </div>

        <div className="mt-8 hidden lg:grid grid-cols-1 gap-4">
          <div className="rounded-2xl bg-neutral-950/10 p-4">
            <div className="flex items-center gap-3 text-neutral-950">
              <MapPin className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold">{t.auth_feature_map_title}</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-neutral-900/75">
              {t.auth_feature_map_desc}
            </p>
          </div>
          <div className="rounded-2xl bg-neutral-950/10 p-4">
            <div className="flex items-center gap-3 text-neutral-950">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold">{t.auth_feature_sec_title}</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-neutral-900/75">
              {t.auth_feature_sec_desc}
            </p>
          </div>
        </div>

        <div className="mt-6 hidden lg:block text-xs font-medium text-neutral-900/70">
          {siteName} · {t.auth_footer_platforms}
        </div>
      </div>

      {/* Form column */}
      <div className="flex-1 px-4 py-6 sm:px-8 lg:px-14 lg:py-10 flex items-start lg:items-center justify-center overflow-y-auto">
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-neutral-900 p-6 sm:p-8 shadow-sm border border-neutral-200/80 dark:border-neutral-800">
          {/* Segmented mode switch */}
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`min-h-[44px] rounded-xl text-sm font-bold transition ${
                mode === 'login'
                  ? 'bg-neutral-950 text-[#FFD100] shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white'
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
                  ? 'bg-neutral-950 text-[#FFD100] shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white'
              }`}
            >
              {t.auth_tab_register}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {infoNotice && (
            <div className="mt-4 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
              {infoNotice}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  {t.auth_email_label}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder={t.auth_email_placeholder}
                    className="min-h-[48px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-4 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  {t.auth_password_label}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={t.auth_password_placeholder}
                    className="min-h-[48px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-12 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center text-neutral-500 dark:text-neutral-400"
                    aria-label={t.auth_show_password}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-sm hover:bg-[#f5c400] active:scale-[0.99] transition disabled:opacity-50"
              >
                {loading ? t.auth_logging_in : t.auth_login_btn}
              </button>

              <p className="text-center text-xs text-neutral-500 dark:text-neutral-400 pt-2">
                {t.auth_no_account}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                >
                  {t.auth_create_now}
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-5 space-y-4">
              {/* Dual Profile Selector */}
              <div>
                <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-2">
                  {t.auth_account_goal_q}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAccountGoal('passenger')}
                    className={`min-h-[68px] rounded-2xl border-2 p-3 text-left transition ${
                      accountGoal === 'passenger'
                        ? 'border-neutral-950 dark:border-[#FFD100] bg-[#FFD100]/20'
                        : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-neutral-950 dark:text-white">
                        {t.passenger_role_badge}
                      </span>
                      {accountGoal === 'passenger' && (
                        <CheckCircle2 className="h-4 w-4 text-neutral-950 dark:text-[#FFD100] shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                      {t.auth_goal_passenger_desc}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountGoal('driver')}
                    className={`min-h-[68px] rounded-2xl border-2 p-3 text-left transition ${
                      accountGoal === 'driver'
                        ? 'border-neutral-950 dark:border-[#FFD100] bg-[#FFD100]/20'
                        : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-neutral-950 dark:text-white">
                        {t.driver_role_badge} / {t.deliverer_role_badge}
                      </span>
                      {accountGoal === 'driver' && (
                        <CheckCircle2 className="h-4 w-4 text-neutral-950 dark:text-[#FFD100] shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                      {t.auth_goal_driver_desc}
                    </p>
                  </button>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    {t.auth_full_name_label}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={t.auth_full_name_placeholder}
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-3 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    {t.auth_phone_label}
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 99999-0000"
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-3 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    {t.auth_doc_id_label}
                  </label>
                  <div className="relative">
                    <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="text"
                      required
                      value={cpf}
                      onChange={(e) => setCpf(e.target.value)}
                      placeholder="000.000.000-00"
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-3 text-sm font-mono-num text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    {t.auth_email_label}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.auth_email_placeholder}
                    className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    {t.auth_password_label}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.auth_password_min_placeholder}
                    className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                  />
                </div>
              </div>

              {/* Driver Extra Requirements */}
              {accountGoal === 'driver' && (
                <div className="space-y-3 rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/30 p-4">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-neutral-950 dark:text-amber-200">
                    <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span>{t.auth_driver_docs_title}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setVehicleType('car')}
                      className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'car'
                          ? 'bg-neutral-950 text-[#FFD100] border-neutral-950'
                          : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      <Car className="h-4 w-4" /> {t.auth_vehicle_car}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleType('moto')}
                      className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'moto'
                          ? 'bg-neutral-950 text-[#FFD100] border-neutral-950'
                          : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      <Bike className="h-4 w-4" /> {t.auth_vehicle_moto}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleType('delivery')}
                      className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'delivery'
                          ? 'bg-neutral-950 text-[#FFD100] border-neutral-950'
                          : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      <Package className="h-4 w-4" /> {t.auth_vehicle_delivery}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder={t.auth_vehicle_model_ph}
                      className="min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                    <input
                      type="text"
                      required
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                      placeholder={t.auth_vehicle_plate_ph}
                      className="min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-mono-num uppercase text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                    <input
                      type="text"
                      required
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      placeholder={t.auth_vehicle_color_ph}
                      className="min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                      {t.auth_driver_pix_label}
                    </label>
                    <input
                      type="text"
                      required
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      placeholder={t.auth_driver_pix_ph}
                      className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-3 text-center hover:border-neutral-950 transition">
                      {cnhPreview ? (
                        <img
                          src={cnhPreview}
                          alt={t.auth_cnh_photo}
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                          <span className="mt-1.5 text-[11px] font-bold text-neutral-800 dark:text-neutral-200">
                            {t.auth_cnh_photo}
                          </span>
                          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
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

                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-3 text-center hover:border-neutral-950 transition">
                      {crlvPreview ? (
                        <img
                          src={crlvPreview}
                          alt={t.auth_crlv_doc}
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                          <span className="mt-1.5 text-[11px] font-bold text-neutral-800 dark:text-neutral-200">
                            {t.auth_crlv_doc}
                          </span>
                          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
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
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/70 p-3.5 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-neutral-300 accent-neutral-950"
                  />
                  <span className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                    <strong>{t.auth_terms_prefix}</strong>{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('terms')}
                      className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                    >
                      {t.auth_terms_link}
                    </button>
                    ,{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('security')}
                      className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                    >
                      {t.auth_security_link}
                    </button>{' '}
                    &amp;{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('privacy')}
                      className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
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
                    className="text-[11px] font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                  >
                    {t.auth_open_full_terms}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-sm hover:bg-[#f5c400] active:scale-[0.99] transition disabled:opacity-50"
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
