export function resolveMotionPreference(stored, systemReduced) {
  if (stored === 'reduced' || stored === 'full') return stored;
  return systemReduced ? 'reduced' : 'full';
}

export function toggleMotionPreference(current) {
  return current === 'reduced' ? 'full' : 'reduced';
}

export function applyMotionPreference(root, value) {
  if (value !== 'reduced' && value !== 'full') throw new TypeError('motion preference must be reduced or full');
  root.dataset.motion = value;
}

export const CASE_STATES = Object.freeze(['overview', 'conflict', 'proposal', 'decision', 'result']);
export const FLOW_STEP_SELECTOR = '.flow-node, .outcome-panel, .case-progress span, [data-motion-step]';

export function transitionCase(current, action) {
  const state = CASE_STATES.includes(current) ? current : 'overview';
  if (action === 'reset' && state === 'result') return 'overview';
  if (state === 'decision') {
    if (action === 'approve') return 'result';
    if (action === 'revise') return 'proposal';
    return 'decision';
  }
  if (action !== 'next') return state;
  const index = CASE_STATES.indexOf(state);
  return CASE_STATES[Math.min(index + 1, CASE_STATES.length - 1)];
}

const CASE_MESSAGES = {
  overview: 'Überblick: Drei synthetische Hinweise liegen zur Prüfung vor.',
  conflict: 'Konflikt: Ein veralteter Stand widerspricht der bestätigten Fassung.',
  proposal: 'Vorschlag: Ein belegbarer Klärungsweg ist vorbereitet.',
  decision: 'Entscheidung: Der Ablauf wartet auf Freigabe oder Rückgabe.',
  result: 'Ergebnis: Der Stand ist konsolidiert und der Belegweg bleibt sichtbar.'
};

