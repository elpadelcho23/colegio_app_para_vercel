/** Toast global y helpers de validación inline. */

let toastTimer = 0;

/**
 * @param {string} message
 * @param {'ok' | 'warning' | 'error'} [type]
 * @param {{ actionLabel?: string, onAction?: () => void, durationMs?: number }} [options]
 */
export function showAppToast(message, type = 'ok', options = {}) {
  const toastEl = document.querySelector('[data-app-toast]');
  if (!toastEl) return;

  const kind = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'ok';
  const { actionLabel, onAction, durationMs } = options;
  const hasAction = Boolean(actionLabel && typeof onAction === 'function');

  toastEl.hidden = false;
  toastEl.classList.remove('is-hidden', 'is-ok', 'is-warning', 'is-error', 'has-action');
  toastEl.classList.add(`is-${kind}`);
  if (hasAction) toastEl.classList.add('has-action');

  toastEl.replaceChildren();
  const text = document.createElement('span');
  text.className = 'app-toast-message';
  text.textContent = message;
  toastEl.appendChild(text);

  if (hasAction) {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'app-toast-action';
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toastEl.classList.add('is-hidden');
      toastEl.hidden = true;
      onAction();
    });
    toastEl.appendChild(actionBtn);
  }

  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.add('is-hidden');
    toastEl.hidden = true;
  }, durationMs || (hasAction ? 8000 : 4200));
}

/**
 * @param {ParentNode} root
 */
export function clearFieldErrors(root) {
  if (!root) return;
  root.querySelectorAll('.is-invalid').forEach((el) => {
    el.classList.remove('is-invalid');
    el.removeAttribute('aria-invalid');
  });
  root.querySelectorAll('.field-error').forEach((el) => {
    el.textContent = '';
    el.hidden = true;
  });
}

/**
 * @param {HTMLElement | null | undefined} control
 * @param {string} message
 * @returns {HTMLElement | null}
 */
export function setFieldError(control, message) {
  if (!control) return null;
  control.classList.add('is-invalid');
  control.setAttribute('aria-invalid', 'true');

  const host = control.closest('label')
    || control.closest('fieldset')
    || control.closest('.filters-grid')
    || control.parentElement;
  if (!host) return control;

  let err = null;
  if (control.nextElementSibling?.classList?.contains('field-error')) {
    err = control.nextElementSibling;
  } else {
    err = host.querySelector('.field-error');
  }

  if (!err) {
    err = document.createElement('small');
    err.className = 'field-error';
    if (control.nextSibling) {
      control.parentElement?.insertBefore(err, control.nextSibling);
    } else {
      host.appendChild(err);
    }
  }

  err.hidden = false;
  err.textContent = message;
  return control;
}

/**
 * @param {ParentNode} root
 * @returns {HTMLElement | null}
 */
export function focusFirstInvalid(root) {
  const first = root?.querySelector?.('.is-invalid');
  if (first && typeof first.focus === 'function') first.focus();
  return first || null;
}
