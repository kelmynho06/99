import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AppConfigProvider } from './context/AppConfigContext.tsx';
import './index.css';

if (import.meta.env.DEV) {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => {
          void reg.unregister();
        });
      }).catch(() => {});
    }
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => {
          void caches.delete(key);
        });
      }).catch(() => {});
    }
  } catch {
    // Ignore cache cleanup errors
  }
} else {
  try {
    registerSW({ immediate: true });
  } catch {
    // Ignore SW registration errors on restricted WebViews
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppConfigProvider>
      <App />
    </AppConfigProvider>
  </ErrorBoundary>
);
