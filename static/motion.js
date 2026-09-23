/* Page motion enhances native scrolling; the page remains usable without it. */
(() => {
  'use strict';

  const main = document.querySelector('main');
  if (!main) return;

  const selector = '[data-page-reveal], .contractor-card, .pipeline-stat, .recent-query';
  const stages = ['intro', 'brief', 'results'];
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const registered = new WeakSet();
  const pending = new Set();
  let revealObserver = null;
  let refreshFrame = 0;
  let scrollFrame = 0;

  const canAnimate = () => !preference.matches && 'IntersectionObserver' in window;

  function reveal(element) {
    element.classList.add('is-revealed');
    pending.delete(element);
    revealObserver?.unobserve(element);
  }

  function revealWithin(element) {
    if (!(element instanceof Element)) return;
    if (element.matches(selector)) reveal(element);
    element.querySelectorAll(selector).forEach(reveal);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches(selector)) reveal(parent);
    }
  }

  function register(element) {
    if (registered.has(element)) return;
    registered.add(element);
    element.classList.add('page-reveal');

    const siblings = element.parentElement
      ? Array.from(element.parentElement.children).filter(child => child.matches(selector))
      : [element];
    const delay = Math.min(Math.max(siblings.indexOf(element), 0), 3) * 80;
    element.style.setProperty('--page-reveal-delay', `${delay}ms`);

    if (!canAnimate() || element.contains(document.activeElement)) {
      reveal(element);
      return;
    }
    pending.add(element);
    revealObserver.observe(element);
  }

  function refresh(container = main) {
    if (!(container instanceof Element)) container = main;
    if (container.matches(selector)) register(container);
    container.querySelectorAll(selector).forEach(register);
    for (const element of pending) {
      if (!element.isConnected) {
        revealObserver?.unobserve(element);
        pending.delete(element);
      }
    }
    scheduleScrollUpdate();
  }

  function scheduleRefresh() {
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      refresh();
    });
  }

  function updateScroll() {
    scrollFrame = 0;
    // A modal may temporarily lock the body. Keep the underlying page's position.
    if (document.querySelector('dialog[open]')) return;

    const viewportHeight = window.innerHeight;
    const scrollTop = Math.max(window.scrollY, 0);
    const scrollRange = Math.max(root.scrollHeight - viewportHeight, 0);
    const progress = scrollRange ? Math.min(scrollTop / scrollRange, 1) : 0;
    const progressBar = document.getElementById('page-progress');
    if (progressBar) progressBar.style.transform = `scaleX(${progress})`;

    const nav = document.getElementById('stage-nav');
    if (!nav) return;
    const availableStages = stages.map(name => ({
      name,
      element: document.getElementById(`stage-${name}`),
    })).filter(stage => stage.element && stage.element.getClientRects().length);

    nav.hidden = availableStages.length === 0;
    if (!availableStages.length) return;
    const readingLine = Math.min(viewportHeight * 0.4, 360);
    let active = availableStages[0];
    for (const stage of availableStages) {
      if (stage.element.getBoundingClientRect().top <= readingLine) active = stage;
    }
    nav.dataset.activeStage = active.name;
    nav.querySelectorAll('[data-stage-target]').forEach(button => {
      const isActive = button.dataset.stageTarget === active.name;
      button.classList.toggle('is-active', isActive);
      if (isActive) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const activeButton = nav.querySelector(`[data-stage-target="${active.name}"]`);
    const title = active.element.dataset.stageTitle || activeButton?.textContent.trim();
    if (title) document.querySelectorAll('[data-current-stage]').forEach(label => {
      if (label.textContent !== title) label.textContent = title;
    });
  }

  function scheduleScrollUpdate() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  }

  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) reveal(entry.target);
      });
    }, {rootMargin: '0px 0px -5% 0px', threshold: 0.01});

    const stageObserver = new IntersectionObserver(scheduleScrollUpdate, {
      threshold: [0, 0.12, 0.3, 0.55, 0.8, 1],
    });
    stages.forEach(name => {
      const stage = document.getElementById(`stage-${name}`);
      if (stage) stageObserver.observe(stage);
    });
  }

  root.classList.toggle('page-motion-ready', canAnimate());
  refresh();

  // Only child insertion/removal and hidden views need rescanning. Our animation
  // classes and inline delay cannot feed back into this observer.
  const contentObserver = new MutationObserver(scheduleRefresh);
  contentObserver.observe(main, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});

  document.addEventListener('focusin', event => {
    if (!(event.target instanceof Element)) return;
    for (let element = event.target; element; element = element.parentElement) {
      if (element.matches(selector)) reveal(element);
    }
  });

  document.getElementById('stage-nav')?.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-stage-target]') : null;
    if (!button || !stages.includes(button.dataset.stageTarget)) return;
    const stage = document.getElementById(`stage-${button.dataset.stageTarget}`);
    if (!stage || !stage.getClientRects().length) return;
    event.preventDefault();
    stage.scrollIntoView({behavior: preference.matches ? 'auto' : 'smooth', block: 'start'});
  });

  const onMotionPreferenceChange = () => {
    root.classList.toggle('page-motion-ready', canAnimate());
    if (!canAnimate()) Array.from(pending).forEach(reveal);
  };
  if (preference.addEventListener) preference.addEventListener('change', onMotionPreferenceChange);
  else preference.addListener(onMotionPreferenceChange);

  window.addEventListener('scroll', scheduleScrollUpdate, {passive: true});
  window.addEventListener('resize', scheduleScrollUpdate, {passive: true});
  window.addEventListener('pageshow', scheduleScrollUpdate);
  document.addEventListener('close', scheduleScrollUpdate, true);
  window.ToygaMotion = Object.freeze({refresh, revealWithin});
})();
