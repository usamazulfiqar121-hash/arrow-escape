import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initFirebase } from './firebase'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Firebase analytics — init after React mounts, so it never competes
// with the first paint
setTimeout(() => { initFirebase(); }, 2500);

// Ads after Firebase — last thing that loads, so nothing else has to wait
setTimeout(() => { import('./ads.js').catch(() => {}); }, 3200);
