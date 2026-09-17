import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Ads after cold-start settle. AdMob.showBanner() injects a native view into
// the WebView and can trigger a full layout pass — at 900ms it landed mid
// card-stagger. 2200ms is past every boot animation.
setTimeout(() => { import('./ads.js').catch(() => {}); }, 2200);
