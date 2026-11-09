'use strict';

function foldChatText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isCasualRuloComment(item, vocabulary = {}) {
  if (!item || item.testMode === true || item.isAlert === true || item.excludeFromProgramArchive === true || item.response) return false;
  const comment = String(item.comment || '').trim();
  const folded = foldChatText(comment);
  if (comment.length < 18 || comment.length > 350 || !folded || /^!/.test(comment)) return false;
  const hasMusicWord = (vocabulary.musicWords || []).map(foldChatText).filter(Boolean)
    .some(word => (` ${folded} `).includes(` ${word} `));
  const requestVerbs = (vocabulary.requestVerbs || []).map(foldChatText).filter(Boolean);
  const hasRequestVerb = requestVerbs.some(word => (` ${folded} `).includes(` ${word} `));
  const implicitTrackRequest = hasRequestVerb && /\b(?:la|el|un|una|algo|otro|otra)\s+de\b/.test(folded);
  const directMusicRequest = /\b(?:poneme|pasame|podes poner|podrias poner|quiero escuchar|me pones|me podes poner)\b/.test(folded);
  if ((hasMusicWord && hasRequestVerb) || implicitTrackRequest || directMusicRequest) return false;
  const greetingWords = ['hola', 'holis', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches', 'gracias', 'muchas gracias', 'saludos'];
  return !greetingWords.includes(folded);
}

function decideCasualRuloAttempt({
  item,
  state = {},
  now = Date.now(),
  random = Math.random,
  ruloEnabled = true,
  testMode = false,
  casualChatEnabled = true,
  aiEnabled = true,
  vocabulary = {}
} = {}) {
  if (!ruloEnabled) return { attempt: false, reason: 'rulo-disabled' };
  if (testMode || item?.testMode === true) return { attempt: false, reason: 'test-mode' };
  if (state.inFlight === true) return { attempt: false, reason: 'busy' };
  if (!isCasualRuloComment(item, vocabulary)) return { attempt: false, reason: 'not-candidate' };
  if (!casualChatEnabled) return { attempt: false, reason: 'casual-disabled' };
  if (!aiEnabled) return { attempt: false, reason: 'ai-disabled' };
  if (Number(now) - Number(state.lastCasualAiCheckAt || 0) < 180000) return { attempt: false, reason: 'casual-cooldown' };
  const lastRuloAt = Number(state.latestRuloMessageAt || 0);
  if (lastRuloAt && Number(now) - lastRuloAt < 120000) return { attempt: false, reason: 'recent-rulo-reply' };
  if (Number(random()) > 0.2) return { attempt: false, reason: 'random-gate' };
  return { attempt: true, reason: 'ai-check' };
}

module.exports = { foldChatText, isCasualRuloComment, decideCasualRuloAttempt };
