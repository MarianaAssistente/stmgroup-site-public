(() => {
  'use strict';

  const film = document.querySelector('[data-film]');
  const media = [...document.querySelectorAll('[data-scene-media]')];
  const videos = media.map(item => item.querySelector('video'));
  const copies = [...document.querySelectorAll('[data-scene-copy]')];
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const sceneNumber = document.querySelector('[data-scene-number]');
  const sceneProgress = document.querySelector('[data-scene-progress]');
  const journeyProgress = document.querySelector("[data-journey-progress]");
  const projectReel = document.querySelector("[data-project-reel]");
  const finalAgentRoster = document.querySelector('[data-final-agent-roster]');
  const finalAgents = [...document.querySelectorAll('[data-final-agent]')];
  const hicVideo = document.querySelector('[data-hic-video]');
  const loader = document.querySelector('[data-loader]');
  const loaderBar = document.querySelector('[data-loader-bar]');
  const loaderLabel = document.querySelector('[data-loader-label]');
  const header = document.querySelector('[data-header]');
  const cue = document.querySelector('.scroll-cue');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobileQuery = matchMedia('(max-width: 900px)');

  let targetProgress = 0;
  let smoothProgress = 0;
  let activeScene = 0;
  let lastSeekAt = 0;
  let raf = 0;
  let mobile = mobileQuery.matches;
  let activeMobileVideo = -1;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const ease = value => 1 - Math.pow(1 - clamp(value), 3);

  function sourceFor(video) {
    return mobile ? video.dataset.mobile : video.dataset.desktop;
  }

  function ensureSource(index) {
    const video = videos[index];
    if (!video || video.dataset.loaded === 'true') return Promise.resolve(video);
    return new Promise(resolve => {
      const done = () => {
        video.removeEventListener('loadedmetadata', done);
        video.removeEventListener('error', done);
        resolve(video);
      };
      video.addEventListener('loadedmetadata', done, { once: true });
      video.addEventListener('error', done, { once: true });
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      if (mobile) video.loop = true;
      video.src = sourceFor(video);
      video.dataset.loaded = 'true';
      video.load();
    });
  }

  function activateMobileVideo(index, restart = false) {
    if (!mobile || reducedMotion || index < 0 || index >= videos.length) return;
    videos.forEach((video, videoIndex) => {
      if (videoIndex !== index && !video.paused) video.pause();
    });
    ensureSource(index).then(video => {
      if (!video || activeScene !== index) return;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      if (restart && Number.isFinite(video.duration)) video.currentTime = 0;
      activeMobileVideo = index;
      video.play().then(() => {
        document.body.classList.add('mobile-motion-active');
      }).catch(() => {
        document.body.classList.add('mobile-motion-pending');
      });
    });
  }

  function unlockMobileVideo() {
    if (!mobile || reducedMotion) return;
    document.body.classList.remove('mobile-motion-pending');
    activateMobileVideo(activeScene, false);
  }

  function preloadAround(index) {
    [index, index + 1, index - 1].forEach(scene => {
      if (scene >= 0 && scene < videos.length) ensureSource(scene);
    });
  }

  function copyOpacity(scene, local) {
    const enter = scene === 0 && smoothProgress < .02 ? 1 : ease(local / .12);
    const exit = 1 - ease((local - .72) / .2);
    return clamp(Math.min(enter, exit));
  }

  function updateVideoTime(scene, local, now) {
    const video = videos[scene];
    if (!video || video.readyState < 1 || !Number.isFinite(video.duration)) return;
    if (reducedMotion) {
      if (Math.abs(video.currentTime - .2) > .1) video.currentTime = .2;
      return;
    }
    // Mobile Safari may remain frozen on the poster when only currentTime changes.
    // On phones, the active chapter plays natively while scrolling selects chapters.
    if (mobile) {
      if (video.paused && activeMobileVideo !== scene) activateMobileVideo(scene, false);
      return;
    }
    if (now - lastSeekAt < 70) return;
    const desired = clamp(local, 0, .98) * Math.max(.1, video.duration - .06);
    if (Math.abs(video.currentTime - desired) > .065) {
      video.currentTime = desired;
      lastSeekAt = now;
    }
  }

  function render(now = performance.now()) {
    const scaled = clamp(smoothProgress) * videos.length;
    const scene = Math.min(videos.length - 1, Math.floor(scaled));
    const local = scene === videos.length - 1 ? clamp(scaled - scene) : scaled - scene;
    const crossfade = ease((local - .86) / .14);

    if (scene !== activeScene) {
      activeScene = scene;
      preloadAround(scene);
      activateMobileVideo(scene, true);
    }

    media.forEach((item, index) => {
      let opacity = 0;
      if (index === scene) opacity = 1 - crossfade;
      if (index === scene + 1) opacity = crossfade;
      if (scene === videos.length - 1 && index === scene) opacity = 1;
      item.style.opacity = opacity.toFixed(3);
      item.classList.toggle('is-active', opacity > .01);
    });

    copies.forEach((copy, index) => {
      const opacity = index === scene ? copyOpacity(scene, local) : 0;
      copy.style.opacity = opacity.toFixed(3);
      copy.style.transform = `translate3d(0, ${(1 - opacity) * 34}px, 0)`;
      copy.classList.toggle('is-active', opacity > .01);
    });

    if (projectReel) {
      const reelOpacity = scene === 5 ? copyOpacity(scene, local) : 0;
      projectReel.style.opacity = (reelOpacity * (mobile ? .72 : .78)).toFixed(3);
      projectReel.style.transform = "translate3d(" + ((1 - reelOpacity) * 24) + "px, " + ((1 - reelOpacity) * 18) + "px, 0)";
      projectReel.classList.toggle("is-active", reelOpacity > .02);
    }
    if (finalAgentRoster) {
      const rosterOpacity = scene === 9 ? ease((local - .08) / .18) : 0;
      finalAgentRoster.style.opacity = rosterOpacity.toFixed(3);
      finalAgentRoster.style.transform = `translate3d(${(1 - rosterOpacity) * 24}px, 0, 0)`;
      finalAgentRoster.classList.toggle('is-active', rosterOpacity > .02);
      finalAgents.forEach((agent, index) => {
        const reveal = scene === 9 ? ease((local - (.16 + index * .045)) / .12) : 0;
        agent.style.opacity = reveal.toFixed(3);
        agent.style.transform = `translate3d(${(1 - reveal) * 16}px, 0, 0)`;
      });
    }

    chapters.forEach((button, index) => {
      button.classList.toggle('is-active', index === scene);
      button.setAttribute('aria-current', index === scene ? 'step' : 'false');
    });

    sceneNumber.textContent = String(scene + 1).padStart(2, '0');
    sceneProgress.style.width = `${local * 100}%`;
    journeyProgress.style.height = `${smoothProgress * 100}%`;
    cue.style.opacity = smoothProgress < .025 ? '1' : '0';
    updateVideoTime(scene, local, now);
  }

  function tick(now) {
    smoothProgress += (targetProgress - smoothProgress) * (reducedMotion ? 1 : .11);
    if (Math.abs(targetProgress - smoothProgress) < .00008) smoothProgress = targetProgress;
    render(now);
    raf = requestAnimationFrame(tick);
  }

  function updateProgress() {
    const start = film.offsetTop;
    const travel = Math.max(1, film.offsetHeight - innerHeight);
    targetProgress = clamp((scrollY - start) / travel);
    header.classList.toggle('is-light', scrollY > start + travel + 12);
  }

  function goToChapter(index) {
    const start = film.offsetTop;
    const travel = Math.max(1, film.offsetHeight - innerHeight);
    const progress = index / videos.length + .006;
    scrollTo({ top: start + travel * progress, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  async function start() {
    await ensureSource(0);
    loaderBar.style.width = '55%';
    loaderLabel.textContent = 'Preparando o movimento';
    await Promise.all([ensureSource(1), new Promise(resolve => setTimeout(resolve, 180))]);
    loaderBar.style.width = '100%';
    loaderLabel.textContent = 'Pronto';
    setTimeout(() => {
      loader.classList.add('is-done');
      document.body.classList.remove('is-loading');
    }, 240);

    // A cena atual e a seguinte são carregadas; as demais entram sob demanda durante a navegação.
    updateProgress();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    activateMobileVideo(0, true);
  }

  if (hicVideo) {
    if (reducedMotion) {
      hicVideo.hidden = true;
      hicVideo.pause();
    } else {
      const hicObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio >= .35) {
            hicVideo.play().catch(() => {});
          } else {
            hicVideo.pause();
          }
        });
      }, { threshold: [0, .35, .7] });
      hicObserver.observe(hicVideo);
    }
  }
  addEventListener('scroll', updateProgress, { passive: true });
  addEventListener('touchstart', unlockMobileVideo, { passive: true });
  addEventListener('pointerdown', unlockMobileVideo, { passive: true });
  addEventListener('resize', () => {
    const nextMobile = mobileQuery.matches;
    if (nextMobile !== mobile) location.reload();
    updateProgress();
  }, { passive: true });

  chapters.forEach(button => button.addEventListener('click', () => goToChapter(Number(button.dataset.chapter))));

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  });

  start();
})();
