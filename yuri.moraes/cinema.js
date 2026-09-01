(() => {
  'use strict';

  const SCENE_COUNT = 10;
  const mobileQuery = matchMedia('(max-width: 900px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const variant = mobileQuery.matches ? 'mobile' : 'desktop';
  const QUALITY_PROFILES = {
    desktop: {
      '720': { path: 'desktop-720', width: 1280, height: 720, frames: 40, label: '720p' },
      '1080': { path: 'desktop', width: 1920, height: 1080, frames: 40, label: '1080p' },
      full: { path: 'desktop-max', width: 1920, height: 1080, frames: 80, label: 'Full HQ+' }
    },
    mobile: {
      '720': { path: 'mobile', width: 720, height: 1280, frames: 40, label: '720p vertical' },
      '1080': { path: 'mobile-hq', width: 1080, height: 1920, frames: 40, label: '1080p HQ aprimorado' }
    }
  };

  const film = document.querySelector('[data-film]');
  const canvas = document.querySelector('[data-cinema-canvas]');
  const context = canvas?.getContext('2d', { alpha: false });
  const copies = [...document.querySelectorAll('[data-scene-copy]')];
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const sceneNumber = document.querySelector('[data-scene-number]');
  const sceneProgress = document.querySelector('[data-scene-progress]');
  const journeyProgress = document.querySelector('[data-journey-progress]');
  const projectReel = document.querySelector('[data-project-reel]');
  const finalAgentRoster = document.querySelector('[data-final-agent-roster]');
  const finalAgents = [...document.querySelectorAll('[data-final-agent]')];
  const hicVideo = document.querySelector('[data-hic-video]');
  const finalAgentIndex = document.querySelector('[data-final-agent-index]');
  const loader = document.querySelector('[data-loader]');
  const loaderBar = document.querySelector('[data-loader-bar]');
  const loaderLabel = document.querySelector('[data-loader-label]');
  const header = document.querySelector('[data-header]');
  const cue = document.querySelector('.scroll-cue');
  const qualityControl = document.querySelector('[data-quality-control]');
  const qualityLabel = document.querySelector('[data-quality-label]');
  const qualityNote = document.querySelector('[data-quality-note]');
  const qualityButtons = [...document.querySelectorAll('[data-quality-option]')];
  const track = (event, properties = {}) => window.manifestoAnalytics?.track(event, properties);

  if (!film || !canvas || !context || copies.length !== SCENE_COUNT) return;

  let selectedQuality = 'auto';
  try { selectedQuality = localStorage.getItem('yuri-manifesto-quality') || 'auto'; } catch (_) {}
  if (variant === 'mobile' && selectedQuality !== 'auto' && !QUALITY_PROFILES.mobile[selectedQuality]) {
    selectedQuality = 'auto';
  }
  let activeQuality = '720';
  let images = [];
  let pending = new Map();
  let warmedScenes = new Set();
  let cacheEpoch = 0;
  let targetProgress = 0;
  let smoothProgress = 0;
  let activeScene = -1;
  let lastDrawKey = '';
  let raf = 0;
  let chapterEntrySource = 'initial';
  let maxProgress = 0;
  const milestones = new Set();
  const visitedChapters = new Set();
  const frameErrors = new Set();
  const viewedSections = new Set();
  const sessionStartedAt = performance.now();

  document.documentElement.dataset.canvasVariant = variant;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const ease = value => 1 - Math.pow(1 - clamp(value), 3);
  const sceneName = index => String(index + 1).padStart(2, '0');
  const frameName = index => String(index + 1).padStart(3, '0');
  const currentProfile = () => QUALITY_PROFILES[variant][activeQuality];
  const frameCount = () => currentProfile().frames;
  const frameUrl = (scene, frame, profile = currentProfile()) => `assets/frames/${profile.path}/${sceneName(scene)}/frame-${frameName(frame)}.webp`;

  function automaticQuality() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const slowNetwork = connection?.saveData || /(^|-)2g$|3g/.test(connection?.effectiveType || "");
    if (variant === "mobile") {
      const displayWidth = innerWidth * Math.max(1, devicePixelRatio || 1);
      return !slowNetwork && displayWidth >= 780 ? "1080" : "720";
    }
    if (slowNetwork || innerWidth <= 1180) return "720";
    const displayWidth = innerWidth * Math.max(1, devicePixelRatio || 1);
    return displayWidth >= 1800 ? "full" : "1080";
  }

  function resolveQuality(mode) {
    const profiles = QUALITY_PROFILES[variant];
    if (mode === 'auto') return automaticQuality();
    return profiles[mode] ? mode : automaticQuality();
  }

  function resetFrameCache() {
    cacheEpoch += 1;
    images = Array.from({ length: SCENE_COUNT }, () => Array(frameCount()));
    pending = new Map();
    warmedScenes = new Set();
    lastDrawKey = '';
  }

  function updateQualityUI() {
    const profiles = QUALITY_PROFILES[variant];
    const profile = currentProfile();
    qualityButtons.forEach(button => {
      const mode = button.dataset.qualityOption;
      const unavailable = mode !== 'auto' && !profiles[mode];
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
      button.setAttribute('aria-pressed', selectedQuality === mode ? 'true' : 'false');
      button.classList.toggle('is-active', selectedQuality === mode);
    });
    if (qualityLabel) qualityLabel.textContent = selectedQuality === 'auto' ? 'Auto' : variant === 'mobile' && activeQuality === '1080' ? 'HQ' : profile.label.replace(' vertical', '');
    const qualitySummary = qualityControl?.querySelector('summary');
    if (qualitySummary) {
      qualitySummary.setAttribute('aria-label', `Selecionar qualidade da experiência. Atual: ${selectedQuality === 'auto' ? `Automático · ${profile.label}` : profile.label}`);
    }
    if (qualityNote) {
      qualityNote.textContent = variant === 'mobile'
        ? activeQuality === '1080'
          ? 'Mobile HQ aprimorado · 1080×1920, compressão premium e carregamento sob demanda.'
          : 'Mobile 720p nativo · mais leve. O modo 1080p HQ aprimorado pode ser selecionado manualmente.'
        : activeQuality === 'full'
          ? 'Full HQ+ · 1080p nativo, compressão premium e 80 quadros por ato.'
          : `${profile.label} · ${profile.frames} quadros por ato.`;
    }
    document.documentElement.dataset.qualityMode = selectedQuality;
    document.documentElement.dataset.qualityActive = activeQuality;
  }

  async function setQuality(mode, { persist = true } = {}) {
    selectedQuality = ['auto', '720', '1080', 'full'].includes(mode) ? mode : 'auto';
    if (persist) {
      try { localStorage.setItem('yuri-manifesto-quality', selectedQuality); } catch (_) {}
    }
    const nextQuality = resolveQuality(selectedQuality);
    if (nextQuality === activeQuality && images.length) {
      updateQualityUI();
      return;
    }

    activeQuality = nextQuality;
    resetFrameCache();
    resizeCanvas();
    updateQualityUI();
    qualityControl?.classList.add('is-switching');

    const scaled = clamp(smoothProgress) * SCENE_COUNT;
    const scene = Math.min(SCENE_COUNT - 1, Math.floor(scaled));
    const local = scene === SCENE_COUNT - 1 && scaled >= SCENE_COUNT ? 1 : clamp(scaled - scene);
    const frame = Math.min(frameCount() - 1, Math.round(local * (frameCount() - 1)));
    await loadFrame(scene, frame);
    drawFrame(scene, frame);
    warmAround(scene);
    qualityControl?.classList.remove('is-switching');
  }

  activeQuality = resolveQuality(selectedQuality);
  resetFrameCache();

  function loadFrame(scene, frame) {
    if (images[scene]?.[frame]) return Promise.resolve(images[scene][frame]);
    const key = `${activeQuality}:${scene}:${frame}`;
    if (pending.has(key)) return pending.get(key);

    const requestEpoch = cacheEpoch;
    const requestImages = images;
    const requestPending = pending;
    const requestProfile = currentProfile();

    const request = new Promise(resolve => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (requestEpoch === cacheEpoch && requestImages === images) requestImages[scene][frame] = image;
        requestPending.delete(key);
        resolve(image);
      };
      image.onerror = () => {
        requestPending.delete(key);
        const errorKey = `${requestProfile.path}:${scene}`;
        if (!frameErrors.has(errorKey)) {
          frameErrors.add(errorKey);
          track('media_error', {
            media_type: 'cinema_frame',
            chapter: scene + 1,
            quality: activeQuality,
            variant
          });
        }
        resolve(null);
      };
      image.src = frameUrl(scene, frame, requestProfile);
    });
    pending.set(key, request);
    return request;
  }

  async function warmScene(scene) {
    if (scene < 0 || scene >= SCENE_COUNT || warmedScenes.has(scene)) return;
    const epoch = cacheEpoch;
    warmedScenes.add(scene);
    for (let start = 0; start < frameCount(); start += 6) {
      if (epoch !== cacheEpoch) return;
      const chunk = [];
      for (let frame = start; frame < Math.min(frameCount(), start + 6); frame += 1) {
        chunk.push(loadFrame(scene, frame));
      }
      await Promise.all(chunk);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  function warmAround(scene) {
    [scene, scene + 1, scene - 1].forEach(index => {
      if (index >= 0 && index < SCENE_COUNT) warmScene(index);
    });
  }

  function warmAll() {
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let pointer = 0;
    const next = async () => {
      if (pointer >= order.length) return;
      await warmScene(order[pointer]);
      pointer += 1;
      if ('requestIdleCallback' in window) requestIdleCallback(next, { timeout: 1200 });
      else setTimeout(next, 90);
    };
    next();
  }

  function resizeCanvas() {
    const { width: sourceWidth, height: sourceHeight } = currentProfile();
    const sourceRatio = Math.min(sourceWidth / innerWidth, sourceHeight / innerHeight);
    const ratio = Math.max(.5, Math.min(devicePixelRatio || 1, sourceRatio));
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      lastDrawKey = '';
    }
  }

  function nearestFrame(scene, frame) {
    if (images[scene][frame]) return images[scene][frame];
    for (let distance = 1; distance < frameCount(); distance += 1) {
      if (frame - distance >= 0 && images[scene][frame - distance]) return images[scene][frame - distance];
      if (frame + distance < frameCount() && images[scene][frame + distance]) return images[scene][frame + distance];
    }
    return images[scene][0] || images[0][0] || null;
  }

  function drawImageCover(image) {
    if (!image) return;
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    context.fillStyle = '#06080d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, width, height);
  }

  function drawFrame(scene, frame) {
    const key = `${activeQuality}:${scene}:${frame}:${canvas.width}x${canvas.height}`;
    if (key === lastDrawKey) return;
    const image = nearestFrame(scene, frame);
    if (image) {
      drawImageCover(image);
      lastDrawKey = key;
    }
    if (!images[scene][frame]) {
      loadFrame(scene, frame).then(loaded => {
        if (loaded) lastDrawKey = '';
      });
    }
    canvas.dataset.scene = String(scene + 1);
    canvas.dataset.frame = String(frame + 1);
    canvas.dataset.quality = activeQuality;
  }

  function copyOpacity(scene, local) {
    const enter = scene === 0 && smoothProgress < .02 ? 1 : ease(local / .1);
    const exit = 1 - ease((local - .78) / .16);
    return clamp(Math.min(enter, exit));
  }

  function render() {
    const scaled = clamp(smoothProgress) * SCENE_COUNT;
    const scene = Math.min(SCENE_COUNT - 1, Math.floor(scaled));
    const local = scene === SCENE_COUNT - 1 && scaled >= SCENE_COUNT ? 1 : clamp(scaled - scene);
    const frame = Math.min(frameCount() - 1, Math.round(local * (frameCount() - 1)));

    if (scene !== activeScene) {
      activeScene = scene;
      warmAround(scene);
      visitedChapters.add(scene + 1);
      track('chapter_view', {
        chapter: scene + 1,
        chapter_label: chapters[scene]?.getAttribute('aria-label') || `Capítulo ${scene + 1}`,
        entry_source: chapterEntrySource,
        quality: activeQuality,
        variant
      });
      chapterEntrySource = 'scroll';
    }

    drawFrame(scene, frame);

    copies.forEach((copy, index) => {
      const opacity = index === scene ? copyOpacity(scene, local) : 0;
      copy.style.opacity = opacity.toFixed(3);
      copy.style.transform = `translate3d(0, ${(1 - opacity) * 28}px, 0)`;
      copy.classList.toggle('is-active', opacity > .02);
    });

    if (projectReel) {
      const opacity = scene === 7 ? copyOpacity(scene, local) : 0;
      projectReel.style.opacity = (opacity * (variant === 'mobile' ? .7 : .8)).toFixed(3);
      projectReel.style.transform = `translate3d(${(1 - opacity) * 20}px, ${(1 - opacity) * 14}px, 0)`;
      projectReel.classList.toggle('is-active', opacity > .02);
    }

    if (finalAgentRoster) {
      const rosterOpacity = scene === 6
        ? ease((local - .06) / .14) * ease((.98 - local) / .12)
        : 0;
      const agentPosition = clamp((local - .1) / .72) * (finalAgents.length - 1);
      const activeAgent = Math.min(finalAgents.length - 1, Math.round(agentPosition));
      finalAgentRoster.style.opacity = rosterOpacity.toFixed(3);
      finalAgentRoster.style.transform = `translate3d(${(1 - rosterOpacity) * -18}px, 0, 0)`;
      finalAgentRoster.classList.toggle('is-active', rosterOpacity > .02);
      if (finalAgentIndex) finalAgentIndex.textContent = String(activeAgent + 1).padStart(2, '0');
      finalAgents.forEach((agent, index) => {
        const reveal = scene === 6 ? clamp(1 - Math.abs(index - agentPosition)) * rosterOpacity : 0;
        agent.style.opacity = reveal.toFixed(3);
        agent.style.transform = `translate3d(${(1 - reveal) * -12}px, 0, 0)`;
      });
    }

    chapters.forEach((button, index) => {
      button.classList.toggle('is-active', index === scene);
      button.setAttribute('aria-current', index === scene ? 'step' : 'false');
    });

    if (sceneNumber) sceneNumber.textContent = String(scene + 1).padStart(2, '0');
    if (sceneProgress) sceneProgress.style.width = `${local * 100}%`;
    if (journeyProgress) journeyProgress.style.height = `${smoothProgress * 100}%`;
    if (cue) cue.style.opacity = smoothProgress < .025 ? '1' : '0';
    document.documentElement.dataset.activeScene = String(scene + 1);
  }

  function tick() {
    smoothProgress += (targetProgress - smoothProgress) * (reducedMotion ? 1 : .16);
    if (Math.abs(targetProgress - smoothProgress) < .00006) smoothProgress = targetProgress;
    render();
    raf = requestAnimationFrame(tick);
  }

  function updateProgress() {
    const start = film.offsetTop;
    const travel = Math.max(1, film.offsetHeight - innerHeight);
    targetProgress = clamp((scrollY - start) / travel);
    maxProgress = Math.max(maxProgress, targetProgress);
    [25, 50, 75, 100].forEach(milestone => {
      if (targetProgress * 100 < milestone || milestones.has(milestone)) return;
      milestones.add(milestone);
      track('progress_milestone', { percent: milestone, variant, quality: activeQuality });
      if (milestone === 100) {
        track('manifesto_complete', {
          chapters_seen: visitedChapters.size,
          elapsed_seconds: Math.round((performance.now() - sessionStartedAt) / 1000)
        });
      }
    });
    header?.classList.toggle('is-light', scrollY > start + travel + 12);
  }

  function goToChapter(index, source = 'timeline') {
    chapterEntrySource = source;
    track('chapter_jump', {
      chapter: index + 1,
      source,
      from_chapter: activeScene + 1
    });
    const start = film.offsetTop;
    const travel = Math.max(1, film.offsetHeight - innerHeight);
    const progress = index / SCENE_COUNT + .006;
    scrollTo({ top: start + travel * progress, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  async function start() {
    resizeCanvas();
    updateQualityUI();
    loaderLabel.textContent = `Carregando o primeiro ato · ${currentProfile().label}`;
    await loadFrame(0, 0);
    loaderBar.style.width = '42%';
    drawFrame(0, 0);

    const essentials = [];
    for (let frame = 1; frame < 12; frame += 1) essentials.push(loadFrame(0, frame));
    for (let scene = 1; scene < SCENE_COUNT; scene += 1) essentials.push(loadFrame(scene, 0));
    await Promise.all(essentials);

    loaderBar.style.width = '100%';
    loaderLabel.textContent = 'Pronto';
    setTimeout(() => {
      loader.classList.add('is-done');
      document.body.classList.remove('is-loading');
      track('manifesto_loaded', {
        load_ms: Math.round(performance.now()),
        quality: activeQuality,
        variant,
        reduced_motion: reducedMotion
      });
    }, 180);

    updateProgress();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    warmAll();
  }

  if (hicVideo) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (reducedMotion) {
          hicVideo.hidden = true;
          hicVideo.pause();
        } else if (entry.isIntersecting && entry.intersectionRatio >= .18) {
          hicVideo.hidden = false;
          hicVideo.play().catch(() => {});
        } else {
          hicVideo.pause();
        }
      });
    }, { threshold: [0, .18, .6] });
    observer.observe(hicVideo);
  }

  addEventListener('scroll', updateProgress, { passive: true });
  addEventListener('resize', () => {
    if ((mobileQuery.matches ? 'mobile' : 'desktop') !== variant) {
      location.reload();
      return;
    }
    const autoProfile = selectedQuality === 'auto' ? resolveQuality('auto') : activeQuality;
    if (autoProfile !== activeQuality) setQuality('auto', { persist: false });
    else resizeCanvas();
    updateProgress();
  }, { passive: true });

  qualityButtons.forEach(button => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const previousQuality = activeQuality;
      await setQuality(button.dataset.qualityOption);
      track('quality_changed', {
        selected: button.dataset.qualityOption,
        previous: previousQuality,
        active: activeQuality,
        variant
      });
      if (qualityControl?.open) qualityControl.open = false;
    });
  });

  chapters.forEach(button => button.addEventListener('click', () => goToChapter(Number(button.dataset.chapter), 'timeline')));
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      track('navigation_click', {
        target: link.getAttribute('href').slice(1),
        placement: link.closest('.closing-actions') ? 'closing' : link.closest('header') ? 'header' : 'content'
      });
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  });
  document.querySelectorAll('[data-conversion]').forEach(link => {
    link.addEventListener('click', () => {
      track('contact_click', {
        destination: link.dataset.conversion,
        placement: link.closest('.closing-actions') ? 'closing' : 'content'
      });
    });
  });

  const sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || entry.intersectionRatio < .35 || viewedSections.has(entry.target.id)) return;
      viewedSections.add(entry.target.id);
      track('section_view', { section: entry.target.id });
    });
  }, { threshold: [.35] });
  document.querySelectorAll('#trajetoria, #hic, #panteao, #projetos, #contato').forEach(section => sectionObserver.observe(section));

  addEventListener('pagehide', () => {
    track('session_summary', {
      elapsed_seconds: Math.round((performance.now() - sessionStartedAt) / 1000),
      max_progress_percent: Math.round(maxProgress * 100),
      chapters_seen: visitedChapters.size,
      sections_seen: viewedSections.size,
      quality: activeQuality,
      variant
    });
  }, { once: true });

  start();
})();
