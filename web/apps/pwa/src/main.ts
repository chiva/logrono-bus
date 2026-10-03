// Atkinson Hyperlegible (OFL), for the "legible" font option. Only the Latin subset Spanish needs;
// browsers download a weight only when something on screen uses it.
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-600.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-800.css';
import './styles/themes.css';
import './styles/base.css';
import './app.ts';

// Offline shell + "install as app". Failing to register (http on a LAN, Silk with storage
// blocked) is harmless: the page works the same without a service worker.
if ('serviceWorker' in navigator && window.isSecureContext) {
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => undefined);
}
