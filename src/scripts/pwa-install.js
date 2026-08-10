/**
 * Instalar Aula Clara como app (PWA) en PC / Android.
 * iOS Safari no soporta beforeinstallprompt: muestra instrucciones.
 */

let deferredPrompt = null;
let listenersBound = false;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /android/i.test(window.navigator.userAgent);
}

function setText(node, text) {
  if (!node) return;
  node.textContent = text || '';
}

function platformHint() {
  if (isIos()) {
    return 'En iPhone/iPad: Safari → Compartir → “Agregar a pantalla de inicio”.';
  }
  if (isAndroid()) {
    return 'En Android (Chrome): Menú ⋮ → “Instalar app” o “Agregar a pantalla de inicio”.';
  }
  return 'En PC usá Chrome o Edge. Cuando esté listo, aparece Instalar (o el ícono ⊕ en la barra de direcciones).';
}

function refreshInstallUi(root = document) {
  root.querySelectorAll('[data-pwa-install]').forEach((block) => {
    const btn = block.querySelector('[data-pwa-install-btn]');
    const status = block.querySelector('[data-pwa-install-status]');
    const help = block.querySelector('[data-pwa-install-help]');

    block.hidden = false;
    block.classList.remove('is-hidden');

    if (isStandalone()) {
      if (btn) {
        btn.hidden = true;
        btn.disabled = true;
      }
      setText(status, 'Aula Clara ya está instalada en este dispositivo.');
      if (help) help.hidden = true;
      return;
    }

    if (help) help.hidden = false;

    if (btn) {
      btn.hidden = false;
      btn.disabled = false;
      btn.textContent = deferredPrompt
        ? (isAndroid() ? 'Instalar en Android' : 'Instalar en este PC')
        : 'Ver cómo instalar';
    }

    if (deferredPrompt) {
      setText(status, 'Podés instalarla y abrirla como una app, sin pasar por la tienda.');
      return;
    }

    setText(status, platformHint());
  });
}

async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  try {
    await deferredPrompt.userChoice;
  } catch {
    // ignore
  }
  deferredPrompt = null;
  refreshInstallUi();
  return true;
}

async function openInstallHelp(btn) {
  const block = btn.closest('[data-pwa-install]');
  const help = block?.querySelector('[data-pwa-install-help]');
  if (help instanceof HTMLDetailsElement) {
    help.open = true;
    help.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  try {
    const { navigateToToolsSection } = await import('./tools-ui.js');
    navigateToToolsSection('install');
    window.requestAnimationFrame(() => {
      const targetHelp = document.querySelector('[data-pwa-install-help]');
      if (targetHelp instanceof HTMLDetailsElement) targetHelp.open = true;
    });
  } catch {
    window.alert(platformHint());
  }
}

export function initPwaInstall(root = document) {
  if (!listenersBound) {
    listenersBound = true;
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      refreshInstallUi();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      refreshInstallUi();
    });
  }

  root.querySelectorAll('[data-pwa-install-btn]').forEach((btn) => {
    if (btn.dataset.pwaBound === '1') return;
    btn.dataset.pwaBound = '1';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      if (isStandalone()) {
        refreshInstallUi();
        return;
      }
      void (async () => {
        const installed = await promptInstall();
        if (!installed) await openInstallHelp(btn);
      })();
    });
  });

  refreshInstallUi(root);
  return { refresh: () => refreshInstallUi(root) };
}
