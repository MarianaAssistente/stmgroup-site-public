(() => {
  'use strict';

  const config = Object.freeze({
    mode: 'preview',
    build: 'manifesto-yuri-analytics-preview-20260827',
    consentVersion: '2026-08-27',
    cloudflareToken: '',
    posthogKey: '',
    posthogHost: 'https://us.i.posthog.com',
    replaySampleRate: 0,
    debug: false,
    ...(window.__MANIFESTO_ANALYTICS_CONFIG__ || {})
  });
  const STORAGE_KEY = `ym-analytics-consent-${config.consentVersion}`;
  const MAX_EVENTS = 200;
  const ALLOWED_EVENTS = new Set([
    'page_view',
    'manifesto_loaded',
    'chapter_view',
    'chapter_jump',
    'progress_milestone',
    'manifesto_complete',
    'section_view',
    'navigation_click',
    'contact_click',
    'quality_changed',
    'media_error',
    'session_summary',
    'consent_updated'
  ]);
  const events = [];
  let consent = readConsent();
  let posthogReady = false;

  function readConsent() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return stored?.choice === 'granted' || stored?.choice === 'denied' ? stored.choice : 'pending';
    } catch (_) {
      return 'pending';
    }
  }

  function cleanValue(value) {
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;
    return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  }

  function sanitize(properties = {}) {
    const safe = {};
    Object.entries(properties).slice(0, 24).forEach(([key, value]) => {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return;
      const cleaned = cleanValue(value);
      if (cleaned !== undefined) safe[key] = cleaned;
    });
    return safe;
  }

  function acquisitionContext() {
    const params = new URLSearchParams(location.search);
    const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    const context = {
      build: config.build,
      mode: config.mode,
      device: matchMedia('(max-width: 900px)').matches ? 'mobile' : 'desktop',
      language: (navigator.language || 'unknown').slice(0, 16),
      referrer_host: document.referrer ? new URL(document.referrer).hostname : 'direct'
    };
    allowed.forEach(key => {
      const value = params.get(key);
      if (value) context[key] = value.slice(0, 80);
    });
    return context;
  }

  function track(name, properties = {}) {
    if (!ALLOWED_EVENTS.has(name)) return false;
    const entry = {
      event: name,
      properties: sanitize({ ...acquisitionContext(), ...properties }),
      timestamp: new Date().toISOString()
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    dispatchEvent(new CustomEvent('manifesto:analytics-event', { detail: entry }));
    if (config.debug) console.info('[manifesto-analytics]', entry.event, entry.properties);
    if (consent === 'granted' && posthogReady && window.posthog?.capture) {
      window.posthog.capture(entry.event, entry.properties);
    }
    return true;
  }

  function loadCloudflare() {
    if (!config.cloudflareToken || document.querySelector('[data-cf-beacon]')) return;
    const script = document.createElement('script');
    script.defer = true;
    script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    script.dataset.cfBeacon = JSON.stringify({ token: config.cloudflareToken });
    script.referrerPolicy = 'no-referrer-when-downgrade';
    document.head.appendChild(script);
  }

  function posthogAssetHost() {
    return config.posthogHost.replace('.i.posthog.com', '-assets.i.posthog.com').replace(/\/$/, '');
  }

  function preparePostHogQueue() {
    const root = window.posthog || [];
    root._i = root._i || [];
    root.init = root.init || function init(key, options, name = 'posthog') {
      const client = name === 'posthog' ? root : (root[name] = []);
      const methods = [
        'capture', 'identify', 'reset', 'opt_in_capturing', 'opt_out_capturing',
        'startSessionRecording', 'stopSessionRecording', 'set_config'
      ];
      methods.forEach(method => {
        client[method] = client[method] || function queuedMethod(...args) {
          client.push([method, ...args]);
        };
      });
      root._i.push([key, options, name]);
    };
    window.posthog = root;
    return root;
  }

  function loadPostHog() {
    if (!config.posthogKey || consent !== 'granted' || posthogReady) return;
    const posthog = preparePostHogQueue();
    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      ui_host: 'https://us.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-private]'
      },
      loaded(client) {
        posthogReady = true;
        if (config.replaySampleRate > 0 && Math.random() <= config.replaySampleRate) {
          client.startSessionRecording?.();
        } else {
          client.stopSessionRecording?.();
        }
        client.capture('page_view', sanitize(acquisitionContext()));
      }
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `${posthogAssetHost()}/static/array.js`;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }

  function setConsent(choice) {
    consent = choice === 'granted' ? 'granted' : 'denied';
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        choice: consent,
        version: config.consentVersion,
        at: new Date().toISOString()
      }));
    } catch (_) {}
    if (consent === 'granted') loadPostHog();
    else {
      window.posthog?.stopSessionRecording?.();
      window.posthog?.opt_out_capturing?.();
    }
    track('consent_updated', { choice: consent });
    renderConsent();
  }

  function resetConsent() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    consent = 'pending';
    window.posthog?.stopSessionRecording?.();
    window.posthog?.opt_out_capturing?.();
    renderConsent(true);
  }

  function consentMarkup() {
    return `
      <aside class="analytics-consent" data-analytics-consent role="dialog" aria-modal="true" aria-labelledby="analytics-consent-title">
        <div>
          <p class="analytics-consent-kicker">PRIVACIDADE E MÉTRICAS</p>
          <h2 id="analytics-consent-title">Você escolhe o nível de medição.</h2>
          <p>Usamos métricas agregadas para contar acessos. Com sua permissão, também analisamos navegação e sessões anonimizadas para melhorar a experiência. Campos e conteúdo sensível são mascarados.</p>
          <a href="privacidade.html">Ver política de privacidade e métricas</a>
        </div>
        <div class="analytics-consent-actions">
          <button type="button" data-consent-choice="denied">Somente necessário</button>
          <button type="button" data-consent-choice="granted">Aceitar analytics</button>
        </div>
      </aside>`;
  }

  function renderConsent(forceOpen = false) {
    document.querySelector('[data-analytics-consent]')?.remove();
    if (consent !== 'pending' && !forceOpen) return;
    document.body.insertAdjacentHTML('beforeend', consentMarkup());
    document.querySelectorAll('[data-consent-choice]').forEach(button => {
      button.addEventListener('click', () => setConsent(button.dataset.consentChoice));
    });
    document.querySelector('[data-consent-choice="granted"]')?.focus({ preventScroll: true });
  }

  function init() {
    loadCloudflare();
    if (consent === 'granted') loadPostHog();
    renderConsent();
    document.querySelectorAll('[data-analytics-preferences]').forEach(button => {
      button.addEventListener('click', resetConsent);
    });
    if (config.mode === 'preview') document.documentElement.dataset.analyticsPreview = 'true';
    track('page_view', { consent });
    dispatchEvent(new CustomEvent('manifesto:analytics-ready'));
  }

  window.manifestoAnalytics = Object.freeze({
    track,
    setConsent,
    resetConsent,
    getState: () => Object.freeze({
      mode: config.mode,
      build: config.build,
      consent,
      posthogReady,
      cloudflareEnabled: Boolean(config.cloudflareToken),
      posthogEnabled: Boolean(config.posthogKey),
      eventCount: events.length
    }),
    getEvents: () => events.map(entry => ({ ...entry, properties: { ...entry.properties } }))
  });

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
