// Extrae la lógica del menú móvil y la hace reutilizable.
let mobileNavController = null;

export function initMobileNav() {
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const navMenu = document.querySelector('[data-nav-menu]');
  const appShell = document.querySelector('.app-shell');

  if (!menuToggle || !navMenu) return;

  mobileNavController?.abort();
  mobileNavController = new AbortController();
  const { signal } = mobileNavController;

  const setShellHeight = () => {
    const height = Math.ceil(appShell?.getBoundingClientRect().height || appShell?.offsetHeight || 112);
    document.documentElement.style.setProperty('--app-shell-height', `${height}px`);
  };

  const setMenuState = (isOpen) => {
    navMenu.setAttribute('data-menu-open', String(isOpen));
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('mobile-menu-open', isOpen);
    // Recalcular después de abrir/cerrar por si el header cambió de alto.
    window.requestAnimationFrame(setShellHeight);
  };

  setShellHeight();
  setMenuState(false);

  // El header cambia de alto (curso actual, banner invitado, etc.): el menú debe seguirlo.
  if (typeof ResizeObserver !== 'undefined' && appShell) {
    const shellObserver = new ResizeObserver(() => setShellHeight());
    shellObserver.observe(appShell);
    signal.addEventListener('abort', () => shellObserver.disconnect());
  }

  window.addEventListener('resize', () => {
    setShellHeight();
    if (window.innerWidth >= 1024) setMenuState(false);
  }, { signal });

  window.addEventListener('scroll', setShellHeight, { signal, passive: true });

  window.addEventListener('aula-clara:teaching-context-changed', setShellHeight, { signal });
  window.addEventListener('aula-clara:spa-view', setShellHeight, { signal });
  window.addEventListener('aula-clara:onboarding-visibility', setShellHeight, { signal });

  menuToggle.addEventListener('click', () => {
    const isOpen = navMenu.getAttribute('data-menu-open') === 'true';
    setMenuState(!isOpen);
  }, { signal });

  navMenu.querySelectorAll('[data-menu-close]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      setMenuState(false);
    }, { signal });
  });

  navMenu.querySelectorAll(
    'a, .nav-form button, .nav-tab, [data-spa-nav], [data-gtc-open], [data-pwa-install-btn], [data-product-tour-start], [data-tour-start]',
  ).forEach((element) => {
    element.addEventListener('click', () => setMenuState(false), { signal });
  });

  document.addEventListener('click', (e) => {
    const isClickInsideMenu = navMenu.contains(e.target);
    const isClickOnToggle = menuToggle.contains(e.target);

    if (!isClickInsideMenu && !isClickOnToggle) {
      setMenuState(false);
    }
  }, { signal });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuState(false);
  }, { signal });
}

export function openMenu() {
  const navMenu = document.querySelector('[data-nav-menu]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  if (!navMenu || !menuToggle) return;
  navMenu.setAttribute('data-menu-open', 'true');
  menuToggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-menu-open');
}

export function closeMenu() {
  const navMenu = document.querySelector('[data-nav-menu]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  if (!navMenu || !menuToggle) return;
  navMenu.setAttribute('data-menu-open', 'false');
  menuToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-menu-open');
}