export function initKnowledgeCase(root, { reduced = false } = {}) {
  const demos = [...root.querySelectorAll('[data-case-demo]')];
  const cleanups = [];

  for (const demo of demos) {
    const panels = [...demo.querySelectorAll('[data-case-panel]')];
    const controls = demo.querySelector('[data-case-controls]');
    const live = demo.querySelector('[data-case-live]');
    const progress = [...demo.querySelectorAll('.case-progress span')];
    const buttons = {
      next: demo.querySelector('[data-case-next]'),
      approve: demo.querySelector('[data-case-approve]'),
      revise: demo.querySelector('[data-case-revise]'),
      reset: demo.querySelector('[data-case-reset]')
    };
    let state = CASE_STATES.includes(demo.dataset.caseState) ? demo.dataset.caseState : 'overview';
    let transitioning = false;
    let transitionTimer = null;

    const sync = () => {
      demo.dataset.caseState = state;
      progress.forEach((step, index) => {
        if (CASE_STATES[index] === state) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
      if (buttons.next) {
        buttons.next.hidden = state === 'result';
        buttons.next.disabled = transitioning || state === 'decision';
      }
      if (buttons.approve) {
        buttons.approve.hidden = state !== 'decision';
        buttons.approve.disabled = transitioning;
      }
      if (buttons.revise) {
        buttons.revise.hidden = state !== 'decision';
        buttons.revise.disabled = transitioning;
      }
      if (buttons.reset) {
        buttons.reset.hidden = state !== 'result';
        buttons.reset.disabled = transitioning;
      }
      if (live) live.textContent = CASE_MESSAGES[state];
    };

    const finishTransition = (previousPanel, nextPanel) => {
      clearTimeout(transitionTimer);
      transitionTimer = null;
      previousPanel.hidden = true;
      previousPanel.classList.remove('is-case-leaving');
      nextPanel.classList.remove('is-case-entering');
      transitioning = false;
      sync();
    };

    const render = (nextState, { immediate = false } = {}) => {
      const previousState = state;
      const previousPanel = panels.find((panel) => panel.dataset.casePanel === previousState);
      const nextPanel = panels.find((panel) => panel.dataset.casePanel === nextState);
      if (immediate) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
        transitioning = false;
        for (const panel of panels) panel.classList.remove('is-case-leaving', 'is-case-entering');
      }
      if (!nextPanel) {
        sync();
        return;
      }

      if (nextState === previousState) {
        if (immediate) for (const panel of panels) panel.hidden = panel !== nextPanel;
        sync();
        return;
      }

      state = nextState;
      demo.dataset.caseState = state;
      const reduced = demo.ownerDocument?.documentElement?.dataset.motion !== 'full';
      if (immediate || reduced || !previousPanel) {
        for (const panel of panels) panel.hidden = panel !== nextPanel;
        transitioning = false;
        sync();
        return;
      }

      transitioning = true;
      nextPanel.hidden = false;
      previousPanel.classList.add('is-case-leaving');
      nextPanel.classList.add('is-case-entering');
      sync();
      const done = () => finishTransition(previousPanel, nextPanel);
      nextPanel.addEventListener('animationend', done, { once: true });
      transitionTimer = setTimeout(done, 650);
    };

    const listeners = [];
    if (reduced) {
      clearTimeout(transitionTimer);
      for (const panel of panels) {
        panel.hidden = false;
        panel.classList.remove('is-case-leaving', 'is-case-entering');
      }
      controls?.setAttribute('hidden', '');
      demo.classList.remove('is-case-enhanced');
      if (live) live.textContent = 'Alle fünf Schritte sind statisch sichtbar.';
      cleanups.push(() => {});
      continue;
    }
    for (const [action, button] of Object.entries(buttons)) {
      if (!button) continue;
      const handler = () => {
        if (transitioning) return;
        render(transitionCase(state, action));
      };
      button.addEventListener('click', handler);
      listeners.push(() => button.removeEventListener('click', handler));
    }
    const replayHandler = () => render('overview', { immediate: true });
    demo.addEventListener('flowreplay', replayHandler);
    listeners.push(() => demo.removeEventListener('flowreplay', replayHandler));
    controls?.removeAttribute('hidden');
    demo.classList.add('is-case-enhanced');
    for (const panel of panels) panel.hidden = panel.dataset.casePanel !== state;
    sync();
    cleanups.push(() => {
      clearTimeout(transitionTimer);
      listeners.forEach((remove) => remove());
    });
  }

  return { disconnect: () => cleanups.forEach((cleanup) => cleanup()) };
}

export function initReveal({ root, reduced, IntersectionObserverCtor }) {
  const elements = [...root.querySelectorAll('[data-reveal]')];
  for (const element of elements) element.hidden = false;

  if (reduced || typeof IntersectionObserverCtor !== 'function') {
    for (const element of elements) element.classList.add('is-visible');
    return { disconnect() {} };
  }

  const observer = new IntersectionObserverCtor((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  for (const element of elements) observer.observe(element);
  return { disconnect: () => observer.disconnect() };
}

export function initFlowMotion({ root, reduced, IntersectionObserverCtor }) {
  const visuals = [...root.querySelectorAll('[data-flow]')];
  const cleanups = [];
  const timers = new Map();
  const durations = { application: 6200, knowledge: 6200, language: 6200 };
  const windowObject = root.ownerDocument?.defaultView;
  const narrowViewport = windowObject?.matchMedia?.('(max-width: 47.99rem)');
  const mobileProjects = new Set(['application', 'language']);
  const responsiveVisuals = visuals.filter((visual) => mobileProjects.has(visual.dataset.projectVisual));
  for (const visual of visuals) {
    [...visual.querySelectorAll?.(FLOW_STEP_SELECTOR) ?? []].forEach((node, index) => node.style?.setProperty('--flow-order', index));
    visual.dataset.flowRun = visual.dataset.flowRun || '0';
  }

  const complete = (visual) => {
    timers.delete(visual);
    visual.dataset.flowPhase = 'complete';
    visual.classList.add('is-flow-complete');
  };

  const show = (visual, replay = false) => {
    clearTimeout(timers.get(visual));
    visual.classList.remove('is-flow-visible', 'is-flow-complete');
    visual.dataset.flowPhase = 'idle';
    if (replay) void visual.offsetWidth;
    visual.dataset.flowRun = String(Number(visual.dataset.flowRun || 0) + 1);
    visual.classList.add('is-flow-visible');
    if (reduced) {
      complete(visual);
      return;
    }
    visual.dataset.flowPhase = 'running';
    const duration = durations[visual.dataset.projectVisual] ?? 1600;
    timers.set(visual, setTimeout(() => complete(visual), duration));
  };

  const isInsideViewport = (element) => {
    const box = element.getBoundingClientRect?.();
    return Boolean(box && box.top < windowObject.innerHeight && box.bottom > 0 && box.left < windowObject.innerWidth && box.right > 0);
  };

  const activateMobileSteps = (visual, candidates, { restart = false } = {}) => {
    const visible = [...candidates]
      .filter((element) => isInsideViewport(element) && (restart || !element.classList.contains('is-step-visible')))
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
    if (!visible.length) return;
    for (const [index, element] of visible.entries()) {
      element.style.setProperty('--viewport-order', index);
      if (restart) element.classList.remove('is-step-visible');
    }
    if (restart) visual.classList.remove('is-mobile-return-active');
    void visual.offsetWidth;
    for (const element of visible) {
      element.dataset.stepRun = String(Number(element.dataset.stepRun || 0) + 1);
      element.classList.add('is-step-visible');
    }
    if (visual.classList.contains('loop-flow') && visible.some((element) => element.classList.contains('outcome-panel'))) {
      visual.classList.add('is-mobile-return-active');
    }
  };

  for (const visual of visuals) {
    const replayButton = visual.querySelector?.('[data-flow-replay]');
    if (!replayButton) continue;
    replayButton.hidden = reduced;
    const handler = () => {
      visual.dispatchEvent?.(new Event('flowreplay'));
      show(visual, true);
      if (responsiveVisuals.includes(visual) && narrowViewport?.matches) {
        activateMobileSteps(visual, visual.querySelectorAll(FLOW_STEP_SELECTOR), { restart: true });
      }
    };
    replayButton.addEventListener('click', handler);
    cleanups.push(() => replayButton.removeEventListener('click', handler));
  }

  if (reduced || typeof IntersectionObserverCtor !== 'function') {
    for (const visual of visuals) show(visual);
    return {
      disconnect() {
        for (const timer of timers.values()) clearTimeout(timer);
        cleanups.forEach((cleanup) => cleanup());
      }
    };
  }

  const observer = new IntersectionObserverCtor((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      show(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.18 });
  for (const visual of visuals) observer.observe(visual);

  let stepObserver;
  if (responsiveVisuals.length) {
    stepObserver = new IntersectionObserverCtor((entries) => {
      const enteredByVisual = new Map();
      for (const entry of entries) {
        const visual = entry.target.closest('[data-flow]');
        if (!narrowViewport?.matches) {
          entry.target.classList.remove('is-step-visible');
          if (entry.target.classList.contains('outcome-panel')) visual.classList.remove('is-mobile-return-active');
          continue;
        }
        if (!entry.isIntersecting) {
          entry.target.classList.remove('is-step-visible');
          if (entry.target.classList.contains('outcome-panel')) visual.classList.remove('is-mobile-return-active');
          continue;
        }
        if (entry.intersectionRatio < 0.3 || entry.target.classList.contains('is-step-visible')) continue;
        if (!enteredByVisual.has(visual)) enteredByVisual.set(visual, []);
        enteredByVisual.get(visual).push(entry.target);
      }
      for (const [visual, entered] of enteredByVisual) activateMobileSteps(visual, entered);
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.3 });
    for (const visual of responsiveVisuals) {
      for (const step of visual.querySelectorAll(FLOW_STEP_SELECTOR)) stepObserver.observe(step);
    }
  }
  return {
    disconnect() {
      observer.disconnect();
      stepObserver?.disconnect();
      for (const timer of timers.values()) clearTimeout(timer);
      for (const visual of responsiveVisuals) {
        visual.classList.remove('is-mobile-return-active');
        for (const step of visual.querySelectorAll('.is-step-visible')) step.classList.remove('is-step-visible');
      }
      cleanups.forEach((cleanup) => cleanup());
    }
  };
}

const STORY_CONTENT_SELECTOR = [
  '[data-scroll-section] > .eyebrow',
  '[data-scroll-section] > h2',
  '.hero-copy > *',
  '.hero-workbench',
  '[data-scroll-section] > p:not(.eyebrow)',
  '.card-grid > *',
  '.process-flow > *'
].join(', ');

export function resolvePreviewDuration(value) {
  const duration = Number.parseInt(value, 10);
  if (!Number.isFinite(duration)) return 6200;
  return Math.min(6200, Math.max(2500, duration));
}

export function initPreviewMotion({ root, reduced, IntersectionObserverCtor }) {
  const previews = [...root.querySelectorAll?.('[data-preview-sequence]') ?? []]
    .filter((preview) => !preview.closest?.('[data-scroll-story]'));
  const cleanups = [];
  const timers = new Map();

  const stop = (preview) => {
    for (const stage of preview.querySelectorAll('.sequence-motion-stage')) {
      stage.setCurrentTime?.(0);
      stage.pauseAnimations?.();
    }
  };

  const complete = (preview) => {
    timers.delete(preview);
    preview.dataset.previewPhase = 'complete';
    preview.classList.remove('is-preview-playing');
  };

  const start = (preview, replay = false) => {
    if (!replay && Number(preview.dataset.previewRun || 0) > 0) return;
    clearTimeout(timers.get(preview));
    preview.classList.remove('is-preview-playing');
    if (replay) void preview.offsetWidth;
    preview.dataset.previewRun = String(Number(preview.dataset.previewRun || 0) + 1);
    preview.dataset.previewPhase = 'running';
    preview.classList.add('is-preview-playing');
    for (const stage of preview.querySelectorAll('.sequence-motion-stage')) stage.unpauseAnimations?.();
    for (const motion of preview.querySelectorAll('[data-object-motion]')) motion.beginElement?.();
    timers.set(preview, setTimeout(() => complete(preview), resolvePreviewDuration(preview.dataset.previewDuration)));
  };

  for (const preview of previews) {
    preview.dataset.previewRun = preview.dataset.previewRun || '0';
    preview.dataset.previewPhase = reduced ? 'complete' : 'idle';
    if (reduced) stop(preview);
    const replayButton = preview.querySelector('[data-preview-replay]');
    if (!replayButton) continue;
    replayButton.hidden = reduced;
    const handler = () => start(preview, true);
    replayButton.addEventListener('click', handler);
    cleanups.push(() => replayButton.removeEventListener('click', handler));
  }

  if (reduced) {
    return { disconnect() { cleanups.forEach((cleanup) => cleanup()); } };
  }

  if (typeof IntersectionObserverCtor !== 'function') {
    for (const preview of previews) start(preview);
    return {
      disconnect() {
        for (const timer of timers.values()) clearTimeout(timer);
        for (const preview of previews) stop(preview);
        cleanups.forEach((cleanup) => cleanup());
      }
    };
  }

  const observer = new IntersectionObserverCtor((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.3) continue;
      start(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.3 });
  for (const preview of previews) observer.observe(preview);
  return {
    disconnect() {
      observer.disconnect();
      for (const timer of timers.values()) clearTimeout(timer);
      for (const preview of previews) {
        stop(preview);
        preview.classList.remove('is-preview-playing');
      }
      cleanups.forEach((cleanup) => cleanup());
    }
  };
}

function clampStoryProgress(value) {
  return Math.min(1, Math.max(0, value));
}

export function computeStoryProgress(sectionTop, viewportHeight) {
  const height = Math.max(Number(viewportHeight) || 0, 1);
  return clampStoryProgress((height * 1.02 - Number(sectionTop || 0)) / (height * 0.9));
}

export function computeTransitionOffsets(progress, index, viewportWidth) {
  const normalized = clampStoryProgress(Number(progress) || 0);
  const reach = Math.min(Math.max((Number(viewportWidth) || 0) * 0.42, 160), 360);
  const direction = Number(index) % 2 ? 1 : -1;
  const x = direction * (normalized - 0.5) * reach * 2;
  return {
    progress: normalized,
    x: Object.is(x, -0) ? 0 : x,
    y: (normalized - 0.5) * 72,
    depth: 0.72 + normalized * 0.28
  };
}

export function computeSequenceStepProgress(progress, index, count = 1) {
  const total = Math.max(1, Number.parseInt(count, 10) || 1);
  const position = total === 1 ? 0 : clampStoryProgress(Number(index || 0) / (total - 1));
  const start = 0.04 + position * 0.28;
  return clampStoryProgress((Number(progress || 0) - start) / 0.62);
}

export function computePreviewProgress(elementTop, viewportHeight) {
  const height = Math.max(Number(viewportHeight) || 0, 1);
  return clampStoryProgress((height * 0.96 - Number(elementTop || 0)) / (height * 1.25));
}

export function advanceSequenceProgress(start, target, elapsedMs, visible, durationMs = 260) {
  const from = clampStoryProgress(Number(start) || 0);
  const to = clampStoryProgress(Number(target) || 0);
  if (!visible) return to;
  const duration = Math.max(Number(durationMs) || 260, 1);
  const elapsed = Math.max(Number(elapsedMs) || 0, 0);
  const progress = clampStoryProgress(elapsed / duration);
  return Number((from + (to - from) * progress).toFixed(6));
}

export function computeContinuityProgress(storyTop, storyHeight, viewportHeight, headerOffset = 0) {
  const travel = Math.max((Number(storyHeight) || 0) - (Number(viewportHeight) || 0), 1);
  return clampStoryProgress(((Number(headerOffset) || 0) - (Number(storyTop) || 0)) / travel);
}

export function computeDockGeometry(sourceRect, targetRect, progress) {
  const normalized = clampStoryProgress(Number(progress) || 0);
  const sourceWidth = Math.max(Number(sourceRect?.width) || 0, 1);
  const sourceHeight = Math.max(Number(sourceRect?.height) || 0, 1);
  const targetWidth = Math.max(Number(targetRect?.width) || 0, 1);
  const targetHeight = Math.max(Number(targetRect?.height) || 0, 1);
  const targetScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  return {
    x: Number((((Number(targetRect?.left) || 0) - (Number(sourceRect?.left) || 0)) * normalized).toFixed(4)),
    y: Number((((Number(targetRect?.top) || 0) - (Number(sourceRect?.top) || 0)) * normalized).toFixed(4)),
    scale: Number((1 + (targetScale - 1) * normalized).toFixed(4))
  };
}

export function removeStoryTranslation(rectTop, translateY) {
  return Number(rectTop || 0) - (Number.parseFloat(translateY) || 0);
}

export function initScrollStory({ root, reduced, windowObject }) {
  const story = root.querySelector?.('[data-scroll-story]');
  if (!story || !windowObject?.requestAnimationFrame) return { disconnect() {} };

  const sections = [...story.querySelectorAll('[data-scroll-section]')];
  const content = [...story.querySelectorAll(STORY_CONTENT_SELECTOR)];
  const sequences = [...story.querySelectorAll('[data-preview-sequence]')];
  const sequenceStates = new Map(sequences.map((sequence) => [sequence, {
    rendered: null,
    start: 0,
    target: 0,
    startedAt: 0,
    settled: true
  }]));
  let frame = 0;
  let disconnected = false;

  const reset = () => {
    story.dataset.storyMotion = 'static';
    story.style.removeProperty('--story-track-progress');
    for (const section of sections) {
      for (const property of ['--story-progress', '--story-seam-a', '--story-seam-b', '--story-seam-c', '--story-seam-d', '--story-seam-e', '--story-junction-y', '--story-junction-scale', '--story-carrier-x', '--story-carrier-y', '--transition-progress', '--transition-x', '--transition-y', '--transition-depth', '--transition-layer-a-x', '--transition-layer-a-y', '--transition-layer-b-x', '--transition-layer-b-y', '--transition-layer-c-x', '--transition-layer-c-y', '--project-progress', '--chapter-enter', '--chapter-exit']) {
        section.style.removeProperty(property);
      }
    }
    for (const element of content) {
      element.style.removeProperty('--story-content-x');
      element.style.removeProperty('--story-content-y');
    }
    for (const sequence of sequences) {
      sequence.style.removeProperty('--preview-progress');
      const portfolioHero = sequence.querySelector('[data-portfolio-hero]');
      portfolioHero?.style.removeProperty('--portfolio-progress');
      for (const documentTile of sequence.querySelectorAll('[data-portfolio-document]')) documentTile.style.removeProperty('--document-progress');
      for (const step of sequence.querySelectorAll('[data-sequence-step]')) {
        for (const property of ['--step-progress', '--step-opacity', '--step-shift', '--step-scale']) step.style.removeProperty(property);
      }
    }
    sequenceStates.clear();
  };

  if (reduced) {
    reset();
    return { disconnect() {} };
  }

  story.dataset.storyMotion = 'active';
  const render = (timestamp) => {
    frame = 0;
    if (disconnected) return;

    const viewportHeight = Math.max(windowObject.innerHeight || 0, 1);
    const now = Number.isFinite(timestamp) ? timestamp : (windowObject.performance?.now?.() ?? Date.now());
    const documentElement = root.ownerDocument?.documentElement;
    const maximumScroll = Math.max((documentElement?.scrollHeight || 0) - viewportHeight, 1);
    const trackProgress = clampStoryProgress((windowObject.scrollY || 0) / maximumScroll);
    const sectionReads = sections.map((section, index) => ({ section, index, progress: computeStoryProgress(section.getBoundingClientRect().top, viewportHeight) }));
    const contentReads = content.map((element) => {
      const rectTop = element.getBoundingClientRect().top;
      const untranslatedTop = removeStoryTranslation(rectTop, element.style.getPropertyValue('--story-content-y'));
      return {
        element,
        progress: computeStoryProgress(untranslatedTop, viewportHeight),
        drifts: element.matches('.card-grid > *:nth-child(even), .process-flow > *:nth-child(even)')
      };
    });
    let sequenceNeedsFrame = false;
    const sequenceReads = sequences.map((sequence) => {
      const motionElement = sequence.querySelector('.chapter-sequence') ?? sequence;
      const motionRect = motionElement.getBoundingClientRect();
      const target = computePreviewProgress(motionRect.top, viewportHeight);
      const visible = motionRect.top < viewportHeight && motionRect.bottom > 0;
      const state = sequenceStates.get(sequence);

      if (state.rendered == null) {
        state.start = visible && target > 0 && target < 1 ? 0 : target;
        state.rendered = state.start;
        state.target = target;
        state.startedAt = now;
        state.settled = !visible || Math.abs(state.rendered - target) < 0.0005;
      } else if (!visible) {
        state.start = target;
        state.rendered = target;
        state.target = target;
        state.startedAt = now;
        state.settled = true;
      } else {
        const targetChanged = Math.abs(target - state.target) >= 0.0005;
        if (targetChanged) {
          state.start = state.rendered;
          state.startedAt = now;
          state.target = target;
          state.settled = false;
        }
        const elapsed = now - state.startedAt;
        state.rendered = advanceSequenceProgress(state.start, state.target, elapsed, true);
        if (elapsed >= 260 || Math.abs(state.rendered - state.target) < 0.0005) {
          state.start = state.target;
          state.rendered = state.target;
          state.settled = true;
        }
      }

      if (visible && !state.settled) sequenceNeedsFrame = true;
      return {
        sequence,
        progress: state.rendered,
        steps: [...sequence.querySelectorAll('[data-sequence-step]')],
        portfolioHero: sequence.querySelector('[data-portfolio-hero]'),
        portfolioDocuments: [...sequence.querySelectorAll('[data-portfolio-document]')]
      };
    });

    story.style.setProperty('--story-track-progress', trackProgress.toFixed(4));
    const seamStart = [6, 10, 16, 24, 32];
    const seamEnd = [18, 31, 58, 80, 100];
    const seamProperties = ['--story-seam-a', '--story-seam-b', '--story-seam-c', '--story-seam-d', '--story-seam-e'];
    for (const { section, index, progress } of sectionReads) {
      const transition = computeTransitionOffsets(progress, index, windowObject.innerWidth || 0);
      section.style.setProperty('--story-progress', progress.toFixed(4));
      section.style.setProperty('--transition-progress', transition.progress.toFixed(4));
      section.style.setProperty('--transition-x', `${transition.x.toFixed(3)}px`);
      section.style.setProperty('--transition-y', `${transition.y.toFixed(3)}px`);
      section.style.setProperty('--transition-depth', transition.depth.toFixed(4));
      if (section.matches('[data-project-chapter]')) {
        section.style.setProperty('--project-progress', progress.toFixed(4));
        section.style.setProperty('--chapter-enter', clampStoryProgress(progress / 0.68).toFixed(4));
        section.style.setProperty('--chapter-exit', clampStoryProgress((progress - 0.78) / 0.22).toFixed(4));
      }
      section.style.setProperty('--transition-layer-a-x', `${(transition.x * 0.18).toFixed(3)}px`);
      section.style.setProperty('--transition-layer-a-y', `${(transition.y * -0.65).toFixed(3)}px`);
      section.style.setProperty('--transition-layer-b-x', `${(transition.x * -0.1).toFixed(3)}px`);
      section.style.setProperty('--transition-layer-b-y', `${(transition.y * 0.8).toFixed(3)}px`);
      section.style.setProperty('--transition-layer-c-x', `${(transition.x * 0.06).toFixed(3)}px`);
      section.style.setProperty('--transition-layer-c-y', `${(transition.y * -0.35).toFixed(3)}px`);
      seamProperties.forEach((property, index) => {
        section.style.setProperty(property, `${(seamStart[index] + (seamEnd[index] - seamStart[index]) * progress).toFixed(3)}%`);
      });
      section.style.setProperty('--story-junction-y', `${(-44 * (1 - progress)).toFixed(3)}px`);
      section.style.setProperty('--story-junction-scale', (0.84 + 0.16 * progress).toFixed(4));
      const carrierReach = Math.min((windowObject.innerWidth || 0) * 0.65, 440);
      const carrierDirection = index % 2 ? 1 : -1;
      section.style.setProperty('--story-carrier-x', `${(carrierDirection * (progress - 0.5) * carrierReach * 2).toFixed(3)}px`);
      section.style.setProperty('--story-carrier-y', `${((progress - 0.5) * 60).toFixed(3)}px`);
    }
    for (const { element, progress, drifts } of contentReads) {
      element.style.setProperty('--story-content-x', `${(drifts ? -24 * (1 - progress) : 0).toFixed(3)}px`);
      element.style.setProperty('--story-content-y', `${(drifts ? 0 : 32 * (1 - progress)).toFixed(3)}px`);
    }
    for (const { sequence, progress, steps, portfolioHero, portfolioDocuments } of sequenceReads) {
      sequence.style.setProperty('--preview-progress', progress.toFixed(4));
      steps.forEach((step, index) => {
        const stepProgress = computeSequenceStepProgress(progress, index, steps.length);
        step.style.setProperty('--step-progress', stepProgress.toFixed(4));
        step.style.setProperty('--step-opacity', (0.12 + stepProgress * 0.88).toFixed(4));
        step.style.setProperty('--step-shift', `${((1 - stepProgress) * 56).toFixed(3)}px`);
        step.style.setProperty('--step-scale', (0.9 + stepProgress * 0.1).toFixed(4));
      });
      if (portfolioHero) portfolioHero.style.setProperty('--portfolio-progress', progress.toFixed(4));
      portfolioDocuments.forEach((documentTile, index) => {
        documentTile.style.setProperty('--document-progress', computeSequenceStepProgress(progress, index, portfolioDocuments.length).toFixed(4));
      });
    }
    if (sequenceNeedsFrame && !frame && !disconnected) frame = windowObject.requestAnimationFrame(render);
  };

  const schedule = () => {
    if (!frame && !disconnected) frame = windowObject.requestAnimationFrame(render);
  };
  windowObject.addEventListener('scroll', schedule, { passive: true });
  windowObject.addEventListener('resize', schedule, { passive: true });
  render();

  return {
    disconnect() {
      disconnected = true;
      if (frame) windowObject.cancelAnimationFrame(frame);
      windowObject.removeEventListener('scroll', schedule);
      windowObject.removeEventListener('resize', schedule);
      reset();
    }
  };
}

export function resolveCoordinationState(mode) {
  if (mode === 'unsafe') {
    return {
      mode: 'unsafe',
      entries: ['D'],
      bridge: 'GLEICHER ALTER STAND',
      title: '1 von 4 Einträgen bleibt.',
      reason: 'Alle lesen denselben alten Stand und überschreiben einander.'
    };
  }
  return {
    mode: 'safe',
    entries: ['A', 'B', 'C', 'D'],
    bridge: 'LESEN → SCHREIBEN → FREIGEBEN',
    title: '4 von 4 Einträgen bleiben.',
    reason: 'Jeder Prozess übernimmt den bestätigten Stand seines Vorgängers.'
  };
}

export function resolveCoordinationTrace(mode) {
  if (mode === 'unsafe') {
    return [
      { process: 'A', action: 'read', stored: [] },
      { process: 'B', action: 'read', stored: [] },
      { process: 'C', action: 'read', stored: [] },
      { process: 'D', action: 'read', stored: [] },
      { process: 'A', action: 'write', stored: ['A'] },
      { process: 'B', action: 'write', stored: ['B'] },
      { process: 'C', action: 'write', stored: ['C'] },
      { process: 'D', action: 'write', stored: ['D'] }
    ];
  }
  return [
    { process: 'A', action: 'read', stored: [] },
    { process: 'A', action: 'write', stored: ['A'] },
    { process: 'B', action: 'read', stored: ['A'] },
    { process: 'B', action: 'write', stored: ['A', 'B'] },
    { process: 'C', action: 'read', stored: ['A', 'B'] },
    { process: 'C', action: 'write', stored: ['A', 'B', 'C'] },
    { process: 'D', action: 'read', stored: ['A', 'B', 'C'] },
    { process: 'D', action: 'write', stored: ['A', 'B', 'C', 'D'] }
  ];
}

export function resolveCoordinationStepDuration(action) {
  return action === 'write' ? 850 : 450;
}

export function initPortfolioHero(root, { reduced = false, windowObject = globalThis, IntersectionObserverCtor } = {}) {
  const heroes = [...root.querySelectorAll?.('[data-portfolio-hero]') ?? []];
  const cleanups = [];
  const runners = new Map();

  for (const hero of heroes) {
    const documents = [...hero.querySelectorAll('[data-portfolio-document]')];
    const filterButtons = [...hero.querySelectorAll('[data-portfolio-filter]')];
    const replay = hero.querySelector('[data-portfolio-replay]');
    const controls = hero.querySelector('[data-portfolio-controls]');
    let timer = null;
    let stopped = false;

    const setProgress = (progress) => {
      const normalized = clampStoryProgress(progress);
      hero.style.setProperty('--portfolio-progress', normalized.toFixed(4));
      documents.forEach((documentTile, index) => {
        documentTile.style.setProperty('--document-progress', computeSequenceStepProgress(normalized, index, documents.length).toFixed(4));
      });
    };

    const setFilter = (requested) => {
      const filter = requested === 'flags' ? 'flags' : 'all';
      hero.dataset.documentFilter = filter;
      filterButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.portfolioFilter === filter)));
      documents.forEach((documentTile) => {
        if (filter === 'flags' && !documentTile.hasAttribute('data-portfolio-flag')) documentTile.dataset.filteredOut = 'true';
        else delete documentTile.dataset.filteredOut;
      });
    };

    const finish = () => {
      timer = null;
      setProgress(1);
      hero.dataset.portfolioPhase = 'complete';
    };

    const run = () => {
      if (timer != null) windowObject.clearTimeout(timer);
      hero.dataset.portfolioRun = String(Number(hero.dataset.portfolioRun || 0) + 1);
      if (reduced) {
        finish();
        return;
      }
      let frame = 0;
      const totalFrames = 36;
      hero.dataset.portfolioPhase = 'running';
      setProgress(0);
      const advance = () => {
        if (stopped) return;
        frame += 1;
        setProgress(frame / totalFrames);
        if (frame >= totalFrames) {
          finish();
          return;
        }
        timer = windowObject.setTimeout(advance, 100);
      };
      timer = windowObject.setTimeout(advance, 100);
    };

    for (const button of filterButtons) {
      const handler = () => setFilter(button.dataset.portfolioFilter);
      button.addEventListener('click', handler);
      cleanups.push(() => button.removeEventListener('click', handler));
    }
    if (replay) {
      const handler = () => run();
      replay.addEventListener('click', handler);
      replay.hidden = reduced;
      cleanups.push(() => replay.removeEventListener('click', handler));
    }
    if (controls) controls.hidden = false;
    setFilter(hero.dataset.documentFilter);
    if (reduced) finish();
    else hero.dataset.portfolioPhase = 'complete';
    if (!reduced) runners.set(hero, run);
    cleanups.push(() => {
      stopped = true;
      if (timer != null) windowObject.clearTimeout(timer);
    });
  }

  let observer;
  if (!reduced && typeof IntersectionObserverCtor === 'function') {
    observer = new IntersectionObserverCtor((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.25) continue;
        runners.get(entry.target)?.();
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.25 });
    for (const hero of runners.keys()) observer.observe(hero);
  } else if (!reduced) {
    for (const run of runners.values()) run();
  }
  cleanups.push(() => observer?.disconnect());

  return { disconnect: () => cleanups.forEach((cleanup) => cleanup()) };
}

