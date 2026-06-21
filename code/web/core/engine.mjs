import {
  PHASES,
  ROLE_IDS,
  SIDES,
  TARGET_TYPES,
  VIEWERS,
  actionCards,
  beginnerScript,
  getScript,
  hands,
  locations,
  roles,
} from "./data.mjs";

export class RulesError extends Error {
  constructor(message) {
    super(message);
    this.name = "RulesError";
  }
}

const STATUS = {
  ACTIVE: "active",
  LOOP_FAILED: "loop_failed",
  FINAL_GUESS: "final_guess",
  FINISHED: "finished",
};

const PHASE_LABELS = {
  [PHASES.MASTERMIND_ACTION]: "剧作家行动阶段",
  [PHASES.PROTAGONIST_ACTION]: "主人公行动阶段",
  [PHASES.MASTERMIND_ABILITY]: "剧作家能力阶段",
  [PHASES.PROTAGONIST_ABILITY]: "主人公能力阶段",
  [PHASES.INCIDENT]: "事件阶段",
  [PHASES.END_OF_DAY]: "回合结束阶段",
  [PHASES.LOOP_END]: "轮回结束",
  [PHASES.FINAL_GUESS]: "最终决战",
  [PHASES.FINISHED]: "游戏结束",
};

const SIDE_LABELS = {
  [SIDES.MASTERMIND]: "剧作家",
  [SIDES.PROTAGONIST]: "主人公",
};

function clone(value) {
  return structuredClone(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new RulesError(message);
  }
}

function scriptForState(state) {
  return getScript(state.scriptId);
}

function handEntry(side, cardId) {
  return hands[side].find((entry) => entry.cardId === cardId);
}

function targetKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

function characterName(state, characterId) {
  return state.board.characters[characterId]?.name ?? characterId;
}

function locationName(locationId) {
  return locations[locationId]?.name ?? locationId;
}

function targetName(state, targetType, targetId) {
  if (targetType === TARGET_TYPES.CHARACTER) {
    return characterName(state, targetId);
  }
  return locationName(targetId);
}

function roleOf(state, characterId) {
  return roles[state.board.characters[characterId].roleId];
}

function appendEvent(state, event) {
  state.eventSeq += 1;
  state.eventLog.push({
    id: state.eventSeq,
    loop: state.loop,
    day: state.day,
    phase: state.phase,
    visibility: "public",
    details: {},
    ...event,
  });
}

function buildInitialBoard(script) {
  const locationStates = Object.fromEntries(
    Object.values(locations).map((location) => [
      location.id,
      {
        id: location.id,
        intrigue: 0,
        flags: [],
      },
    ]),
  );

  const characterStates = Object.fromEntries(
    script.characters.map((character) => [
      character.id,
      {
        ...character,
        alive: true,
        locationId: character.initialLocationId,
        goodwill: 0,
        paranoia: 0,
        intrigue: 0,
        flags: [],
      },
    ]),
  );

  return {
    locations: locationStates,
    characters: characterStates,
  };
}

export function createGame(script = beginnerScript) {
  const state = {
    version: 1,
    scriptId: script.id,
    loop: 1,
    day: 1,
    phase: PHASES.MASTERMIND_ACTION,
    status: STATUS.ACTIVE,
    winner: null,
    protagonistsAlive: true,
    board: buildInitialBoard(script),
    placedActions: [],
    oncePerLoopUsed: {
      [SIDES.MASTERMIND]: [],
      [SIDES.PROTAGONIST]: [],
    },
    usedAbilitiesThisDay: [],
    knowledge: {
      revealedRoleCharacterIds: [],
    },
    pendingDecision: null,
    eventSeq: 0,
    eventLog: [],
  };

  appendEvent(state, {
    type: "game_started",
    message: `开始剧本《${script.name}》：${script.loops} 轮，每轮 ${script.daysPerLoop} 天。`,
  });
  appendEvent(state, {
    type: "closed_script_loaded",
    visibility: VIEWERS.MASTERMIND,
    message: `非公开信息已载入：${script.closedInfo.ruleY} / ${script.closedInfo.ruleX.join("、")}。`,
  });
  appendEvent(state, {
    type: "phase_changed",
    message: `进入${PHASE_LABELS[state.phase]}。`,
  });

  return state;
}

