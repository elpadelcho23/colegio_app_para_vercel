(function () {
  const root = document.querySelector('[data-aula-root]');
  if (!root) return;

  const token = document.body.dataset.aulaToken || '';
  const titleEl = root.querySelector('[data-aula-title]');
  const metaEl = root.querySelector('[data-aula-meta]');
  const joinPanel = root.querySelector('[data-aula-join]');
  const examPanel = root.querySelector('[data-aula-exam]');
  const donePanel = root.querySelector('[data-aula-done]');
  const closedPanel = root.querySelector('[data-aula-closed]');
  const preparandoPanel = root.querySelector('[data-aula-preparando]');
  const joinForm = root.querySelector('[data-aula-join-form]');
  const joinError = root.querySelector('[data-aula-join-error]');
  const questionsEl = root.querySelector('[data-aula-questions]');
  const timerEl = root.querySelector('[data-aula-timer]');
  const studentEl = root.querySelector('[data-aula-student]');
  const progressEl = root.querySelector('[data-aula-progress]');
  const watermarkEl = root.querySelector('[data-aula-watermark]');
  const statusEl = root.querySelector('[data-aula-status]');
  const prevBtn = root.querySelector('[data-aula-prev]');
  const nextBtn = root.querySelector('[data-aula-next]');
  const submitBtn = root.querySelector('[data-aula-submit]');
  const doneMsg = root.querySelector('[data-aula-done-msg]');
  const gradeEl = root.querySelector('[data-aula-grade]');

  let session = null;
  let answers = {};
  let currentIndex = 0;
  let timerId = null;
  let saveTimer = null;
  let focusLossReported = false;
  let submitting = false;
  let antiCheatBound = false;
  let examPaused = false;
  let lastFocusLossAt = 0;
  let wakeLock = null;
  let focusPollId = null;
  let heartbeatId = null;
  let lockGraceUntil = 0;

  function show(panel) {
    [joinPanel, examPanel, donePanel, closedPanel, preparandoPanel].forEach((node) => {
      if (node) node.hidden = node !== panel;
    });
  }

  function formatRemain(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async function api(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      credentials: 'same-origin',
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  function syncClockOffset(serverNow) {
    const server = new Date(serverNow).getTime();
    const local = Date.now();
    return Number.isFinite(server) ? server - local : 0;
  }

  let clockOffset = 0;

  function now() {
    return Date.now() + clockOffset;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!session || submitting) return;
      api(`/api/aula-temporal/intento/${session.intentoId}/respuestas`, {
        method: 'PUT',
        body: JSON.stringify({ respuestas: answers }),
      }).catch(() => {});
    }, 600);
  }

  function renderQuestion() {
    if (!session) return;
    const questions = session.preguntas || [];
    const anti = session.antiTrampa || {};
    const oneAtATime = Boolean(anti.oneAtATime);
    questionsEl.innerHTML = '';

    const list = oneAtATime
      ? questions.slice(currentIndex, currentIndex + 1)
      : questions;

    list.forEach((q) => {
      const wrap = document.createElement('article');
      wrap.className = 'aula-temp-question';
      wrap.dataset.questionId = q.id;

      const title = document.createElement('h3');
      title.textContent = `${q.index}. ${q.enunciado}`;
      wrap.appendChild(title);

      if (q.tipo === 'mc_single' || q.tipo === 'mc_multi') {
        const group = document.createElement('div');
        group.className = 'aula-temp-options';
        (q.opciones || []).forEach((opt) => {
          const label = document.createElement('label');
          label.className = 'aula-temp-option';
          const input = document.createElement('input');
          input.type = q.tipo === 'mc_multi' ? 'checkbox' : 'radio';
          input.name = `q-${q.id}`;
          input.value = opt.id;
          const current = answers[q.id];
          if (q.tipo === 'mc_multi') {
            input.checked = Array.isArray(current) && current.includes(opt.id);
          } else {
            input.checked = current === opt.id;
          }
          input.addEventListener('change', () => {
            if (q.tipo === 'mc_multi') {
              const selected = Array.from(wrap.querySelectorAll('input:checked')).map((el) => el.value);
              answers[q.id] = selected;
            } else {
              answers[q.id] = opt.id;
            }
            scheduleSave();
          });
          label.appendChild(input);
          label.appendChild(document.createTextNode(opt.texto));
          group.appendChild(label);
        });
        wrap.appendChild(group);
      } else {
        const area = document.createElement(q.tipo === 'corta' ? 'input' : 'textarea');
        if (q.tipo === 'corta') {
          area.type = 'text';
        } else {
          area.rows = 5;
        }
        area.className = 'aula-temp-text';
        area.value = typeof answers[q.id] === 'string' ? answers[q.id] : '';
        area.addEventListener('input', () => {
          answers[q.id] = area.value;
          scheduleSave();
        });
        wrap.appendChild(area);
      }

      questionsEl.appendChild(wrap);
    });

    progressEl.textContent = oneAtATime
      ? `Pregunta ${currentIndex + 1} de ${questions.length}`
      : `${questions.length} preguntas`;

    prevBtn.hidden = !oneAtATime || currentIndex <= 0 || Boolean(anti.lockNavigation);
    nextBtn.hidden = !oneAtATime || currentIndex >= questions.length - 1;
    if (anti.lockNavigation) prevBtn.hidden = true;
  }

  function applyAntiCheat() {
    const anti = session?.antiTrampa || {};
    const pauseEl = root.querySelector('[data-aula-pause]');
    const pauseCount = root.querySelector('[data-aula-pause-count]');
    const resumeBtn = root.querySelector('[data-aula-resume]');

    if (anti.watermark && session.watermarkText) {
      watermarkEl.textContent = session.watermarkText;
      watermarkEl.hidden = false;
    } else {
      watermarkEl.hidden = true;
    }

    const requestExamLock = async () => {
      lockGraceUntil = Date.now() + 2500;
      try {
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          await (examPanel.requestFullscreen?.() || document.documentElement.requestFullscreen?.());
        }
      } catch {
        // El navegador puede rechazar fullscreen; no bloquea la prueba.
      }
      try {
        if (navigator.wakeLock?.request) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch {
        wakeLock = null;
      }
      lockGraceUntil = Date.now() + 800;
    };

    const reportFocusLoss = (source) => {
      const stamp = Date.now();
      if (stamp - lastFocusLossAt < 1200) return;
      lastFocusLossAt = stamp;
      api(`/api/aula-temporal/intento/${session.intentoId}/event`, {
        method: 'POST',
        body: JSON.stringify({ type: 'focus_loss', detail: { source } }),
      }).then((result) => {
        if (pauseCount && result.maxFocusLoss) {
          pauseCount.textContent = `Salidas registradas: ${result.focusLosses || '?'} de ${result.maxFocusLoss}.`;
        }
        if (result.estado === 'bloqueado') {
          showDone({
            estado: 'bloqueado',
            mostrarNota: false,
            pendingLink: false,
            message: 'El intento se bloqueó por salir demasiadas veces de la prueba.',
          });
          return;
        }
        if (result.intentoId && result.estado && result.estado !== 'en_curso') {
          showDone(result);
          return;
        }
        if (result.result) {
          showDone(result.result);
          return;
        }
        if (!focusLossReported) {
          statusEl.textContent = `Atención: se registró que saliste (${result.focusLosses || '?'}/${result.maxFocusLoss || '?'}).`;
          focusLossReported = true;
          setTimeout(() => { focusLossReported = false; }, 4000);
        }
      }).catch(() => {});
    };

    const pauseExam = (source) => {
      if (!session || submitting || examPaused) return;
      if (Date.now() < lockGraceUntil) return;
      examPaused = true;
      examPanel.classList.add('is-paused');
      if (pauseEl) pauseEl.hidden = false;
      reportFocusLoss(source);
    };

    const resumeExam = async () => {
      if (!session || submitting) return;
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        if (pauseCount) {
          pauseCount.textContent = 'Todavía hay otra app o asistente abierto. Cerralo y volvé a tocar.';
        }
        return;
      }
      examPaused = false;
      examPanel.classList.remove('is-paused');
      if (pauseEl) pauseEl.hidden = true;
      await requestExamLock();
    };

    const maybeAway = (source) => {
      if (!session || submitting) return;
      const hidden = document.visibilityState === 'hidden';
      const unfocused = typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
      if (hidden || unfocused) pauseExam(source || (hidden ? 'hidden' : 'blur'));
    };

    if (anti.blockClipboard) {
      examPanel.classList.add('aula-temp-nocopy');
    }

    if (antiCheatBound) {
      void requestExamLock();
      return;
    }
    antiCheatBound = true;

    if (anti.blockClipboard) {
      const block = (event) => event.preventDefault();
      document.addEventListener('copy', block);
      document.addEventListener('cut', block);
      document.addEventListener('paste', block);
      document.addEventListener('contextmenu', block);
      document.addEventListener('dragstart', block);
      document.addEventListener('keydown', (event) => {
        if (!session || submitting) return;
        const key = String(event.key || '').toLowerCase();
        if ((event.ctrlKey || event.metaKey) && ['c', 'v', 'x', 'p', 's', 'u'].includes(key)) {
          event.preventDefault();
        }
      });
    }

    document.addEventListener('visibilitychange', () => maybeAway('hidden'));
    window.addEventListener('blur', () => maybeAway('blur'));
    window.addEventListener('pagehide', () => pauseExam('pagehide'));
    document.addEventListener('freeze', () => pauseExam('freeze'));
    resumeBtn?.addEventListener('click', () => { void resumeExam(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !wakeLock) void requestExamLock();
    });

    clearInterval(focusPollId);
    focusPollId = setInterval(() => {
      if (!session || submitting || examPaused) return;
      maybeAway('poll');
    }, 700);

    clearInterval(heartbeatId);
    heartbeatId = setInterval(() => {
      if (!session || submitting) return;
      api(`/api/aula-temporal/intento/${session.intentoId}/event`, {
        method: 'POST',
        body: JSON.stringify({ type: 'heartbeat' }),
      }).catch(() => {});
    }, 30000);

    void requestExamLock();
  }

  function startTimer() {
    clearInterval(timerId);
    timerId = setInterval(async () => {
      if (!session) return;
      const remain = new Date(session.endsAt).getTime() - now();
      timerEl.textContent = formatRemain(remain);
      timerEl.classList.toggle('is-urgent', remain < 60 * 1000);
      if (remain <= 0) {
        clearInterval(timerId);
        await submit(true);
      }
    }, 250);
  }

  function showDone(result) {
    clearInterval(timerId);
    clearInterval(focusPollId);
    clearInterval(heartbeatId);
    submitting = true;
    examPaused = false;
    examPanel.classList.remove('is-paused');
    const pauseEl = root.querySelector('[data-aula-pause]');
    if (pauseEl) pauseEl.hidden = true;
    show(donePanel);
    doneMsg.textContent = result.message
      || (result.estado === 'vencido'
        ? 'Se entregó automáticamente al vencer el tiempo. La nota se publica al cerrar la clase.'
        : 'Tus respuestas quedaron registradas. La auto-corrección se hace cuando el docente cierre la clase.');
    if (result.mostrarNota && result.nota10 != null) {
      gradeEl.hidden = false;
      gradeEl.textContent = `Nota: ${result.nota10}`;
    } else {
      gradeEl.hidden = true;
    }
    if (result.pendingLink) {
      doneMsg.textContent += ' El docente vinculará tu nota al listado del curso.';
    }
  }

  async function submit(timeout) {
    if (!session || submitting) return;
    submitting = true;
    statusEl.textContent = timeout ? 'Tiempo agotado, entregando…' : 'Entregando…';
    try {
      const data = await api(`/api/aula-temporal/intento/${session.intentoId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          respuestas: answers,
          timeout: Boolean(timeout),
          reason: timeout ? 'timeout' : 'manual_submit',
        }),
      });
      showDone(data.result || {});
    } catch (error) {
      submitting = false;
      statusEl.textContent = error.message || 'No se pudo entregar.';
    }
  }

  function enterExam(nextSession) {
    session = nextSession;
    answers = { ...(nextSession.respuestas || {}) };
    clockOffset = syncClockOffset(nextSession.serverNow);
    currentIndex = 0;
    studentEl.textContent = `${nextSession.apellido}, ${nextSession.nombre}`;
    titleEl.textContent = nextSession.titulo || 'Aula temporal';
    show(examPanel);
    renderQuestion();
    applyAntiCheat();
    startTimer();
  }

  prevBtn?.addEventListener('click', () => {
    if (!session?.antiTrampa?.lockNavigation) {
      currentIndex = Math.max(0, currentIndex - 1);
      renderQuestion();
    }
  });
  nextBtn?.addEventListener('click', () => {
    const max = (session?.preguntas || []).length - 1;
    currentIndex = Math.min(max, currentIndex + 1);
    renderQuestion();
  });
  submitBtn?.addEventListener('click', () => {
    if (confirm('¿Entregar ahora? No podrás modificar las respuestas.')) submit(false);
  });

  joinForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    joinError.hidden = true;
    const data = new FormData(joinForm);
    try {
      const res = await api('/api/aula-temporal/join', {
        method: 'POST',
        body: JSON.stringify({
          token,
          nombre: data.get('nombre'),
          apellido: data.get('apellido'),
        }),
      });
      enterExam(res.session);
    } catch (error) {
      joinError.hidden = false;
      joinError.textContent = error.message || 'No se pudo ingresar.';
    }
  });

  async function boot() {
    try {
      const data = await api(`/api/aula-temporal/public/${encodeURIComponent(token)}`);
      const aula = data.aula;
      titleEl.textContent = aula.titulo;
      metaEl.textContent = `${aula.escuela || ''} · ${aula.cursoNombre || ''} · ${aula.duracionMinutos} min`;
      if (aula.estado === 'preparando') {
        show(preparandoPanel);
        return;
      }
      if (aula.estado !== 'abierta') {
        show(closedPanel);
        return;
      }

      try {
        const resumed = await api(`/api/aula-temporal/public/${encodeURIComponent(token)}/session`);
        if (resumed.done && resumed.result) {
          showDone(resumed.result);
          return;
        }
        if (resumed.session) {
          enterExam(resumed.session);
          return;
        }
      } catch (_) {}

      show(joinPanel);
    } catch (error) {
      titleEl.textContent = 'Link inválido';
      root.querySelector('[data-aula-closed-msg]').textContent = error.message || 'No se encontró el aula.';
      show(closedPanel);
    }
  }

  boot();
})();