export function initPortfolioShowcase(root, { reduced = false, windowObject = globalThis, IntersectionObserverCtor } = {}) {
  const demos = [...root.querySelectorAll?.('[data-coordination-demo]') ?? []];
  const cleanups = [];
  const timers = new Set();
  const runners = new Map();
  const schedule = (callback, delay) => {
    const timer = windowObject.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  };
  const cancel = (timer) => {
    if (timer == null) return;
    windowObject.clearTimeout(timer);
    timers.delete(timer);
  };
  for (const demo of demos) {
    const buttons = [...demo.querySelectorAll('[data-coordination-mode]')];
    const entries = [...demo.querySelectorAll('[data-file-entry]')];
    const processes = [...demo.querySelectorAll('[data-process]')];
    const bridge = demo.querySelector('[data-coordination-bridge]');
    const title = demo.querySelector('[data-coordination-title]');
    const reason = demo.querySelector('[data-coordination-reason]');
    const icon = demo.querySelector('[data-coordination-icon]');
    const writeFlow = demo.querySelector('[data-write-flow]');
    const writeSource = demo.querySelector('[data-write-source]');
    const replay = demo.querySelector('[data-coordination-replay]');
    let runTimer = null;
    let stopped = false;

    const syncEntries = (stored) => {
      entries.forEach((entry) => { entry.hidden = !stored.includes(entry.dataset.fileEntry); });
    };

    const syncWriteFlow = (process = '') => {
      const active = process.length > 0;
      if (writeFlow) {
        writeFlow.dataset.active = String(active);
        writeFlow.dataset.source = process;
      }
      if (writeSource) writeSource.textContent = active ? process : '–';
      entries.forEach((entry) => {
        if (active && entry.dataset.fileEntry === process) entry.dataset.writeActive = 'true';
        else delete entry.dataset.writeActive;
      });
    };

    const syncMode = (mode) => {
      const state = resolveCoordinationState(mode);
      demo.dataset.mode = state.mode;
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.coordinationMode === state.mode)));
      if (bridge) bridge.textContent = state.bridge;
      if (title) title.textContent = state.title;
      if (reason) reason.textContent = state.reason;
      if (icon) icon.textContent = state.mode === 'safe' ? '✓' : '!';
      return state;
    };

    const clearProcesses = (label = 'wartet') => {
      processes.forEach((process) => {
        process.dataset.active = 'false';
        const state = process.querySelector('[data-process-state]');
        if (state) state.textContent = label;
      });
      syncWriteFlow();
    };

    const syncStatic = (mode) => {
      cancel(runTimer);
      runTimer = null;
      const state = syncMode(mode);
      syncEntries(state.entries);
      clearProcesses('geschrieben');
      demo.dataset.traceIndex = '8';
      demo.dataset.runPhase = 'complete';
    };

    const run = (mode) => {
      cancel(runTimer);
      runTimer = null;
      const state = syncMode(mode);
      demo.dataset.run = String(Number(demo.dataset.run || 0) + 1);
      if (reduced) {
        syncStatic(state.mode);
        return;
      }
      const trace = resolveCoordinationTrace(state.mode);
      let index = 0;
      demo.dataset.runPhase = 'running';
      demo.dataset.traceIndex = '0';
      syncEntries([]);
      clearProcesses();

      const advance = () => {
        if (stopped) return;
        if (index >= trace.length) {
          syncEntries(state.entries);
          clearProcesses('geschrieben');
          demo.dataset.runPhase = 'complete';
          runTimer = null;
          return;
        }
        const event = trace[index];
        clearProcesses();
        const process = processes.find((candidate) => candidate.dataset.process === event.process);
        if (process) {
          process.dataset.active = 'true';
          const processState = process.querySelector('[data-process-state]');
          if (processState) processState.textContent = event.action === 'read' ? 'liest' : 'schreibt';
        }
        if (event.action === 'write') {
          syncEntries(event.stored);
          syncWriteFlow(event.process);
        }
        index += 1;
        demo.dataset.traceIndex = String(index);
        runTimer = schedule(advance, resolveCoordinationStepDuration(event.action));
      };
      advance();
    };

    for (const button of buttons) {
      const handler = () => run(button.dataset.coordinationMode);
      button.addEventListener('click', handler);
      cleanups.push(() => button.removeEventListener('click', handler));
    }
    if (replay) {
      const handler = () => run(demo.dataset.mode);
      replay.addEventListener('click', handler);
      cleanups.push(() => replay.removeEventListener('click', handler));
    }
    syncStatic(demo.dataset.mode);
    if (!reduced) runners.set(demo, () => run(demo.dataset.mode));
    cleanups.push(() => {
      stopped = true;
      cancel(runTimer);
      clearProcesses('geschrieben');
    });
  }

  let observer;
  if (!reduced && typeof IntersectionObserverCtor === 'function') {
    observer = new IntersectionObserverCtor((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.25) continue;
        runners.get(entry.target)?.();
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.25 });
    for (const demo of runners.keys()) observer.observe(demo);
  } else if (!reduced) {
    for (const run of runners.values()) run();
  }
  return {
    disconnect() {
      observer?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      for (const timer of timers) windowObject.clearTimeout(timer);
      timers.clear();
    }
  };
}