export function phaseLabel(phase) {
  return PHASE_LABELS[phase] ?? phase;
}

export function sideLabel(side) {
  return SIDE_LABELS[side] ?? side;
}

export function cardLabel(cardId, side = null) {
  const card = actionCards[cardId];
  if (!card) return cardId;
  return side && card.sideNames?.[side] ? card.sideNames[side] : card.name;
}

export function actionLimit(state, side) {
  const script = scriptForState(state);
  return script.actionSlots?.[side] ?? 3;
}

export function placedActionCount(state, side) {
  return state.placedActions.filter((action) => action.side === side).length;
}

function sideHasPlacedOnTarget(state, side, targetType, targetId) {
  return state.placedActions.some(
    (action) => action.side === side && action.targetType === targetType && action.targetId === targetId,
  );
}

export function listLegalTargets(state, side, cardId) {
  const card = actionCards[cardId];
  assert(card, `未知行动牌：${cardId}`);
  const targets = [];

  if (card.targetTypes.includes(TARGET_TYPES.CHARACTER)) {
    for (const character of Object.values(state.board.characters)) {
      if (!character.alive) continue;
      if (sideHasPlacedOnTarget(state, side, TARGET_TYPES.CHARACTER, character.id)) continue;
      targets.push({
        targetType: TARGET_TYPES.CHARACTER,
        targetId: character.id,
        name: character.name,
      });
    }
  }

  if (card.targetTypes.includes(TARGET_TYPES.LOCATION)) {
    for (const location of Object.values(locations)) {
      if (sideHasPlacedOnTarget(state, side, TARGET_TYPES.LOCATION, location.id)) continue;
      targets.push({
        targetType: TARGET_TYPES.LOCATION,
        targetId: location.id,
        name: location.name,
      });
    }
  }

  return targets;
}

export function listTargets(state, cardId) {
  const card = actionCards[cardId];
  assert(card, `未知行动牌：${cardId}`);
  const targets = [];

  if (card.targetTypes.includes(TARGET_TYPES.CHARACTER)) {
    for (const character of Object.values(state.board.characters)) {
      targets.push({
        targetType: TARGET_TYPES.CHARACTER,
        targetId: character.id,
        name: character.name,
      });
    }
  }

  if (card.targetTypes.includes(TARGET_TYPES.LOCATION)) {
    for (const location of Object.values(locations)) {
      targets.push({
        targetType: TARGET_TYPES.LOCATION,
        targetId: location.id,
        name: location.name,
      });
    }
  }

  return targets;
}

export function availableCards(state, side) {
  assert(hands[side], `未知阵营：${side}`);
  return hands[side].map((entry) => {
    const card = actionCards[entry.cardId];
    const placedCount = state.placedActions.filter(
      (action) => action.side === side && action.cardId === entry.cardId,
    ).length;
    const onceUsed = card.oncePerLoop && state.oncePerLoopUsed[side].includes(entry.cardId);
    return {
      ...entry,
      card,
      name: cardLabel(entry.cardId, side),
      remainingThisPhase: Math.max(0, entry.quantity - placedCount),
      disabled: Boolean(onceUsed),
      disabledReason: onceUsed ? "每轮限 1 次，本轮已使用" : "",
    };
  });
}

