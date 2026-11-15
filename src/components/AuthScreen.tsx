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
  Phone,
  ShieldCheck,
  Upload,
  User,
} from 'lucide-react';
import type { UserProfile } from '../types/mobility';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthScreenProps {
  onAuthenticated: (user: UserProfile) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [accountGoal, setAccountGoal] = useState<'passenger' | 'driver'>('passenger');
  const [showPassword, setShowPassword] = useState(false);

  // Login form
  const [loginEmail, setLoginEmail] = useState('gabriel@velo99.app');
  const [loginPassword, setLoginPassword] = useState('123456');

  // Registration form
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');

  // Driver specific fields
  const [vehicleType, setVehicleType] = useState<'car' | 'moto'>('car');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [cnhPreview, setCnhPreview] = useState<string>('');
  const [crlvPreview, setCrlvPreview] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e?: React.FormEvent, overrideEmail?: string, overridePassword?: string) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: overrideEmail ?? loginEmail,
          password: overridePassword ?? loginPassword,
        }),
      });
      const data = (await res.json()) as { user?: UserProfile; error?: string };
      if (!res.ok || !data.user) {
        setError(data.error || 'Erro ao fazer login.');
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError('Não foi possível conectar ao servidor.');
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
    const dataUrl = await readFileAsDataUrl(file);
    if (target === 'cnh') setCnhPreview(dataUrl);
    else setCrlvPreview(dataUrl);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (accountGoal === 'driver' && (!cnhPreview || !crlvPreview)) {
      setError('Envie as fotos da sua CNH e do documento do veículo (CRLV).');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });

      const data = (await res.json()) as { user?: UserProfile; error?: string };
      if (!res.ok || !data.user) {
        setError(data.error || 'Erro ao concluir cadastro.');
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError('Erro de conexão ao registrar conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col lg:flex-row">
      {/* Brand showcase column */}
      <div className="bg-[#FFCC00] px-6 py-8 lg:w-[44%] lg:px-12 lg:py-12 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-[#FFCC00] font-display text-2xl font-extrabold tracking-tight shadow-md">
                99
              </div>
              <span className="font-display text-2xl font-extrabold tracking-tight text-neutral-950">
                Velo99
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
          <div className="rounded-2xl bg-neutral-950/8 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-3 text-neutral-950">
              <MapPin className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold">Mapa aberto com GPS ao vivo</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-neutral-900/75">
              OpenStreetMap interativo sem barreiras de toque e rotas diretas pelo Google Maps para o motorista.
            </p>
          </div>
          <div className="rounded-2xl bg-neutral-950/8 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-3 text-neutral-950">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <p className="text-sm font-bold">Segurança com PIN e CNH verificada</p>
            </div>
            <p className="mt-1 pl-8 text-xs text-neutral-900/75">
              Motoristas passam por validação de CNH e CRLV no painel administrativo antes de ficar online.
            </p>
          </div>
        </div>

        <div className="mt-6 hidden lg:block text-xs font-medium text-neutral-900/70">
          Velo99 Mobilidade · Web App, PWA e Android Capacitor
        </div>
      </div>

      {/* Form column */}
      <div className="flex-1 px-4 py-6 sm:px-8 lg:px-14 lg:py-10 flex items-start lg:items-center justify-center overflow-y-auto">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-sm border border-neutral-200/80">
          {/* Segmented mode switch */}
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-neutral-100 p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`min-h-[44px] rounded-xl text-sm font-bold transition ${
                mode === 'login'
                  ? 'bg-neutral-950 text-[#FFCC00] shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-950'
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
                  ? 'bg-neutral-950 text-[#FFCC00] shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-950'
              }`}
            >
              Criar cadastro
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={(e) => handleLogin(e)} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="min-h-[48px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 pl-10 pr-4 text-sm outline-none focus:border-neutral-950 focus:bg-white transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••"
                    className="min-h-[48px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 pl-10 pr-12 text-sm outline-none focus:border-neutral-950 focus:bg-white transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center text-neutral-500"
                    aria-label="Mostrar senha"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="min-h-[52px] w-full rounded-2xl bg-[#FFCC00] text-base font-extrabold text-neutral-950 shadow-sm hover:bg-[#f5c400] active:scale-[0.99] transition disabled:opacity-50"
              >
                {loading ? 'Entrando...' : 'Próximo'}
              </button>

              {/* Quick Demo Access */}
              <div className="pt-4 border-t border-neutral-100">
                <p className="text-xs font-bold text-neutral-500 mb-2.5">
                  Acesso rápido para testar perfis em tempo real:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleLogin(undefined, 'gabriel@velo99.app', '123456')}
                    className="min-h-[46px] rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-left hover:border-neutral-950 transition"
                  >
                    <span className="block text-xs font-extrabold text-neutral-950">Passageiro</span>
                    <span className="block text-[11px] text-neutral-500 truncate">Gabriel Oliveira</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogin(undefined, 'rikelmy@velo99.app', '123456')}
                    className="min-h-[46px] rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-left hover:border-neutral-950 transition"
                  >
                    <span className="block text-xs font-extrabold text-neutral-950">Motorista Ativo</span>
                    <span className="block text-[11px] text-neutral-500 truncate">Rikelmy · Fiat Argo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogin(undefined, 'mariana.driver@velo99.app', '123456')}
                    className="min-h-[46px] rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-left hover:border-neutral-950 transition"
                  >
                    <span className="block text-xs font-extrabold text-neutral-950">Motorista Pendente</span>
                    <span className="block text-[11px] text-neutral-500 truncate">Mariana · Em análise</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogin(undefined, 'admin@velo99.app', 'admin123')}
                    className="min-h-[46px] rounded-2xl border border-neutral-950/15 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-800 transition"
                  >
                    <span className="block text-xs font-extrabold text-[#FFCC00]">Super Admin</span>
                    <span className="block text-[11px] text-neutral-300 truncate">Aprovar & Tarifas</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-5 space-y-4">
              {/* Dual Profile Selector */}
              <div>
                <p className="text-xs font-bold text-neutral-700 mb-2">
                  Qual é o objetivo da sua conta?
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAccountGoal('passenger')}
                    className={`min-h-[68px] rounded-2xl border-2 p-3 text-left transition ${
                      accountGoal === 'passenger'
                        ? 'border-neutral-950 bg-[#FFCC00]/20'
                        : 'border-neutral-200 bg-white hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-neutral-950">
                        Opção A · Passageiro
                      </span>
                      {accountGoal === 'passenger' && (
                        <CheckCircle2 className="h-4 w-4 text-neutral-950 shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Quero Viajar / Pedir Corridas (acesso imediato)
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountGoal('driver')}
                    className={`min-h-[68px] rounded-2xl border-2 p-3 text-left transition ${
                      accountGoal === 'driver'
                        ? 'border-neutral-950 bg-[#FFCC00]/20'
                        : 'border-neutral-200 bg-white hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-neutral-950">
                        Opção B · Motorista
                      </span>
                      {accountGoal === 'driver' && (
                        <CheckCircle2 className="h-4 w-4 text-neutral-950 shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Quero Dirigir / Fazer Entregas (análise CNH/CRLV)
                    </p>
                  </button>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-neutral-700 mb-1">Nome completo</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ex: Lucas Pereira Silva"
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 pl-10 pr-3 text-sm outline-none focus:border-neutral-950 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
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
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 pl-10 pr-3 text-sm outline-none focus:border-neutral-950 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">CPF</label>
                  <div className="relative">
                    <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="text"
                      required
                      value={cpf}
                      onChange={(e) => setCpf(e.target.value)}
                      placeholder="000.000.000-00"
                      className="min-h-[46px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 pl-10 pr-3 text-sm font-mono-num outline-none focus:border-neutral-950 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">E-mail</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@email.com"
                    className="min-h-[46px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3.5 text-sm outline-none focus:border-neutral-950 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">Senha</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 dígitos"
                    className="min-h-[46px] w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3.5 text-sm outline-none focus:border-neutral-950 focus:bg-white"
                  />
                </div>
              </div>

              {/* Driver Extra Requirements */}
              {accountGoal === 'driver' && (
                <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-neutral-950">
                    <FileText className="h-4 w-4 text-amber-600" />
                    <span>Documentação do Motorista & Veículo</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVehicleType('car')}
                      className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'car'
                          ? 'bg-neutral-950 text-[#FFCC00] border-neutral-950'
                          : 'bg-white text-neutral-700 border-neutral-200'
                      }`}
                    >
                      <Car className="h-4 w-4" /> Carro
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleType('moto')}
                      className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-bold border transition ${
                        vehicleType === 'moto'
                          ? 'bg-neutral-950 text-[#FFCC00] border-neutral-950'
                          : 'bg-white text-neutral-700 border-neutral-200'
                      }`}
                    >
                      <Bike className="h-4 w-4" /> Moto
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="Modelo (Ex: Onix 1.0)"
                      className="min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-xs outline-none focus:border-neutral-950"
                    />
                    <input
                      type="text"
                      required
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                      placeholder="Placa (ABC-1D23)"
                      className="min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-xs font-mono-num uppercase outline-none focus:border-neutral-950"
                    />
                    <input
                      type="text"
                      required
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      placeholder="Cor (Ex: Branco)"
                      className="min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-xs outline-none focus:border-neutral-950"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-neutral-700 mb-1">
                      Chave Pix para repasses
                    </label>
                    <input
                      type="text"
                      required
                      value={pixKey}
                      onChange={(e) => setPixKey(e.target.value)}
                      placeholder="CPF, e-mail, telefone ou chave aleatória"
                      className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs outline-none focus:border-neutral-950"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-3 text-center hover:border-neutral-950 transition">
                      {cnhPreview ? (
                        <img
                          src={cnhPreview}
                          alt="Prévia CNH"
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-neutral-500" />
                          <span className="mt-1.5 text-[11px] font-bold text-neutral-800">
                            Foto da CNH
                          </span>
                          <span className="text-[10px] text-neutral-500">Toque para enviar</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => handleFileChange(e, 'cnh')}
                      />
                    </label>

                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-3 text-center hover:border-neutral-950 transition">
                      {crlvPreview ? (
                        <img
                          src={crlvPreview}
                          alt="Prévia CRLV"
                          referrerPolicy="no-referrer"
                          className="h-20 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-neutral-500" />
                          <span className="mt-1.5 text-[11px] font-bold text-neutral-800">
                            Documento CRLV
                          </span>
                          <span className="text-[10px] text-neutral-500">Toque para enviar</span>
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

              <button
                type="submit"
                disabled={loading}
                className="min-h-[52px] w-full rounded-2xl bg-[#FFCC00] text-base font-extrabold text-neutral-950 shadow-sm hover:bg-[#f5c400] active:scale-[0.99] transition disabled:opacity-50"
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
    </div>
  );
};