function readStoredMotion(storage) {
  try { return storage.getItem('motion'); } catch { return null; }
}

function writeStoredMotion(storage, value) {
  try { storage.setItem('motion', value); } catch { /* Preference still applies for this page. */ }
}

function updateButton(button, value) {
  if (!button) return;
  const reduced = value === 'reduced';
  button.setAttribute('aria-pressed', String(reduced));
  button.textContent = reduced ? 'Bewegung: reduziert' : 'Bewegung: vollständig';
}

export function initSite({ documentRoot, documentBody, storage, mediaQuery, IntersectionObserverCtor, windowObject }) {
  documentRoot.classList.add('js');
  let value = resolveMotionPreference(readStoredMotion(storage), mediaQuery.matches);
  applyMotionPreference(documentRoot, value);
  const button = documentBody.querySelector('[data-motion-toggle]');
  updateButton(button, value);
  let reveal = initReveal({ root: documentBody, reduced: value === 'reduced', IntersectionObserverCtor });
  let flows = initFlowMotion({ root: documentBody, reduced: value === 'reduced', IntersectionObserverCtor });
  let previews = initPreviewMotion({ root: documentBody, reduced: value === 'reduced', IntersectionObserverCtor });
  let story = initScrollStory({ root: documentBody, reduced: value === 'reduced', windowObject });
  let cases = initKnowledgeCase(documentBody, { reduced: value === 'reduced' });
  let portfolioHero = initPortfolioHero(documentBody, { reduced: value === 'reduced', windowObject, IntersectionObserverCtor });
  let portfolio = initPortfolioShowcase(documentBody, { reduced: value === 'reduced', windowObject, IntersectionObserverCtor });

  button?.addEventListener('click', () => {
    value = toggleMotionPreference(value);
    writeStoredMotion(storage, value);
    applyMotionPreference(documentRoot, value);
    updateButton(button, value);
    reveal.disconnect();
    reveal = initReveal({ root: documentBody, reduced: value === 'reduced', IntersectionObserverCtor });
    flows.disconnect();
    previews.disconnect();
    cases.disconnect();
    flows = initFlowMotion({ root: documentBody, reduced: value === 'reduced', IntersectionObserverCtor });
    previews = initPreviewMotion({ root: documentBody, reduced: value === 'reduced', IntersectionObserverCtor });
    story.disconnect();
    story = initScrollStory({ root: documentBody, reduced: value === 'reduced', windowObject });
    cases = initKnowledgeCase(documentBody, { reduced: value === 'reduced' });
    portfolioHero.disconnect();
    portfolioHero = initPortfolioHero(documentBody, { reduced: value === 'reduced', windowObject, IntersectionObserverCtor });
    portfolio.disconnect();
    portfolio = initPortfolioShowcase(documentBody, { reduced: value === 'reduced', windowObject, IntersectionObserverCtor });
  });
  return { disconnect: () => { reveal.disconnect(); flows.disconnect(); previews.disconnect(); story.disconnect(); cases.disconnect(); portfolioHero.disconnect(); portfolio.disconnect(); } };
}

if (typeof document !== 'undefined') {
  initSite({
    documentRoot: document.documentElement,
    documentBody: document.body,
    storage: window.localStorage,
    mediaQuery: window.matchMedia('(prefers-reduced-motion: reduce)'),
    IntersectionObserverCtor: window.IntersectionObserver,
    windowObject: window
  });
}
