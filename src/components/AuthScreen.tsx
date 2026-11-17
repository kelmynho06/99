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
import {
  compressImageFileToDataUrl,
  loginUser,
  registerUser,
} from '../lib/mobilityApi';
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoNotice(null);
    setLoading(true);
    try {
      const user = await loginUser(loginEmail, loginPassword);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar na conta.');
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
      setError('Não foi possível processar a imagem selecionada.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoNotice(null);

    if (!acceptedTerms) {
      setError(
        'Leia e aceite os Termos de Uso, Segurança e Política de Privacidade para criar sua conta.'
      );
      return;
    }

    if (accountGoal === 'driver' && (!cnhPreview || !crlvPreview)) {
      setError('Envie as fotos da sua CNH e do documento do veículo (CRLV).');
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
        setInfoNotice(
          'Cadastro realizado! Confirme o link enviado ao seu e-mail (ou desative "Confirm email" no painel do Supabase Auth) e faça login.'
        );
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
      setError(err instanceof Error ? err.message : 'Erro ao registrar conta.');
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
          <div className="flex items-center justify-between gap-4">
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
            <PWAInstallButton />
          </div>

          <h1 className="mt-8 font-display text-3xl sm:text-4xl font-extrabold leading-tight text-neutral-950 [text-wrap:balance]">
            Mobilidade rápida para passageiros, ganhos reais para motoristas.
          </h1>
          <p className="mt-3 text-sm sm:text-base font-medium text-neutral-900/80 max-w-md">
            Chame carros, motos ou entregas em segundos com rastreamento GPS ao vivo e embarque protegido por PIN de 4 dígitos.
          </p>
        </div>

        <div className="mt-8 hidden lg:grid grid-cols-1 gap-4">
          <div className="rounded-2xl bg-neutral-950/10 p-4">
            <div className="flex items-center gap-3 text-neutral-950">
              <MapPin className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold">Mapa aberto com GPS ao vivo</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-neutral-900/75">
              OpenStreetMap interativo sem barreiras de toque e rotas diretas pelo Google Maps para o motorista.
            </p>
          </div>
          <div className="rounded-2xl bg-neutral-950/10 p-4">
            <div className="flex items-center gap-3 text-neutral-950">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold">Segurança com PIN, Pix oficial e CNH verificada</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-neutral-900/75">
              Motoristas e entregadores passam por validação de CNH e CRLV antes de ficar online.
            </p>
          </div>
        </div>

        <div className="mt-6 hidden lg:block text-xs font-medium text-neutral-900/70">
          {siteName} Mobilidade · Web App, PWA e Android Capacitor
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
              Entrar na conta
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
              Criar cadastro
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
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="min-h-[48px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-4 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="min-h-[48px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-12 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center text-neutral-500 dark:text-neutral-400"
                    aria-label="Mostrar senha"
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
                {loading ? 'Entrando...' : 'Entrar'}
              </button>

              <p className="text-center text-xs text-neutral-500 dark:text-neutral-400 pt-2">
                Ainda não possui conta?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                >
                  Criar cadastro agora
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-5 space-y-4">
              {/* Dual Profile Selector */}
              <div>
                <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-2">
                  Qual é o objetivo da sua conta?
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
                        Opção A · Passageiro
                      </span>
                      {accountGoal === 'passenger' && (
                        <CheckCircle2 className="h-4 w-4 text-neutral-950 dark:text-[#FFD100] shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                      Quero Viajar / Pedir Corridas (acesso imediato)
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
                        Opção B · Motorista / Entregador
                      </span>
                      {accountGoal === 'driver' && (
                        <CheckCircle2 className="h-4 w-4 text-neutral-950 dark:text-[#FFD100] shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                      Quero Dirigir / Fazer Entregas (análise CNH/CRLV)
                    </p>
                  </button>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">Nome completo</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ex: Lucas Pereira Silva"
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-10 pr-3 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                    Telefone / WhatsApp
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
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">CPF</label>
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
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">E-mail</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@email.com"
                    className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">Senha</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 dígitos"
                    className="min-h-[46px] w-full rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3.5 text-sm text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100] focus:bg-white dark:focus:bg-neutral-900"
                  />
                </div>
              </div>

              {/* Driver Extra Requirements */}
              {accountGoal === 'driver' && (
                <div className="space-y-3 rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/30 p-4">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-neutral-950 dark:text-amber-200">
                    <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span>Documentação do Motorista & Veículo</span>
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
                      <Car className="h-4 w-4" /> Carro
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
                      <Bike className="h-4 w-4" /> Moto
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
                      <Package className="h-4 w-4" /> Entregador
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="Modelo (Ex: Onix 1.0)"
                      className="min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                    <input
                      type="text"
                      required
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                      placeholder="Placa (ABC-1D23)"
                      className="min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-mono-num uppercase text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                    <input
                      type="text"
                      required
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      placeholder="Cor (Ex: Branco)"
                      className="min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                      Sua Chave Pix para receber repasses do Admin
                    </label>
                    <input
                      type="text"
                      required
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      placeholder="CPF, e-mail, telefone ou chave aleatória"
                      className="min-h-[44px] w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs text-neutral-950 dark:text-white outline-none focus:border-neutral-950 dark:focus:border-[#FFD100]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-3 text-center hover:border-neutral-950 transition">
                      {cnhPreview ? (
                        <img
                          src={cnhPreview}
                          alt="Prévia CNH"
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                          <span className="mt-1.5 text-[11px] font-bold text-neutral-800 dark:text-neutral-200">
                            Foto da CNH
                          </span>
                          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Toque para enviar</span>
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
                          alt="Prévia CRLV"
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                          <span className="mt-1.5 text-[11px] font-bold text-neutral-800 dark:text-neutral-200">
                            Documento CRLV
                          </span>
                          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Toque para enviar</span>
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
                    <strong>Li e aceito</strong> os{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('terms')}
                      className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                    >
                      Termos de Uso
                    </button>
                    ,{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('security')}
                      className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                    >
                      Termo de Segurança e PIN
                    </button>{' '}
                    e a{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModalTab('privacy')}
                      className="font-extrabold text-neutral-950 dark:text-[#FFD100] underline"
                    >
                      Política de Privacidade (LGPD)
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
                    Abrir documento completo e aceitar
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="min-h-[52px] w-full rounded-2xl bg-[#FFD100] text-base font-extrabold text-neutral-950 shadow-sm hover:bg-[#f5c400] active:scale-[0.99] transition disabled:opacity-50"
              >
                {loading
                  ? 'Criando conta...'
                  : accountGoal === 'driver'
                  ? 'Enviar documentos para análise'
                  : 'Concluir cadastro e viajar'}
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
