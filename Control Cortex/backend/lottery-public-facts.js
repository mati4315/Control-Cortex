'use strict';

function normalizeDisplayName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function summarizeLotteryOverlay(snapshot, participantName = '', participantIdentity = {}) {
  const requestedName = normalizeDisplayName(participantName);
  const requesterKey = String(participantIdentity.requesterKey || '').trim().toLowerCase();
  const facebookUserId = String(participantIdentity.facebookUserId || '').trim().toLowerCase();
  const userId = String(participantIdentity.userId || '').trim().toLowerCase();
  const rawLotteries = Array.isArray(snapshot?.lotteries) ? snapshot.lotteries : [];
  const lotteries = rawLotteries.slice(0, 12).map(lottery => {
    const maxNumber = Math.max(0, Math.min(10000, Math.floor(Number(lottery?.maxNumber) || 0)));
    const entries = (Array.isArray(lottery?.entries) ? lottery.entries : []).filter(entry => {
      const number = Number(entry?.number);
      return Number.isInteger(number) && number >= 1 && (!maxNumber || number <= maxNumber);
    });
    const selectedNumbers = [...new Set(entries.map(entry => Number(entry.number)))].sort((a, b) => a - b);
    const participantKeys = new Set(entries.map(entry => {
      const name = normalizeDisplayName(entry.name);
      if (!name) return '';
      const avatar = String(entry.avatarUrl || '').split('?')[0].trim();
      return avatar ? `${name}|${avatar}` : name;
    }).filter(Boolean));
    const hasStableIdentityFields = entries.some(entry =>
      (requesterKey && (entry.requesterKey || entry.requester_key))
      || (facebookUserId && (entry.facebookUserId || entry.facebook_user_id))
      || (userId && (entry.userId || entry.user_id || entry.uid))
    );
    const identityEntries = hasStableIdentityFields ? entries.filter(entry => {
      const entryRequesterKey = String(entry.requesterKey || entry.requester_key || '').trim().toLowerCase();
      const entryFacebookId = String(entry.facebookUserId || entry.facebook_user_id || '').trim().toLowerCase();
      const entryUserId = String(entry.userId || entry.user_id || entry.uid || '').trim().toLowerCase();
      return (requesterKey && entryRequesterKey === requesterKey)
        || (facebookUserId && entryFacebookId === facebookUserId)
        || (userId && entryUserId === userId);
    }) : [];
    const matchedByStableIdentity = identityEntries.length > 0 || hasStableIdentityFields;
    const matchingEntries = matchedByStableIdentity
      ? identityEntries
      : requestedName ? entries.filter(entry => normalizeDisplayName(entry.name) === requestedName) : [];
    const avatarKeys = new Set(matchingEntries.map(entry => String(entry.avatarUrl || '').split('?')[0].trim()).filter(Boolean));
    const hasMissingAvatar = matchingEntries.some(entry => !String(entry.avatarUrl || '').trim());
    const identityAmbiguous = !matchedByStableIdentity && matchingEntries.length > 1 && (avatarKeys.size > 1 || (avatarKeys.size > 0 && hasMissingAvatar) || (avatarKeys.size === 0));
    const identityMatched = matchingEntries.length > 0 && !identityAmbiguous;
    const ownNumbers = identityMatched ? [...new Set(matchingEntries.map(entry => Number(entry.number)))].sort((a, b) => a - b) : [];
    return {
      name: String(lottery?.name || 'Lotería').slice(0, 100),
      prize: String(lottery?.prize || '').slice(0, 160),
      maxNumber,
      participantCount: participantKeys.size,
      selectedCount: selectedNumbers.length,
      availableCount: maxNumber ? Math.max(0, maxNumber - selectedNumbers.length) : 0,
      selectedNumbers,
      identityMatched,
      identityAmbiguous,
      ownNumbers
    };
  });
  return {
    available: snapshot?.ok === true,
    moduleEnabled: snapshot?.moduleEnabled === true,
    capturedAt: Number(snapshot?.generatedAt) || Date.now(),
    identityMatchMode: requesterKey || facebookUserId || userId
      ? 'ID estable de participante si la grilla expone ese dato; coincidencia exacta de nombre como respaldo'
      : requestedName ? 'coincidencia exacta por nombre visible' : 'sin identidad de participante seleccionada',
    lotteries
  };
}

module.exports = { normalizeDisplayName, summarizeLotteryOverlay };
