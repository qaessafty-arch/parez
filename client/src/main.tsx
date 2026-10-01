import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import App from './App';
import { I18nProvider } from './lib/i18n';
import { ToastHost } from './ui/kit';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastHost>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastHost>
    </I18nProvider>
  </StrictMode>
);
