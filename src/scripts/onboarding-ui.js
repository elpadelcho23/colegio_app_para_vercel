import { onboardingDismissedKey, productTourKey } from '../lib/client-storage-keys.ts';
import { basicTourProgressFromRecord } from './product-tour.js';
import { registerSpaViewRefresh } from './spa-router.ts';

/**
 * Invitación al tutorial: tarjeta grande el primer día, barra compacta si ya arrancó.
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
  const progress = document.querySelector('[data-onboarding-progress]');
  if (!root) return;

  const startBtn = root.querySelector('[data-setup-tutorial-start]');
  const continueBtn = progress?.querySelector('[data-setup-tutorial-continue]');
  const progressCount = progress?.querySelector('[data-onboarding-progress-count]');
  const dismiss = root.querySelector('[data-onboarding-dismiss]');

  function getTourRecord() {
    const userId = getUserId();
    if (!userId) return { status: 'done' };
    const raw = localStorage.getItem(productTourKey(userId)) || '';
    if (!raw) return { status: '' };
    if (raw === 'done' || raw === 'skipped') return { status: raw };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* ignore */
    }
    return { status: raw };
  }

  function getTourStatus() {
    return getTourRecord().status || '';
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

  function hasStartedClassroom() {
    return Boolean(hasCourse?.() || hasStudents?.() || hasTeachingContext?.());
  }

  function updateProgressLabel(record) {
    if (!progressCount) return;
    const { current, total } = basicTourProgressFromRecord(record);
    progressCount.textContent = `${current} de ${total}`;
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
      hideNode(progress);
      showNode(hero);
      hideNode(resume);
      setTutorialHighlight(false);
      return;
    }

    const record = getTourRecord();
    const status = record.status || '';
    const ready = isReadyEnough();

    if (status === 'done' || ready) {
      hideNode(root);
      hideNode(progress);
      showNode(hero);
      hideNode(resume);
      setTutorialHighlight(false);
      return;
    }

    if (status === 'skipped' || isDismissed()) {
      hideNode(root);
      hideNode(progress);
      showNode(hero);
      showNode(resume);
      setTutorialHighlight(false);
      return;
    }

    const compact = status === 'in_progress' || hasStartedClassroom();
    if (compact) {
      hideNode(root);
      showNode(progress);
      showNode(hero);
      hideNode(resume);
      setTutorialHighlight(false);
      updateProgressLabel(record);
      return;
    }

    showNode(root);
    hideNode(progress);
    hideNode(hero);
    hideNode(resume);
    setTutorialHighlight(true);
  }

  const launchTour = (event) => {
    event?.preventDefault();
    if (typeof startTour === 'function') startTour();
    else document.querySelector('[data-product-tour-start]')?.click();
  };

  startBtn?.addEventListener('click', launchTour);
  continueBtn?.addEventListener('click', launchTour);

  dismiss?.addEventListener('click', () => {
    setDismissed(true);
    const userId = getUserId();
    if (userId) localStorage.setItem(productTourKey(userId), 'skipped');
    render();
    window.dispatchEvent(new CustomEvent('aula-clara:onboarding-visibility'));
  });

  resume?.addEventListener('click', () => {
    setDismissed(false);
    const userId = getUserId();
    if (userId && getTourStatus() === 'skipped') {
      localStorage.removeItem(productTourKey(userId));
    }
    render();
    window.dispatchEvent(new CustomEvent('aula-clara:onboarding-visibility'));
  });

  onPanelRefresh(render);
  registerSpaViewRefresh('panel', render);
  window.addEventListener('aula-clara:local-data-changed', render);
  window.addEventListener('aula-clara:teaching-context-changed', render);
  window.addEventListener('aula-clara:onboarding-visibility', render);

  render();
}