export function placeAction(state, placement) {
  const next = clone(state);
  assert(next.status === STATUS.ACTIVE, "当前游戏不在可行动状态。");
  assert(!next.pendingDecision, "当前有待处理选择，不能暗置行动牌。");

  const { side, cardId, targetType, targetId } = placement;
  const expectedPhase =
    side === SIDES.MASTERMIND ? PHASES.MASTERMIND_ACTION : PHASES.PROTAGONIST_ACTION;
  assert(next.phase === expectedPhase, `当前不是${sideLabel(side)}的行动阶段。`);

  const sideActions = next.placedActions.filter((action) => action.side === side);
  const limit = actionLimit(next, side);
  assert(sideActions.length < limit, `${sideLabel(side)}本阶段行动牌已经放满。`);

  const entry = handEntry(side, cardId);
  assert(entry, `${sideLabel(side)}没有行动牌：${cardId}`);

  const card = actionCards[cardId];
  assert(card.sideNames?.[side], `${sideLabel(side)}不能使用行动牌：${card.name}`);
  assert(card.targetTypes.includes(targetType), `${card.name}不能放置到该目标类型。`);

  if (targetType === TARGET_TYPES.CHARACTER) {
    const target = next.board.characters[targetId];
    assert(target, `未知角色：${targetId}`);
    assert(target.alive, `${target.name}已经死亡，不能放置行动牌。`);
  } else {
    assert(next.board.locations[targetId], `未知版图：${targetId}`);
  }

  const sameCardCount = sideActions.filter((action) => action.cardId === cardId).length;
  assert(sameCardCount < entry.quantity, `${cardLabel(cardId, side)}的可用数量不足。`);

  const duplicateTarget = sideActions.some(
    (action) => action.targetType === targetType && action.targetId === targetId,
  );
  assert(!duplicateTarget, "同一阵营不能在同一角色或版图上重复放置行动牌。");

  if (card.oncePerLoop) {
    assert(
      !next.oncePerLoopUsed[side].includes(cardId),
      `${cardLabel(cardId, side)}每轮限 1 次，本轮已经使用。`,
    );
  }

  assert(
    listLegalTargets(next, side, cardId).some(
      (target) => target.targetType === targetType && target.targetId === targetId,
    ),
    `${targetName(next, targetType, targetId)}不是当前可放置目标。`,
  );

  next.placedActions.push({
    id: `a${next.eventSeq + 1}-${next.placedActions.length + 1}`,
    side,
    cardId,
    targetType,
    targetId,
  });

  appendEvent(next, {
    type: "action_placed",
    message: `${sideLabel(side)}暗置行动牌（${sideActions.length + 1}/${limit}）。`,
  });
  appendEvent(next, {
    type: "action_placed_detail",
    visibility: side === SIDES.MASTERMIND ? VIEWERS.MASTERMIND : VIEWERS.PROTAGONISTS,
    message: `${sideLabel(side)}暗置：${cardLabel(cardId, side)} -> ${targetName(
      next,
      targetType,
      targetId,
    )}。`,
  });

  return next;
}

export function advancePhase(state) {
  const next = clone(state);
  assert(!next.pendingDecision, "当前有待处理选择，不能推进阶段。");

  if (next.status === STATUS.FINISHED) {
    return next;
  }

  switch (next.phase) {
    case PHASES.MASTERMIND_ACTION:
      requirePlacedActions(next, SIDES.MASTERMIND, actionLimit(next, SIDES.MASTERMIND));
      next.phase = PHASES.PROTAGONIST_ACTION;
      appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });
      return next;

    case PHASES.PROTAGONIST_ACTION:
      requirePlacedActions(next, SIDES.PROTAGONIST, actionLimit(next, SIDES.PROTAGONIST));
      resolveActionCards(next);
      if (next.status !== STATUS.ACTIVE) return next;
      next.phase = PHASES.MASTERMIND_ABILITY;
      appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });
      return next;

    case PHASES.MASTERMIND_ABILITY:
      next.phase = PHASES.PROTAGONIST_ABILITY;
      appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });
      return next;

    case PHASES.PROTAGONIST_ABILITY:
      next.phase = PHASES.INCIDENT;
      appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });
      return next;

    case PHASES.INCIDENT:
      resolveIncidents(next);
      if (next.status !== STATUS.ACTIVE) return next;
      next.phase = PHASES.END_OF_DAY;
      appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });
      return next;

    case PHASES.END_OF_DAY:
      resolveEndOfDay(next);
      if (next.status !== STATUS.ACTIVE) return next;
      finishDay(next);
      return next;

    default:
      throw new RulesError(`当前阶段不能推进：${next.phase}`);
  }
}

function requirePlacedActions(state, side, count) {
  const placed = state.placedActions.filter((action) => action.side === side).length;
  assert(placed === count, `${sideLabel(side)}需要暗置 ${count} 张行动牌，当前为 ${placed} 张。`);
}

