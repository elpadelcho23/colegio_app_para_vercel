import { onboardingDismissedKey, productTourKey } from '../lib/client-storage-keys.ts';
import { registerSpaViewRefresh } from './spa-router.ts';

/**
 * Invitación simple al tutorial en el panel (sin checklist).
 * Se oculta si el usuario ya hizo/omitió el tour, dismiss, o ya tiene aula armada.
 */
export function initOnboarding({
  getUserId,
  hasCourse,
  hasStudents,
  hasTeachingContext,
  onPanelRefresh,
  startTour,
}) {
  const root = document.querySelector('[data-onboarding]');
  const hero = document.querySelector('[data-panel-hero]');
  const resume = document.querySelector('[data-onboarding-resume]');
  if (!root) return;

  const startBtn = root.querySelector('[data-setup-tutorial-start]');
  const dismiss = root.querySelector('[data-onboarding-dismiss]');

  function getTourStatus() {
    const userId = getUserId();
    if (!userId) return 'done';
    return localStorage.getItem(productTourKey(userId)) || '';
  }

  function isDismissed() {
    const userId = getUserId();
    if (!userId) return false;
    return localStorage.getItem(onboardingDismissedKey(userId)) === 'true';
  }

  function setDismissed(value) {
    const userId = getUserId();
    if (!userId) return;
    localStorage.setItem(onboardingDismissedKey(userId), value ? 'true' : 'false');
  }

  function isReadyEnough() {
    return Boolean(hasCourse?.() && hasStudents?.() && hasTeachingContext?.());
  }

  function showNode(node) {
    if (!node) return;
    node.classList.remove('is-hidden');
    node.removeAttribute('hidden');
  }

  function hideNode(node) {
    if (!node) return;
    node.classList.add('is-hidden');
    node.setAttribute('hidden', '');
  }

  function setTutorialHighlight(active) {
    root.classList.toggle('onboarding--spotlight', active);
    startBtn?.classList.toggle('is-spotlight', active);
    document.querySelectorAll('[data-help-tour-item], [data-product-tour-start]').forEach((item) => {
      item.classList.toggle('is-spotlight', active);
    });
    document.querySelector('[data-help-menu]')?.classList.toggle('help-menu--tour-pending', active);

    if (active && startBtn && document.activeElement !== startBtn) {
      window.requestAnimationFrame(() => {
        try {
          startBtn.focus({ preventScroll: true });
        } catch {
          startBtn.focus();
        }
      });
    }
  }

  function render() {
    const userId = getUserId();
    if (!userId) {
      hideNode(root);
      showNode(hero);
      hideNode(resume);
      setTutorialHighlight(false);
      return;
    }

    const tourDone = Boolean(getTourStatus());
    const ready = isReadyEnough();

    if (tourDone || ready) {
      hideNode(root);
      showNode(hero);
      hideNode(resume);
      setTutorialHighlight(false);
      return;
    }

    if (isDismissed()) {
      hideNode(root);
      showNode(hero);
      showNode(resume);
      setTutorialHighlight(false);
      return;
    }

    showNode(root);
    hideNode(hero);
    hideNode(resume);
    setTutorialHighlight(true);
  }

  startBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    setDismissed(true);
    render();
    window.dispatchEvent(new CustomEvent('aula-clara:onboarding-visibility'));
    if (typeof startTour === 'function') startTour();
    else document.querySelector('[data-product-tour-start]')?.click();
  });

  dismiss?.addEventListener('click', () => {
    setDismissed(true);
    render();
    window.dispatchEvent(new CustomEvent('aula-clara:onboarding-visibility'));
  });

  resume?.addEventListener('click', () => {
    setDismissed(false);
    render();
    window.dispatchEvent(new CustomEvent('aula-clara:onboarding-visibility'));
  });

  onPanelRefresh(render);
  registerSpaViewRefresh('panel', render);
  window.addEventListener('aula-clara:local-data-changed', render);
  window.addEventListener('aula-clara:teaching-context-changed', render);

  render();
}
