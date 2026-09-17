import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Ads baad mein load karo — pehle React ko render karne do.
// Static import se AdMob.initialize() aur showBanner() React se PEHLE
// chal padte the, isse boot screen ek frame ke liye blink karti thi
// aur home screen bina animation aa jata tha.
setTimeout(() => { import('./ads.js').catch(() => {}); }, 600);
