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
        <div className="min-h-screen w-full flex items-center justify-center bg-[#F4F6F9] p-6 text-[#0F172A]">
          <div className="w-full max-w-sm rounded-3xl border border-[#E2E8F0] bg-white p-6 text-center shadow-xl space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-xl font-extrabold text-[#0F172A]">
                Algo saiu do esperado
              </h1>
              <p className="text-xs text-[#475569] leading-relaxed">
                O aplicativo encontrou uma falha temporária e protegeu sua sessão com segurança.
              </p>
              {this.state.errorMessage && (
                <p className="rounded-xl bg-[#F4F6F9] border border-[#E2E8F0] px-3 py-2 font-mono text-[11px] text-[#475569] break-words">
                  {this.state.errorMessage}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={this.handleRecover}
                className="aurora-accent-flow flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white active:scale-[0.98] transition"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar continuar agora
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="flex min-h-[44px] w-full items-center justify-center rounded-2xl bg-[#F1F5F9] border border-[#E2E8F0] text-xs font-bold text-[#0F172A] hover:bg-[#E2E8F0]"
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
