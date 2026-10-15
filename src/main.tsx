import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { readWebApiKey } from './utils/webApiKey';
import './index.css';
import './components/TaskTimeDialog.css';
import './components/aiComposer.css';
import './components/chatMessages.css';

readWebApiKey();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
