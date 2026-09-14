import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../shell/App';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/ui.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