function resolveActionCards(state) {
  appendEvent(state, { type: "actions_revealed", message: "双方行动牌同时揭示。" });
  for (const action of state.placedActions) {
    appendEvent(state, {
      type: "action_revealed_detail",
      message: `${sideLabel(action.side)}：${cardLabel(action.cardId, action.side)} -> ${targetName(
        state,
        action.targetType,
        action.targetId,
      )}。`,
    });
    const card = actionCards[action.cardId];
    if (card.oncePerLoop && !state.oncePerLoopUsed[action.side].includes(action.cardId)) {
      state.oncePerLoopUsed[action.side].push(action.cardId);
    }
  }

  resolveMovementCards(state);
  resolveTokenCards(state);
  state.placedActions = [];
}

function groupedActions(state, predicate) {
  const groups = new Map();
  for (const action of state.placedActions) {
    if (!predicate(action)) continue;
    const key = targetKey(action.targetType, action.targetId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(action);
  }
  return groups;
}

function resolveMovementCards(state) {
  const movementGroups = groupedActions(
    state,
    (action) =>
      action.targetType === TARGET_TYPES.CHARACTER &&
      ["move", "forbid_movement"].includes(actionCards[action.cardId].effect),
  );

  for (const actions of movementGroups.values()) {
    const characterId = actions[0].targetId;
    const character = state.board.characters[characterId];
    if (!character.alive) {
      appendEvent(state, {
        type: "movement_skipped",
        message: `${character.name}已经死亡，移动不结算。`,
      });
      continue;
    }

    if (actions.some((action) => actionCards[action.cardId].effect === "forbid_movement")) {
      appendEvent(state, {
        type: "movement_forbidden",
        message: `${character.name}的移动被禁止。`,
      });
      continue;
    }

    let x = 0;
    let y = 0;
    for (const action of actions) {
      const movement = actionCards[action.cardId].movement;
      if (movement === "horizontal" || movement === "diagonal") x ^= 1;
      if (movement === "vertical" || movement === "diagonal") y ^= 1;
    }

    if (x === 0 && y === 0) {
      appendEvent(state, {
        type: "movement_cancelled",
        message: `${character.name}的移动方向互相抵消，没有移动。`,
      });
      continue;
    }

    moveCharacterByVector(state, characterId, x, y);
  }
}

function moveCharacterByVector(state, characterId, x, y) {
  const character = state.board.characters[characterId];
  const from = locations[character.locationId];
  const target = Object.values(locations).find(
    (location) => location.x === (from.x ^ x) && location.y === (from.y ^ y),
  );
  assert(target, "无法根据移动方向找到目标版图。");

  if (character.forbiddenLocationIds.includes(target.id)) {
    appendEvent(state, {
      type: "movement_blocked_by_forbidden_location",
      message: `${character.name}不能进入${target.name}，停留在${from.name}。`,
    });
    return;
  }

  character.locationId = target.id;
  appendEvent(state, {
    type: "character_moved",
    message: `${character.name}从${from.name}移动到${target.name}。`,
    details: { characterId, fromLocationId: from.id, toLocationId: target.id },
  });
}

function resolveTokenCards(state) {
  const tokenGroups = groupedActions(
    state,
    (action) => !["move", "forbid_movement"].includes(actionCards[action.cardId].effect),
  );

  for (const actions of tokenGroups.values()) {
    const { targetType, targetId } = actions[0];
    for (const token of ["goodwill", "paranoia", "intrigue"]) {
      const related = actions.filter((action) => {
        const card = actionCards[action.cardId];
        return card.token === token;
      });
      if (related.length === 0) continue;

      const forbidden = related.some(
        (action) => actionCards[action.cardId].effect === "forbid_token",
      );
      const tokenActions = related.filter((action) => actionCards[action.cardId].effect === "token");
      if (forbidden && tokenActions.length > 0) {
        appendEvent(state, {
          type: "token_forbidden",
          message: `${targetName(state, targetType, targetId)}的${tokenName(token)}变化被禁止。`,
        });
        continue;
      }

      const positive = tokenActions
        .map((action) => actionCards[action.cardId].amount)
        .filter((amount) => amount > 0)
        .reduce((sum, amount) => sum + amount, 0);
      const negative = tokenActions
        .map((action) => actionCards[action.cardId].amount)
        .filter((amount) => amount < 0)
        .reduce((sum, amount) => sum + amount, 0);

      if (positive !== 0) applyTokenDelta(state, targetType, targetId, token, positive);
      if (negative !== 0) applyTokenDelta(state, targetType, targetId, token, negative);
    }
  }
}

function tokenName(token) {
  return {
    goodwill: "友好",
    paranoia: "不安",
    intrigue: "密谋",
  }[token];
}

function applyTokenDelta(state, targetType, targetId, token, amount) {
  const target =
    targetType === TARGET_TYPES.CHARACTER
      ? state.board.characters[targetId]
      : state.board.locations[targetId];
  assert(target, "未知指示物目标。");

  const before = target[token] ?? 0;
  target[token] = Math.max(0, before + amount);
  const changed = target[token] - before;
  if (changed === 0) {
    appendEvent(state, {
      type: "token_unchanged",
      message: `${targetName(state, targetType, targetId)}的${tokenName(token)}没有变化。`,
    });
    return;
  }

  appendEvent(state, {
    type: "token_changed",
    message: `${targetName(state, targetType, targetId)}${changed > 0 ? "增加" : "移除"} ${Math.abs(
      changed,
    )} 枚${tokenName(token)}。`,
    details: { targetType, targetId, token, amount: changed },
  });
}

export function availableMastermindAbilityActors(state) {
  if (state.phase !== PHASES.MASTERMIND_ABILITY || state.status !== STATUS.ACTIVE) {
    return [];
  }

  return Object.values(state.board.characters)
    .filter((character) => character.alive)
    .filter((character) => !state.usedAbilitiesThisDay.includes(character.id))
    .filter((character) => [ROLE_IDS.MASTERMIND, ROLE_IDS.RUMOR_MONGER].includes(character.roleId))
    .filter((character) => listMastermindAbilityTargets(state, character.id).length > 0);
}

export function listMastermindAbilityTargets(state, actorId) {
  const actor = state.board.characters[actorId];
  if (!actor || !actor.alive || state.usedAbilitiesThisDay.includes(actorId)) {
    return [];
  }

  if (actor.roleId === ROLE_IDS.MASTERMIND) {
    const targets = Object.values(state.board.characters)
      .filter((character) => character.alive && character.locationId === actor.locationId)
      .map((character) => ({
        targetType: TARGET_TYPES.CHARACTER,
        targetId: character.id,
        name: character.name,
      }));
    targets.push({
      targetType: TARGET_TYPES.LOCATION,
      targetId: actor.locationId,
      name: locations[actor.locationId].name,
    });
    return targets;
  }

  if (actor.roleId === ROLE_IDS.RUMOR_MONGER) {
    return Object.values(state.board.characters)
      .filter((character) => character.alive && character.locationId === actor.locationId)
      .map((character) => ({
        targetType: TARGET_TYPES.CHARACTER,
        targetId: character.id,
        name: character.name,
      }));
  }

  return [];
}

export function useMastermindAbility(state, command) {
  const next = clone(state);
  assert(next.status === STATUS.ACTIVE, "当前游戏不在可使用能力状态。");
  assert(next.phase === PHASES.MASTERMIND_ABILITY, "当前不是剧作家能力阶段。");

  const { actorId, targetType, targetId } = command;
  const actor = next.board.characters[actorId];
  assert(actor, `未知角色：${actorId}`);
  assert(actor.alive, `${actor.name}已经死亡，不能使用能力。`);
  assert(!next.usedAbilitiesThisDay.includes(actorId), `${actor.name}本日已经使用过能力。`);
  assert(
    availableMastermindAbilityActors(next).some((candidate) => candidate.id === actorId),
    `${actor.name}当前没有可发动的剧作家能力。`,
  );
  assert(
    listMastermindAbilityTargets(next, actorId).some(
      (target) => target.targetType === targetType && target.targetId === targetId,
    ),
    `${targetName(next, targetType, targetId)}不是当前可选择的能力目标。`,
  );

  const actorRole = roleOf(next, actorId);

  if (actorRole.id === ROLE_IDS.MASTERMIND) {
    assert(
      targetType === TARGET_TYPES.CHARACTER || targetType === TARGET_TYPES.LOCATION,
      "主谋能力目标必须是角色或版图。",
    );
    if (targetType === TARGET_TYPES.CHARACTER) {
      const target = next.board.characters[targetId];
      assert(target, "未知角色。");
      assert(target.alive, `${target.name}已经死亡，不能成为能力目标。`);
      assert(target.locationId === actor.locationId, "主谋只能影响同区域角色。");
    } else {
      assert(targetId === actor.locationId, "主谋只能影响自己所在版图。");
    }

    applyTokenDelta(next, targetType, targetId, "intrigue", 1);
    appendEvent(next, {
      type: "mastermind_ability_used",
      visibility: VIEWERS.MASTERMIND,
      message: `${actor.name}以“主谋”身份放置了密谋。`,
    });
    next.usedAbilitiesThisDay.push(actorId);
    return next;
  }

  if (actorRole.id === ROLE_IDS.RUMOR_MONGER) {
    assert(targetType === TARGET_TYPES.CHARACTER, "传谣人能力目标必须是角色。");
    const target = next.board.characters[targetId];
    assert(target, "未知角色。");
    assert(target.alive, `${target.name}已经死亡，不能成为能力目标。`);
    assert(target.locationId === actor.locationId, "传谣人只能影响同区域角色。");

    applyTokenDelta(next, targetType, targetId, "paranoia", 1);
    appendEvent(next, {
      type: "mastermind_ability_used",
      visibility: VIEWERS.MASTERMIND,
      message: `${actor.name}以“传谣人”身份放置了不安。`,
    });
    next.usedAbilitiesThisDay.push(actorId);
    return next;
  }

  throw new RulesError(`${actor.name}的身份没有第一版已实现的剧作家阶段能力。`);
}

function resolveIncidents(state) {
  const script = scriptForState(state);
  const incidents = script.incidents.filter((incident) => incident.day === state.day);
  if (incidents.length === 0) {
    appendEvent(state, { type: "no_incident", message: "今天没有预定事件。" });
    return;
  }

  for (const incident of incidents) {
    if (incident.incidentId !== "suicide") {
      appendEvent(state, {
        type: "incident_not_implemented",
        visibility: VIEWERS.MASTERMIND,
        message: `${incident.name}尚未在第一版规则核心中实现。`,
      });
      continue;
    }

    const culprit = state.board.characters[incident.culpritId];
    if (!culprit.alive) {
      appendEvent(state, {
        type: "incident_not_triggered",
        message: `预定事件“${incident.name}”没有发生。`,
      });
      appendEvent(state, {
        type: "incident_not_triggered_reason",
        visibility: VIEWERS.MASTERMIND,
        message: `${culprit.name}已经死亡，事件不发生。`,
      });
      continue;
    }

    if (culprit.paranoia < culprit.paranoiaLimit) {
      appendEvent(state, {
        type: "incident_not_triggered",
        message: `预定事件“${incident.name}”没有发生。`,
      });
      appendEvent(state, {
        type: "incident_not_triggered_reason",
        visibility: VIEWERS.MASTERMIND,
        message: `${culprit.name}不安 ${culprit.paranoia}/${culprit.paranoiaLimit}，未达到事件阈值。`,
      });
      continue;
    }

    appendEvent(state, {
      type: "incident_triggered",
      message: `预定事件“${incident.name}”发生。`,
    });
    killCharacter(state, culprit.id, `事件：${incident.name}`);
    if (state.status !== STATUS.ACTIVE) return;
  }
}

function resolveEndOfDay(state) {
  const livingCharacters = () =>
    Object.values(state.board.characters).filter((character) => character.alive);

  for (const actor of livingCharacters()) {
    if (actor.roleId !== ROLE_IDS.SERIAL_KILLER) continue;
    const others = livingCharacters().filter(
      (character) => character.id !== actor.id && character.locationId === actor.locationId,
    );
    if (others.length === 1) {
      appendEvent(state, {
        type: "serial_killer_triggered",
        visibility: VIEWERS.MASTERMIND,
        message: `${actor.name}的杀人狂能力满足条件。`,
      });
      killCharacter(state, others[0].id, "杀人狂");
      if (state.status !== STATUS.ACTIVE) return;
    }
  }

  for (const actor of livingCharacters()) {
    if (actor.roleId !== ROLE_IDS.KILLER) continue;
    if (actor.intrigue >= 4) {
      killProtagonists(state, `${actor.name}身上有 4 枚或以上密谋，杀手能力杀害主人公。`);
      return;
    }

    const keyPerson = livingCharacters().find(
      (character) =>
        character.roleId === ROLE_IDS.KEY_PERSON &&
        character.locationId === actor.locationId &&
        character.intrigue >= 2,
    );
    if (keyPerson) {
      appendEvent(state, {
        type: "killer_triggered",
        visibility: VIEWERS.MASTERMIND,
        message: `${actor.name}的杀手能力满足条件。`,
      });
      killCharacter(state, keyPerson.id, "杀手");
      if (state.status !== STATUS.ACTIVE) return;
    }
  }
}

function killCharacter(state, characterId, cause) {
  const character = state.board.characters[characterId];
  if (!character.alive) return;

  character.alive = false;
  appendEvent(state, {
    type: "character_died",
    message: `${character.name}死亡。`,
    details: { characterId, cause },
  });
  appendEvent(state, {
    type: "death_cause",
    visibility: VIEWERS.MASTERMIND,
    message: `${character.name}死亡原因：${cause}。身份：${roles[character.roleId].name}。`,
  });

  if (character.roleId === ROLE_IDS.KEY_PERSON) {
    failLoop(state, "关键人物死亡。", "本轮轮回立即失败。");
  }
}

function killProtagonists(state, hiddenReason) {
  state.protagonistsAlive = false;
  appendEvent(state, {
    type: "protagonists_died",
    message: "主人公死亡。",
  });
  failLoop(state, hiddenReason, "本轮轮回立即失败。");
}

function failLoop(state, hiddenReason, publicMessage) {
  appendEvent(state, {
    type: "loop_failed",
    message: publicMessage,
  });
  appendEvent(state, {
    type: "loop_failed_reason",
    visibility: VIEWERS.MASTERMIND,
    message: hiddenReason,
  });

  const script = scriptForState(state);
  if (state.loop >= script.loops) {
    state.status = STATUS.FINAL_GUESS;
    state.phase = PHASES.FINAL_GUESS;
    appendEvent(state, {
      type: "final_guess_started",
      message: "所有轮回均已失败，进入最终决战。",
    });
    return;
  }

  state.status = STATUS.LOOP_FAILED;
  state.phase = PHASES.LOOP_END;
}

function finishDay(state) {
  const script = scriptForState(state);
  if (state.day >= script.daysPerLoop) {
    state.status = STATUS.FINISHED;
    state.phase = PHASES.FINISHED;
    state.winner = SIDES.PROTAGONIST;
    appendEvent(state, {
      type: "protagonists_win",
      message: "本轮轮回结束时没有达成失败条件，主人公胜利。",
    });
    return;
  }

  state.day += 1;
  state.phase = PHASES.MASTERMIND_ACTION;
  state.placedActions = [];
  state.usedAbilitiesThisDay = [];
  appendEvent(state, {
    type: "day_started",
    message: `进入第 ${state.day} 天。`,
  });
  appendEvent(state, { type: "phase_changed", message: `进入${PHASE_LABELS[state.phase]}。` });
}

export function startNextLoop(state) {
  const next = clone(state);
  assert(next.status === STATUS.LOOP_FAILED, "当前不能开始下一轮轮回。");

  const script = scriptForState(next);
  assert(next.loop < script.loops, "已经没有下一轮轮回。");

  next.loop += 1;
  next.day = 1;
  next.phase = PHASES.MASTERMIND_ACTION;
  next.status = STATUS.ACTIVE;
  next.protagonistsAlive = true;
  next.board = buildInitialBoard(script);
  next.placedActions = [];
  next.oncePerLoopUsed = {
    [SIDES.MASTERMIND]: [],
    [SIDES.PROTAGONIST]: [],
  };
  next.usedAbilitiesThisDay = [];
  next.pendingDecision = null;

  appendEvent(next, {
    type: "loop_started",
    message: `开始第 ${next.loop} 轮轮回，盘面复原到轮回初始状态。`,
  });
  appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });

  return next;
}

