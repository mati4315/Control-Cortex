'use strict';

(() => {
  const seen = new Set();
  const sentAvatarState = new Map();
  let enabled = false;
  let captureFacebook = false;
  let wasActive = false;
  let baseline = true;
  let lastViewerCount = null;
  let lastViewerSentAt = 0;
  let scanTimer = null;
  let baselineTimer = null;
  let lastHref = location.href;
  let accountLabel = '';
  let instanceId = '';
  let lastReportAt = 0;
  let lastInsightsAt = 0;
  const metrics = {
    visibleCommentRows: 0,
    recognizedComments: 0,
    commentsDetected: 0,
    commentsSent: 0,
    commentsFailed: 0,
    lastScanAt: 0,
    lastCommentDetectedAt: 0,
    lastCommentSentAt: 0,
    lastSendState: 'unknown',
    lastError: ''
  };
  const ACTIONS = /^(?:me gusta|like|responder|reply|compartir|share|ver traducción|see translation|más relevantes|most relevant|editar|edit|ocultar|hide|enviar|send)$/i;
  const TRANSIENT_COMMENT_STATUS = /^(?:(?:publicando|posting|sending(?:\s+comment)?|enviando(?:\s+comentario)?|publishing|uploading|comentando)|(?:tu comentario se está publicando|your comment is being posted))(?:\s*(?:\.{2,}|…+))?$/i;

  function isVideoContext() {
    const path = location.pathname.toLowerCase();
    const query = new URLSearchParams(location.search);
    return /\/(?:videos?|watch|live)(?:\/|$)/.test(path) || /\/video\.php$/.test(path) || query.has('v') || query.has('video_id');
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }

  function cleanText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeCommentText(value) {
    let text = String(value || '').replace(/\u00a0/g, ' ');
    for (let pass = 0; pass < 3; pass++) {
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      const images = [...parsed.body.querySelectorAll('img')];
      const containsMarkup = /<\/?[a-z][^>]*>/i.test(text);
      if (!images.length && !containsMarkup) {
        const decoded = parsed.body.textContent || text;
        if (decoded !== text && /(?:<img\b|&lt;\s*img\b)/i.test(decoded)) {
          text = decoded;
          continue;
        }
        return cleanText(decoded);
      }
      for (const image of images) {
        const label = image.getAttribute('alt') || image.getAttribute('aria-label') || image.getAttribute('title') || '';
        image.replaceWith(parsed.createTextNode(label));
      }
      text = parsed.body.textContent || '';
    }
    return cleanText(text.replace(/<\/?[a-z][^>]*>/gi, ' '));
  }

  function stableHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function currentStreamId() {
    return FacebookStats.streamId(location.href);
  }

  function isInsightsPage() {
    return FacebookStats.isStatsPage(location.href);
  }

  function isProducerCommentsPage() {
    return /\/live\/producer\/dashboard\/\d+\/comments(?:\/|$)/i.test(location.pathname);
  }

  function sendInsights() {
    if (Date.now() - lastInsightsAt < 5000) return;
    const streamId = currentStreamId();
    if (!streamId) return;
    lastInsightsAt = Date.now();
    const values = FacebookStats.parse(document.body?.innerText || '');
    if (!Object.keys(values).length) return;
    chrome.runtime.sendMessage({ type: 'facebook-insights', payload: { streamId, metrics: values } }, response => {
      if (chrome.runtime.lastError || !response?.ok) {
        metrics.lastError = chrome.runtime.lastError?.message || response?.error || 'No se pudieron enviar las estadísticas.';
      }
    });
  }

  function reportCaptureStatus(force = false) {
    if (!instanceId) return;
    const now = Date.now();
    if (!force && now - lastReportAt < 4500) return;
    lastReportAt = now;
    const payload = {
      active: enabled && captureFacebook,
      visible: document.visibilityState === 'visible',
      videoContext: isVideoContext(),
      streamId: currentStreamId(),
      pageUrl: location.href,
      accountLabel,
      ...metrics
    };
    chrome.runtime.sendMessage({ type: 'capture-status', payload }, response => {
      if (chrome.runtime.lastError) {
        metrics.lastError = chrome.runtime.lastError.message;
        metrics.lastSendState = 'error';
      } else if (response && !response.ok) {
        metrics.lastError = response.error || 'No se pudo informar el estado de captura.';
        metrics.lastSendState = 'error';
      }
    });
  }

  function findAuthor(article, producerComments = false) {
    const anchors = [...article.querySelectorAll('a[href]')];
    const candidates = anchors.map(anchor => ({
      anchor,
      name: cleanText(anchor.innerText || anchor.getAttribute('aria-label')),
      href: anchor.href
    })).filter(item => {
      if (!item.name || item.name.length > 100 || ACTIONS.test(item.name)) return false;
      try {
        const url = new URL(item.href);
        if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false;
        return /profile\.php|\/[^/?#]+\/?(?:\?.*)?$/.test(url.pathname + url.search);
      } catch (_) { return false; }
    });
    const linkedAuthor = candidates.find(item => item.anchor.querySelector('img') || /profile\.php|\/people\//i.test(item.href)) || candidates[0];
    if (linkedAuthor || !producerComments) return linkedAuthor || null;

    const label = cleanText(article.getAttribute('aria-label') || '');
    const labeledName = label.match(/^(?:comment|comentario)(?:\s+(?:from|by|de|por))\s+(.+)$/i)?.[1];
    if (labeledName && labeledName.length <= 100 && !ACTIONS.test(labeledName)) {
      return { anchor: article, name: labeledName, href: '' };
    }
    const nameNode = [...article.querySelectorAll('[dir="auto"]')].find(node => {
      if (!visible(node)) return false;
      const name = cleanText(node.innerText || node.textContent);
      return name && name.length <= 100 && !ACTIONS.test(name)
        && !TRANSIENT_COMMENT_STATUS.test(name)
        && !/^(?:\d+\s*(?:min|hr|h|d|w|sem|día|dias|days|weeks?)|\d{1,2}:\d{2})$/i.test(name);
    });
    const name = cleanText(nameNode?.innerText || nameNode?.textContent);
    return name ? { anchor: article, name, href: '' } : null;
  }

  function profileKey(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
      const id = url.searchParams.get('id');
      return id ? `id:${id}` : `path:${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch (_) { return ''; }
  }

  function absoluteImageUrl(rawUrl) {
    const text = String(rawUrl || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }

  function isProfileImageUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const host = url.hostname.toLowerCase();
      const isFacebookImageHost = host.endsWith('.fbcdn.net') || host === 'fbcdn.net'
        || host.endsWith('.fbsbx.com') || host === 'fbsbx.com';
      if (!isFacebookImageHost || host.startsWith('static.')) return false;
      return !/\/(?:rsrc\.php|images\/emoji\.php|emg1|emoji)(?:\/|$)/i.test(url.pathname);
    } catch (_) { return false; }
  }

  function imageUrlFromNode(node) {
    if (node.matches?.('img')) {
      const candidates = [node.currentSrc, node.src, node.getAttribute('src'), node.getAttribute('data-src')];
      const srcset = node.getAttribute('srcset') || node.getAttribute('data-srcset') || '';
      if (srcset) candidates.push(...srcset.split(',').map(item => item.trim().split(/\s+/)[0]).reverse());
      for (const candidate of candidates) {
        const url = absoluteImageUrl(candidate);
        if (url && isProfileImageUrl(url)) return url;
      }
    }
    if (node.matches?.('image')) {
      const url = absoluteImageUrl(node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
      if (url && isProfileImageUrl(url)) return url;
    }
    try {
      const background = getComputedStyle(node).backgroundImage;
      for (const match of String(background || '').matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
        const url = absoluteImageUrl(match[2]);
        if (url && isProfileImageUrl(url)) return url;
      }
    } catch (_) { /* Algunos nodos SVG no admiten estilos computados. */ }
    return '';
  }

  function findAvatar(article, author) {
    const key = profileKey(author.href);
    const authorLinks = [...article.querySelectorAll('a[href]')]
      .filter(anchor => key && profileKey(anchor.href) === key);
    if (!authorLinks.includes(author.anchor)) authorLinks.unshift(author.anchor);

    // Facebook puede separar el enlace del nombre y el de la foto aunque ambos
    // apunten al mismo perfil; también puede pintar la foto como background.
    for (const link of authorLinks) {
      const nodes = [link, ...link.querySelectorAll('*')].slice(0, 80);
      for (const node of nodes) {
        const url = imageUrlFromNode(node);
        if (url) return url;
      }
    }

    // En el DOM actual de Facebook la foto suele ser un <image> SVG en el
    // primer bloque del comentario, separado del enlace que contiene el nombre.
    const leadingBlock = article.children?.[0];
    if (leadingBlock) {
      for (const node of [leadingBlock, ...leadingBlock.querySelectorAll('image, img, [style]')].slice(0, 100)) {
        const url = imageUrlFromNode(node);
        if (url) return url;
      }
    }

    const normalizedName = String(author.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const semanticNodes = article.querySelectorAll('img[alt], img[aria-label], [aria-label], [title], [style], image');
    for (const node of semanticNodes) {
      const label = String(node.getAttribute('alt') || node.getAttribute('aria-label') || node.getAttribute('title') || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!(normalizedName && label.includes(normalizedName)) && !/(profile picture|foto de perfil|imagen de perfil|avatar)/i.test(label)) continue;
      const url = imageUrlFromNode(node);
      if (url) return url;
    }
    return '';
  }

  function findMessage(article, authorName) {
    const nodes = [...article.querySelectorAll('[dir="auto"]')].filter(visible);
    // Lee el HTML del bloque: Facebook representa emojis como <img alt="😀">,
    // y innerText/textContent pueden omitirlos cuando el comentario solo tiene imágenes.
    const texts = nodes.map(node => ({ node, text: normalizeCommentText(node.innerHTML || node.innerText || node.textContent) }))
      .filter(item => item.text.length > 0 && item.text.length <= 3500)
      .filter(item => !ACTIONS.test(item.text) && item.text.toLowerCase() !== String(authorName || '').toLowerCase())
      .filter(item => !TRANSIENT_COMMENT_STATUS.test(item.text))
      .filter(item => !/^(?:\d+\s*(?:min|hr|h|d|w|sem|día|dias|days|weeks?)|\d{1,2}:\d{2})$/i.test(item.text));
    if (!texts.length) return '';
    // In comment rows, the author's label and actions are separate dir=auto nodes.
    // Choose the longest short text block, avoiding concatenated article text.
    texts.sort((a, b) => b.text.length - a.text.length);
    return texts[0].text;
  }

  function postedAt(article) {
    const nodes = article.querySelectorAll('[data-utime], time[datetime], abbr[title]');
    for (const node of nodes) {
      const epoch = Number(node.getAttribute('data-utime'));
      if (Number.isFinite(epoch) && epoch > 0) return epoch < 1e12 ? epoch * 1000 : epoch;
      const date = Date.parse(node.getAttribute('datetime') || '');
      if (Number.isFinite(date) && date > 0) return date;
    }
    return 0;
  }

  function sendViewerCount() {
    // Producer tiene varios contadores. Solo se leen etiquetas exactas en Insights.
    if (/\/live\/producer\//i.test(location.pathname)) return;
    const labels = [...document.querySelectorAll('[aria-label],[title]')].filter(visible).map(node => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`);
    const bodyText = document.body?.innerText?.slice(0, 18000) || '';
    const pageText = `${labels.join(' ')} ${bodyText}`;
    const countToken = '(?:(?:\\d{1,3}(?:[., \\t]\\d{3}){1,2})|(?:\\d{1,9}(?:[.,]\\d{1,2})?))(?:\\s*(?:k|mil|m))?';
    const boundedCount = `(?:^|[^\\d.,])(${countToken})(?![\\d.,])`;
    const viewerLabel = '(?:people\\s+watching|watching|viewers?|espectador(?:es)?|personas?\\s+(?:viendo|mirando)|viendo\\s+(?:el\\s+)?directo)';
    const labeledMatch = pageText.match(new RegExp(`${boundedCount}\\s*${viewerLabel}`, 'i'))
      || pageText.match(new RegExp(`${viewerLabel}[^\\d]{0,16}${boundedCount}`, 'i'));
    let countText = labeledMatch?.[1] || '';
    const parseCountText = value => {
      const raw = String(value || '').toLowerCase().replace(/\s+/g, '');
      const suffix = raw.match(/(k|mil|m)$/)?.[1] || '';
      let numberText = raw.replace(/(?:k|mil|m)$/, '');
      const separators = (numberText.match(/[.,]/g) || []).length;
      if (separators > 1 || /[.,]\d{3}$/.test(numberText)) numberText = numberText.replace(/[.,]/g, '');
      else numberText = numberText.replace(',', '.');
      let parsed = Number.parseFloat(numberText);
      if (!Number.isFinite(parsed)) return null;
      if (suffix === 'k' || suffix === 'mil') parsed *= 1000;
      else if (suffix === 'm') parsed *= 1000000;
      parsed = Math.max(0, Math.round(parsed));
      return parsed <= 100000000 ? parsed : null;
    };
    let count = parseCountText(countText);

    // Algunas versiones de Facebook muestran solo "VIVO 1" junto al icono del ojo,
    // sin la palabra "espectadores". Busca ese formato acotado en las líneas visibles.
    if (count === null) {
      const lines = bodyText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const inlineBadge = lines[i].match(/^(?:en\s+)?(?:vivo|live)\b[^\d]{0,24}(\d{1,7}(?:[.,]\d{1,3})?(?:\s*(?:k|mil|m))?)\s*$/i);
        if (inlineBadge) { countText = inlineBadge[1]; break; }
        if (/^(?:en\s+)?(?:vivo|live)$/i.test(lines[i])) {
          const nextLine = lines[i + 1]?.match(/^(\d[\d.,\s]*(?:\s*(?:k|mil|m))?)$/i);
          if (nextLine) { countText = nextLine[1]; break; }
        }
      }
      count = parseCountText(countText);
    }
    if (count === null) return;
    if (count === lastViewerCount && Date.now() - lastViewerSentAt < 30000) return;
    lastViewerCount = count;
    lastViewerSentAt = Date.now();
    chrome.runtime.sendMessage({ type: 'facebook-chat-event', payload: {
      id: `fb-viewers-${currentStreamId()}-${count}-${Math.floor(lastViewerSentAt / 30000)}`,
      mid: `fb-viewers-${currentStreamId()}-${count}-${Math.floor(lastViewerSentAt / 30000)}`,
      type: 'facebook', platform: 'facebook', event: 'viewer_update',
      meta: { facebook: count, streamId: currentStreamId(), pageUrl: location.href, captureMethod: 'dom' }, timestamp: lastViewerSentAt, textonly: true,
      chatname: '', chatmessage: '', userid: '', chatimg: '', chatbadges: []
    } }, () => {});
  }

  function extract(article, producerComments = false) {
    const aria = String(article.getAttribute('aria-label') || '').toLowerCase();
    const content = cleanText(article.innerText || article.textContent);
    // A Facebook post itself can also be role=article. Require comment-like reply
    // affordance or a comment label, and only inspect leaf articles in nested threads.
    const candidateRoles = producerComments ? '[role="article"], [role="listitem"], [role="row"]' : '[role="article"]';
    const hasNestedArticle = [...article.children].some(child => child.matches?.(candidateRoles) || child.querySelector?.(candidateRoles));
    if (hasNestedArticle) return null;
    const hasReplyAction = /\b(responder|reply|respuesta)\b/i.test(content);
    if (!producerComments && !/coment|comment/i.test(aria) && !hasReplyAction) return null;
    if (producerComments && !/coment|comment/i.test(aria) && !hasReplyAction && !article.matches('[role="article"]')) return null;
    const author = findAuthor(article, producerComments);
    if (!author) return null;
    const chatmessage = findMessage(article, author.name);
    if (!chatmessage || chatmessage.length > 3500) return null;
    const chatimg = findAvatar(article, author);
    const links = [...article.querySelectorAll('a[href]')].map(anchor => anchor.href);
    const commentUrl = links.find(href => /comment_id=|reply_comment_id=|\/comment\//i.test(href)) || '';
    const dataId = article.getAttribute('data-id') || article.id || '';
    const timestamp = postedAt(article);
    const query = new URLSearchParams(location.search);
    const videoId = currentStreamId();
    const streamKey = videoId || location.pathname;
    const key = producerComments
      ? `${streamKey}|${commentUrl}|${author.href}|${author.name}|${chatmessage}|${timestamp || ''}`
      : `${streamKey}|${dataId}|${commentUrl}|${author.href}|${author.name}|${chatmessage}|${timestamp || ''}`;
    let sourceId = '';
    try {
      const commentLink = new URL(commentUrl);
      sourceId = commentLink.searchParams.get('comment_id') || commentLink.searchParams.get('reply_comment_id') || '';
    } catch (_) {}
    if (!sourceId && /^[0-9_]{6,}$/.test(dataId)) sourceId = dataId;
    const id = sourceId || `fb-${stableHash(key)}`;
    let facebookUserId = author.href;
    try {
      const authorUrl = new URL(author.href);
      const profilePath = authorUrl.pathname.split('/').filter(Boolean);
      facebookUserId = authorUrl.searchParams.get('id') ||
        (profilePath[0]?.toLowerCase() === 'people' && profilePath.length >= 3 ? profilePath[2] : '') ||
        (profilePath[0]?.toLowerCase() === 'app_scoped_user_id' && profilePath[1] ? profilePath[1] : '') ||
        profilePath[0] || author.href;
    } catch (_) { facebookUserId = author.href ? author.href : `name:${stableHash(author.name)}`; }
    return {
      id,
      mid: id,
      type: 'facebook',
      platform: 'facebook',
      chatname: author.name,
      chatmessage,
      chatimg,
      contentimg: '',
      chatbadges: [],
      userid: facebookUserId.slice(0, 160),
      facebookUserId: facebookUserId.slice(0, 160),
      timestamp,
      textonly: true,
      meta: { messageId: id, commenterUrl: author.href, commentUrl, pageUrl: location.href, videoId, streamId: streamKey, captureMethod: 'dom', capturedAt: timestamp }
    };
  }

  const producerCommentRowSelector = '[role="article"], [role="listitem"], [role="row"]';

  function scan() {
    scanTimer = null;
    if (!enabled || !captureFacebook || !isVideoContext()) return;
    if (isInsightsPage()) {
      metrics.lastScanAt = Date.now();
      sendInsights();
      reportCaptureStatus();
      return;
    }
    const producerComments = isProducerCommentsPage();
    const rows = [...document.querySelectorAll(producerComments ? producerCommentRowSelector : '[role="article"]')].filter(visible);
    metrics.lastScanAt = Date.now();
    metrics.visibleCommentRows = rows.length;
    let recognizedComments = 0;
    for (const row of rows) {
      const message = extract(row, producerComments);
      if (!message) continue;
      recognizedComments += 1;
      if (seen.has(message.id)) {
        const state = sentAvatarState.get(message.id);
        // Facebook puede pintar la foto después del comentario. Actualizamos solo
        // la imagen para no volver a procesar el comentario ni disparar Spotify.
        if (state === 'baseline' && !message.chatimg) {
          sentAvatarState.set(message.id, 'baseline-checked-no-avatar');
          sendMessage(message, true);
        } else if (message.chatimg && (state === 'baseline' || state === 'baseline-checked-no-avatar' || state === 'sent-no-avatar')) {
          sentAvatarState.set(message.id, state.startsWith('baseline') ? 'baseline-avatar-sent' : 'sent-avatar');
          sendMessage(message, true);
        }
        continue;
      }
      metrics.lastCommentDetectedAt = Date.now();
      seen.add(message.id);
      if (seen.size > 2500) {
        const oldest = seen.values().next().value;
        seen.delete(oldest);
        sentAvatarState.delete(oldest);
      }
      if (baseline) {
        sentAvatarState.set(message.id, 'baseline');
        continue;
      }
      metrics.commentsDetected += 1;
      sentAvatarState.set(message.id, message.chatimg ? 'sent-avatar' : 'sent-no-avatar');
      sendMessage(message, false);
    }
    metrics.recognizedComments = recognizedComments;
    sendViewerCount();
    reportCaptureStatus();
  }

  function sendMessage(message, avatarUpdateOnly) {
    const payload = avatarUpdateOnly ? { ...message, avatarUpdateOnly: true } : message;
    chrome.runtime.sendMessage({ type: 'facebook-chat-event', payload }, response => {
      if (chrome.runtime.lastError) {
        metrics.commentsFailed += avatarUpdateOnly ? 0 : 1;
        metrics.lastError = chrome.runtime.lastError.message;
        metrics.lastSendState = 'error';
        reportCaptureStatus(true);
        return;
      }
      if (response && !response.ok) {
        metrics.commentsFailed += avatarUpdateOnly ? 0 : 1;
        metrics.lastError = response.error || 'El módulo rechazó el comentario.';
        metrics.lastSendState = 'error';
        console.debug('[Chat Bot Spotify] No se envió el comentario:', response.error);
      } else {
        if (!avatarUpdateOnly) {
          metrics.commentsSent += 1;
          metrics.lastCommentSentAt = Date.now();
        }
        metrics.lastError = '';
        metrics.lastSendState = response?.data?.duplicate ? 'duplicate' : 'sent';
      }
      reportCaptureStatus(true);
    });
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, 600);
  }

  function mutationTouchesComment(mutation, selector) {
    const target = mutation.target?.nodeType === Node.ELEMENT_NODE
      ? mutation.target
      : mutation.target?.parentElement;
    if (target?.closest?.(selector)) return true;
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches(selector) || node.querySelector(selector)) return true;
    }
    return false;
  }

  function updateConfig() {
    chrome.runtime.sendMessage({ type: 'get-capture-config' }, response => {
      if (chrome.runtime.lastError) return;
      enabled = response?.config?.enabled === true;
      captureFacebook = response?.config?.captureFacebook === true;
      accountLabel = String(response?.config?.accountLabel || 'Cuenta Facebook').slice(0, 100);
      instanceId = String(response?.config?.instanceId || '');
      const active = enabled && captureFacebook;
      if (active && !wasActive) {
        baseline = true;
        clearTimeout(baselineTimer);
        baselineTimer = setTimeout(() => { baseline = false; scheduleScan(); }, 1200);
      }
      wasActive = active;
      scheduleScan();
      reportCaptureStatus(true);
    });
  }

  const observer = new MutationObserver(mutations => {
    if (!enabled || !captureFacebook || !isVideoContext()) return;
    const selector = isProducerCommentsPage() ? producerCommentRowSelector : '[role="article"]';
    if (mutations.some(mutation => mutationTouchesComment(mutation, selector))) scheduleScan();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  chrome.storage.onChanged.addListener(updateConfig);
  updateConfig();
  // First snapshot establishes the baseline so a page refresh does not replay
  // all comments already visible in the live thread.
  baselineTimer = setTimeout(() => { baseline = false; scheduleScan(); }, 1800);
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      baseline = true;
      clearTimeout(baselineTimer);
      baselineTimer = setTimeout(() => { baseline = false; scheduleScan(); }, 1200);
      seen.clear();
      sentAvatarState.clear();
      metrics.visibleCommentRows = 0;
      metrics.recognizedComments = 0;
      metrics.commentsDetected = 0;
      metrics.commentsSent = 0;
      metrics.commentsFailed = 0;
      metrics.lastScanAt = 0;
      metrics.lastCommentDetectedAt = 0;
      metrics.lastCommentSentAt = 0;
      metrics.lastSendState = 'unknown';
      metrics.lastError = '';
      reportCaptureStatus(true);
    }
  }, 1500);
  // Facebook also changes unrelated page chrome frequently. Keep a slower full
  // reconciliation as a fallback in case a comment update escaped the observer.
  setInterval(scheduleScan, 5000);
  setInterval(() => reportCaptureStatus(true), 5000);
})();
