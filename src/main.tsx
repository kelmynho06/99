import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AppConfigProvider } from './context/AppConfigContext.tsx';
import './index.css';

try {
  registerSW({ immediate: true });
} catch {
  // Ignore SW registration errors on restricted WebViews
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppConfigProvider>
      <App />
    </AppConfigProvider>
  </ErrorBoundary>
);