export function submitFinalGuesses(state, guesses) {
  const next = clone(state);
  assert(next.status === STATUS.FINAL_GUESS, "当前不是最终决战。");

  const wrong = [];
  for (const character of Object.values(next.board.characters)) {
    if (guesses[character.id] !== character.roleId) {
      wrong.push(character.id);
    }
  }

  next.status = STATUS.FINISHED;
  next.phase = PHASES.FINISHED;
  next.winner = wrong.length === 0 ? SIDES.PROTAGONIST : SIDES.MASTERMIND;

  appendEvent(next, {
    type: "final_guess_resolved",
    message:
      wrong.length === 0
        ? "最终决战全部猜对，主人公胜利。"
        : `最终决战猜错 ${wrong.length} 名角色，剧作家胜利。`,
    details: { wrongCharacterIds: wrong },
  });

  return next;
}

export function projectView(state, viewer) {
  const projected = clone(state);
  const visibleRoleIds = new Set(projected.knowledge.revealedRoleCharacterIds);
  const isMastermind = viewer === VIEWERS.MASTERMIND;
  const script = scriptForState(state);

  projected.script = projectScript(script, state, viewer);

  for (const character of Object.values(projected.board.characters)) {
    if (!isMastermind && !visibleRoleIds.has(character.id) && projected.phase !== PHASES.FINISHED) {
      character.roleId = null;
      character.roleName = "未知";
      character.roleSummary = "";
    } else {
      character.roleName = roles[character.roleId]?.name ?? "未知";
      character.roleSummary = roles[character.roleId]?.summary ?? "";
    }
  }

  projected.placedActions = projected.placedActions.map((action) => {
    const ownAction =
      (viewer === VIEWERS.MASTERMIND && action.side === SIDES.MASTERMIND) ||
      (viewer === VIEWERS.PROTAGONISTS && action.side === SIDES.PROTAGONIST);
    if (ownAction) return action;
    return {
      id: action.id,
      side: action.side,
      cardId: "hidden",
      targetType: null,
      targetId: null,
    };
  });

  projected.eventLog = projected.eventLog.filter((event) => {
    if (event.visibility === "public") return true;
    return event.visibility === viewer;
  });

  return projected;
}

