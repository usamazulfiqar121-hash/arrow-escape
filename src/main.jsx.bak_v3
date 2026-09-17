import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Ads AFTER React mounts — the icon-tap jitter came from AdMob.initialize()
// and showBanner() running before React even had a chance to paint, which
// blocked the WebView main thread during the very moment the user was
// watching the app open. Delaying it to after first paint removes the whole
// cold-start stutter without losing any ad functionality.
setTimeout(() => { import('./ads.js').catch(() => {}); }, 900);
