'use strict';

function isolatedPlaybackOptions() {
  return {
    skipCooldown: true,
    explicitTestPlayback: true,
    suppressLog: true,
    suppressReplyHistory: true,
    silent: true
  };
}

function isolatedSearchOptions(query) {
  return {
    analysis: true,
    forceQuery: query,
    allowAliasLearning: false,
    updateSelectionState: false,
    suppressLog: true,
    suppressReplyHistory: true,
    silent: true
  };
}

function isolatedCommentOptions({
  parseOnly = false,
  liveSimulation = false,
  simulationCommentId = '',
  simulationKey = '',
  timeScale = 1
} = {}) {
  const parsing = parseOnly === true;
  const live = liveSimulation === true;
  return {
    analysis: parsing,
    skipCooldown: !live,
    explicitTestPlayback: !parsing && !live,
    isolatedLiveSimulation: !parsing && live,
    simulationCommentId,
    simulationKey,
    timeScale,
    allowAliasLearning: !(live && parsing),
    updateSelectionState: !(live && parsing),
    suppressReplyHistory: true,
    suppressLog: true,
    silent: true
  };
}

module.exports = { isolatedSearchOptions, isolatedPlaybackOptions, isolatedCommentOptions };