function projectScript(script, state, viewer) {
  const isMastermind = viewer === VIEWERS.MASTERMIND;
  return {
    id: script.id,
    name: script.name,
    moduleName: script.moduleName,
    loops: script.loops,
    daysPerLoop: script.daysPerLoop,
    protagonistCount: script.protagonistCount,
    actionSlots: script.actionSlots,
    notes: script.notes,
    rules: isMastermind
      ? [`Rule Y：${script.closedInfo.ruleY}`, ...script.closedInfo.ruleX.map((rule) => `Rule X：${rule}`)]
      : [`惨剧模块：${script.moduleName}`, "采用规则：未公开"],
    incidents: Array.from({ length: script.daysPerLoop }, (_, index) => {
      const day = index + 1;
      const incident = script.incidents.find((candidate) => candidate.day === day);
      const publicIncident = script.publicInfo.incidents.find((candidate) => candidate.day === day);
      if (!incident && !publicIncident) {
        return {
          day,
          name: "无",
          culpritName: "无",
          culpritId: null,
        };
      }

      const visibleIncident = incident ?? publicIncident;
      const culprit = incident ? state.board.characters[incident.culpritId] : null;
      return {
        day,
        name: visibleIncident.name,
        culpritId: isMastermind ? incident?.culpritId ?? null : null,
        culpritName: isMastermind && culprit ? culprit.name : "未公开",
      };
    }),
  };
}

export function describeState(state) {
  return {
    scriptName: scriptForState(state).name,
    loop: state.loop,
    day: state.day,
    phase: state.phase,
    phaseLabel: phaseLabel(state.phase),
    status: state.status,
    winner: state.winner,
  };
}

export { STATUS };
