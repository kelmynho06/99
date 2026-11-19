import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro inesperado na interface do aplicativo.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      console.error('[ErrorBoundary]', error, info?.componentStack);
    } catch {
      // Ignore console errors in restricted environments
    }
  }

  handleRecover = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  handleReload = () => {
    try {
      window.location.reload();
    } catch {
      this.handleRecover();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-neutral-950 p-6 text-white">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#14171D] p-6 text-center shadow-2xl space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFD100]/15 text-[#FFD100] border border-[#FFD100]/30">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-xl font-extrabold text-white">
                Algo saiu do esperado
              </h1>
              <p className="text-xs text-neutral-300 leading-relaxed">
                O aplicativo encontrou uma falha temporária e protegeu sua sessão com segurança.
              </p>
              {this.state.errorMessage && (
                <p className="rounded-xl bg-black/40 border border-white/10 px-3 py-2 font-mono text-[11px] text-neutral-400 break-words">
                  {this.state.errorMessage}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={this.handleRecover}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 active:scale-[0.98] transition"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar continuar agora
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="flex min-h-[44px] w-full items-center justify-center rounded-2xl bg-white/10 text-xs font-bold text-neutral-200 hover:bg-white/15"
              >
                Recarregar aplicativo
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
