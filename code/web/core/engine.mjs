import {
  PHASES,
  PROTAGONIST_DECKS,
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
  [PHASES.DAWN]: "黎明阶段",
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

const GOODWILL_REFUSAL_TRAITS = {
  OPTIONAL: "无视友好",
  FORCED: "强制无视友好",
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

function protagonistDeck(deckId) {
  return PROTAGONIST_DECKS.find((deck) => deck.id === deckId);
}

function createOncePerLoopUsed() {
  return {
    [SIDES.MASTERMIND]: [],
    [SIDES.PROTAGONIST]: Object.fromEntries(PROTAGONIST_DECKS.map((deck) => [deck.id, []])),
  };
}

function protagonistActionDeckId(state, placement) {
  if (placement.side !== SIDES.PROTAGONIST) return null;
  if (placement.deckId) return placement.deckId;
  return PROTAGONIST_DECKS.find(
    (deck) =>
      !state.placedActions.some(
        (action) => action.side === SIDES.PROTAGONIST && action.deckId === deck.id,
      ),
  )?.id;
}

function usedOncePerLoop(state, side, cardId, deckId = null) {
  if (side === SIDES.PROTAGONIST) {
    return Boolean(deckId && state.oncePerLoopUsed[side]?.[deckId]?.includes(cardId));
  }
  return state.oncePerLoopUsed[side].includes(cardId);
}

function markOncePerLoopUsed(state, action) {
  const card = actionCards[action.cardId];
  if (!card.oncePerLoop) return;

  if (action.side === SIDES.PROTAGONIST) {
    const discard = state.oncePerLoopUsed[SIDES.PROTAGONIST][action.deckId];
    if (!discard.includes(action.cardId)) discard.push(action.cardId);
    return;
  }

  if (!state.oncePerLoopUsed[action.side].includes(action.cardId)) {
    state.oncePerLoopUsed[action.side].push(action.cardId);
  }
}

function skillUseKey(actorId, skillId) {
  return `${actorId}:${skillId}`;
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
    version: 2,
    scriptId: script.id,
    loop: 1,
    day: 1,
    phase: PHASES.DAWN,
    status: STATUS.ACTIVE,
    winner: null,
    protagonistsAlive: true,
    board: buildInitialBoard(script),
    placedActions: [],
    oncePerLoopUsed: createOncePerLoopUsed(),
    usedAbilitiesThisDay: [],
    usedProtagonistAbilitiesThisDay: [],
    usedProtagonistAbilitiesThisLoop: [],
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

export function availableCards(state, side, deckId = null) {
  assert(hands[side], `未知阵营：${side}`);
  const deckHasPlaced =
    side === SIDES.PROTAGONIST &&
    deckId &&
    state.placedActions.some(
      (action) => action.side === SIDES.PROTAGONIST && action.deckId === deckId,
    );
  return hands[side].map((entry) => {
    const card = actionCards[entry.cardId];
    const placedCount = state.placedActions.filter(
      (action) =>
        action.side === side &&
        action.cardId === entry.cardId &&
        (side !== SIDES.PROTAGONIST || !deckId || action.deckId === deckId),
    ).length;
    const onceUsed = card.oncePerLoop && usedOncePerLoop(state, side, entry.cardId, deckId);
    return {
      ...entry,
      card,
      name: cardLabel(entry.cardId, side),
      remainingThisPhase: deckHasPlaced ? 0 : Math.max(0, entry.quantity - placedCount),
      disabled: Boolean(onceUsed || deckHasPlaced),
      disabledReason: onceUsed
        ? "每轮限 1 次，本轮已使用"
        : deckHasPlaced
          ? "这副牌本阶段已经出过行动牌"
          : "",
    };
  });
}

export function placeAction(state, placement) {
  const next = clone(state);
  assert(next.status === STATUS.ACTIVE, "当前游戏不在可行动状态。");
  assert(!next.pendingDecision, "当前有待处理选择，不能暗置行动牌。");

  const { side, cardId, targetType, targetId } = placement;
  const deckId = protagonistActionDeckId(next, placement);
  const expectedPhase =
    side === SIDES.MASTERMIND ? PHASES.MASTERMIND_ACTION : PHASES.PROTAGONIST_ACTION;
  assert(next.phase === expectedPhase, `当前不是${sideLabel(side)}的行动阶段。`);

  const sideActions = next.placedActions.filter((action) => action.side === side);
  const limit = actionLimit(next, side);
  assert(sideActions.length < limit, `${sideLabel(side)}本阶段行动牌已经放满。`);

  if (side === SIDES.PROTAGONIST) {
    assert(deckId, "主人公行动必须指定一副行动牌。");
    assert(protagonistDeck(deckId), `未知主人公行动牌颜色：${deckId}`);
    assert(
      !sideActions.some((action) => action.deckId === deckId),
      `${protagonistDeck(deckId).name}行动牌本阶段已经出过。`,
    );
  }

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

  const sameCardCount = sideActions.filter(
    (action) =>
      action.cardId === cardId &&
      (side !== SIDES.PROTAGONIST || action.deckId === deckId),
  ).length;
  assert(sameCardCount < entry.quantity, `${cardLabel(cardId, side)}的可用数量不足。`);

  const duplicateTarget = sideActions.some(
    (action) => action.targetType === targetType && action.targetId === targetId,
  );
  assert(!duplicateTarget, "同一阵营不能在同一角色或版图上重复放置行动牌。");

  if (card.oncePerLoop) {
    assert(
      !usedOncePerLoop(next, side, cardId, deckId),
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
    deckId,
    cardId,
    targetType,
    targetId,
  });

  appendEvent(next, {
    type: "action_placed",
    message: `${sideLabel(side)}在${targetName(next, targetType, targetId)}上暗置行动牌（${
      sideActions.length + 1
    }/${limit}）。`,
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
    case PHASES.DAWN:
      next.phase = PHASES.MASTERMIND_ACTION;
      appendEvent(next, { type: "phase_changed", message: `进入${PHASE_LABELS[next.phase]}。` });
      return next;

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
    markOncePerLoopUsed(state, action);
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
  const forbidIntrigueCount = state.placedActions.filter(
    (action) => action.cardId === "forbid_intrigue",
  ).length;
  const forbidIntrigueOverloaded = forbidIntrigueCount >= 2;
  if (forbidIntrigueOverloaded) {
    appendEvent(state, {
      type: "forbid_intrigue_overloaded",
      message: "多张禁止密谋同时放置，所有禁止密谋均不生效。",
    });
  }

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

      const hasForbid = related.some(
        (action) => actionCards[action.cardId].effect === "forbid_token",
      );
      const forbidden = hasForbid && !(token === "intrigue" && forbidIntrigueOverloaded);
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
  const seen = new Set();
  return availableMastermindAbilities(state)
    .map((ability) => state.board.characters[ability.actorId])
    .filter((actor) => {
      if (seen.has(actor.id)) return false;
      seen.add(actor.id);
      return true;
    });
}

export function availableMastermindAbilities(state) {
  if (state.phase !== PHASES.MASTERMIND_ABILITY || state.status !== STATUS.ACTIVE) {
    return [];
  }

  return Object.values(state.board.characters).flatMap((actor) => {
    if (!actor.alive || state.usedAbilitiesThisDay.includes(actor.id)) return [];
    return mastermindAbilitySpecs(state, actor)
      .map((ability) => ({
        ...ability,
        actorId: actor.id,
        actorName: actor.name,
        roleId: actor.roleId,
        roleName: roles[actor.roleId]?.name ?? "未知",
        targets: listMastermindAbilityTargets(state, actor.id, ability.abilityId),
      }))
      .filter((ability) => ability.targets.length > 0);
  });
}

function roleHasGoodwillRefusal(role) {
  return (
    role?.traits?.includes(GOODWILL_REFUSAL_TRAITS.OPTIONAL) ||
    role?.traits?.includes(GOODWILL_REFUSAL_TRAITS.FORCED)
  );
}

function mastermindAbilitySpecs(state, actor) {
  const actorRole = roleOf(state, actor.id);
  const specs = [];
  if (actor.roleId === ROLE_IDS.MASTERMIND) {
    specs.push({
      abilityId: "role_mastermind_intrigue",
      abilityName: "主谋：放置密谋",
      requiresOption: false,
    });
  }
  if (actor.roleId === ROLE_IDS.RUMOR_MONGER) {
    specs.push({
      abilityId: "role_rumor_monger_paranoia",
      abilityName: "传谣人：放置不安",
      requiresOption: false,
    });
  }
  if (characterSkill(actor, "doctor_adjust_paranoia") && roleHasGoodwillRefusal(actorRole)) {
    specs.push({
      abilityId: "doctor_adjust_paranoia",
      abilityName: "医生：诊疗",
      requiresOption: true,
      options: [
        { value: "remove_paranoia", label: "移除 1 枚不安" },
        { value: "add_paranoia", label: "放置 1 枚不安" },
      ],
    });
  }
  return specs;
}

function firstMastermindAbilityId(state, actorId) {
  return availableMastermindAbilities(state).find((ability) => ability.actorId === actorId)
    ?.abilityId;
}

export function listMastermindAbilityTargets(state, actorId, abilityId = null) {
  const actor = state.board.characters[actorId];
  if (!actor || !actor.alive || state.usedAbilitiesThisDay.includes(actorId)) {
    return [];
  }

  const resolvedAbilityId = abilityId ?? firstMastermindAbilityId(state, actorId);
  if (!resolvedAbilityId) return [];
  if (!mastermindAbilitySpecs(state, actor).some((ability) => ability.abilityId === resolvedAbilityId)) {
    return [];
  }

  if (resolvedAbilityId === "role_mastermind_intrigue") {
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

  if (resolvedAbilityId === "role_rumor_monger_paranoia") {
    return Object.values(state.board.characters)
      .filter((character) => character.alive && character.locationId === actor.locationId)
      .map((character) => ({
        targetType: TARGET_TYPES.CHARACTER,
        targetId: character.id,
        name: character.name,
      }));
  }

  if (resolvedAbilityId === "doctor_adjust_paranoia") {
    return Object.values(state.board.characters)
      .filter(
        (character) =>
          character.alive && character.id !== actor.id && character.locationId === actor.locationId,
      )
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
  const abilityId = command.abilityId ?? firstMastermindAbilityId(next, actorId);
  assert(abilityId, `${actor.name}当前没有可发动的剧作家能力。`);
  assert(
    availableMastermindAbilities(next).some(
      (candidate) => candidate.actorId === actorId && candidate.abilityId === abilityId,
    ),
    `${actor.name}当前没有可发动的剧作家能力。`,
  );
  assert(
    listMastermindAbilityTargets(next, actorId, abilityId).some(
      (target) => target.targetType === targetType && target.targetId === targetId,
    ),
    `${targetName(next, targetType, targetId)}不是当前可选择的能力目标。`,
  );

  if (abilityId === "role_mastermind_intrigue") {
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

  if (abilityId === "role_rumor_monger_paranoia") {
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

  if (abilityId === "doctor_adjust_paranoia") {
    assert(targetType === TARGET_TYPES.CHARACTER, "医生诊疗目标必须是角色。");
    const target = next.board.characters[targetId];
    assert(target, "未知角色。");
    assert(target.alive, `${target.name}已经死亡，不能成为能力目标。`);
    assert(target.id !== actor.id, "医生诊疗必须选择另一名角色。");
    assert(target.locationId === actor.locationId, "医生只能诊疗同区域角色。");

    applyTokenDelta(
      next,
      targetType,
      targetId,
      "paranoia",
      command.option === "add_paranoia" ? 1 : -1,
    );
    appendEvent(next, {
      type: "mastermind_ability_used",
      visibility: VIEWERS.MASTERMIND,
      message: `${actor.name}因无视友好身份特性，由剧作家使用了医生友好能力。`,
    });
    next.usedAbilitiesThisDay.push(actorId);
    return next;
  }

  throw new RulesError(`${actor.name}没有第一版已实现的剧作家阶段能力：${abilityId}。`);
}

function characterSkill(actor, skillId) {
  return actor.skills.find((skill) => skill.id === skillId);
}

function protagonistAbilityUsed(state, actorId, skill) {
  const key = skillUseKey(actorId, skill.id);
  return skill.oncePerLoop || skill.frequency === "per_loop"
    ? state.usedProtagonistAbilitiesThisLoop.includes(key)
    : state.usedProtagonistAbilitiesThisDay.includes(key);
}

function markProtagonistAbilityUsed(state, actorId, skill) {
  const key = skillUseKey(actorId, skill.id);
  if ((skill.oncePerLoop || skill.frequency === "per_loop") && !state.usedProtagonistAbilitiesThisLoop.includes(key)) {
    state.usedProtagonistAbilitiesThisLoop.push(key);
  }
  if (!state.usedProtagonistAbilitiesThisDay.includes(key)) {
    state.usedProtagonistAbilitiesThisDay.push(key);
  }
}

export function availableProtagonistAbilities(state) {
  if (
    state.phase !== PHASES.PROTAGONIST_ABILITY ||
    state.status !== STATUS.ACTIVE ||
    state.pendingDecision
  ) {
    return [];
  }

  return Object.values(state.board.characters).flatMap((actor) => {
    if (!actor.alive) return [];
    return actor.skills
      .filter((skill) => skill.usableBy?.includes(SIDES.PROTAGONIST))
      .filter((skill) => actor.goodwill >= skill.requiredGoodwill)
      .filter((skill) => !protagonistAbilityUsed(state, actor.id, skill))
      .map((skill) => ({
        actorId: actor.id,
        actorName: actor.name,
        skillId: skill.id,
        skillName: skill.name,
        requiredGoodwill: skill.requiredGoodwill,
        oncePerLoop: Boolean(skill.oncePerLoop),
        frequency: skill.frequency,
        targets: listProtagonistAbilityTargets(state, actor.id, skill.id),
      }))
      .filter((ability) => ability.targets.length > 0);
  });
}

export function listProtagonistAbilityTargets(state, actorId, skillId) {
  const actor = state.board.characters[actorId];
  if (!actor || !actor.alive) return [];

  const skill = characterSkill(actor, skillId);
  if (!skill || !skill.usableBy?.includes(SIDES.PROTAGONIST)) return [];

  const sameLocationCharacters = Object.values(state.board.characters).filter(
    (character) => character.alive && character.locationId === actor.locationId,
  );
  const otherSameLocationCharacters = sameLocationCharacters.filter(
    (character) => character.id !== actor.id,
  );

  if (skillId === "student_reduce_paranoia") {
    return otherSameLocationCharacters
      .filter((character) => character.attributes.includes("学生"))
      .map((character) => ({
        targetType: TARGET_TYPES.CHARACTER,
        targetId: character.id,
        name: character.name,
      }));
  }

  if (["idol_reduce_paranoia", "idol_add_goodwill", "doctor_adjust_paranoia"].includes(skillId)) {
    return otherSameLocationCharacters.map((character) => ({
      targetType: TARGET_TYPES.CHARACTER,
      targetId: character.id,
      name: character.name,
    }));
  }

  if (skillId === "shrine_remove_intrigue") {
    if (actor.locationId !== "shrine") return [];
    return [
      {
        targetType: TARGET_TYPES.LOCATION,
        targetId: "shrine",
        name: "神社",
      },
    ];
  }

  if (skillId === "shrine_reveal_role") {
    return sameLocationCharacters.map((character) => ({
      targetType: TARGET_TYPES.CHARACTER,
      targetId: character.id,
      name: character.name,
    }));
  }

  if (skillId === "worker_reveal_self") {
    return [
      {
        targetType: TARGET_TYPES.CHARACTER,
        targetId: actor.id,
        name: actor.name,
      },
    ];
  }

  if (skillId === "doctor_patient_mobility") {
    return [
      {
        targetType: TARGET_TYPES.LOCATION,
        targetId: "hospital",
        name: "住院患者出院许可",
      },
    ];
  }

  return [];
}

function protagonistAbilityApprovalMode(actorRole) {
  if (actorRole.traits.includes(GOODWILL_REFUSAL_TRAITS.FORCED)) return "auto_reject";
  if (actorRole.traits.includes(GOODWILL_REFUSAL_TRAITS.OPTIONAL)) return "mastermind";
  return "auto_accept";
}

export function requestProtagonistAbility(state, command) {
  const next = clone(state);
  assert(next.status === STATUS.ACTIVE, "当前游戏不在可使用能力状态。");
  assert(next.phase === PHASES.PROTAGONIST_ABILITY, "当前不是主人公能力阶段。");
  assert(!next.pendingDecision, "当前已有待剧作家确认的能力。");

  const { actorId, skillId, targetType, targetId } = command;
  const actor = next.board.characters[actorId];
  assert(actor, `未知角色：${actorId}`);
  assert(actor.alive, `${actor.name}已经死亡，不能使用能力。`);

  const skill = characterSkill(actor, skillId);
  assert(skill, `${actor.name}没有能力：${skillId}`);
  assert(skill.usableBy?.includes(SIDES.PROTAGONIST), `${skill.name}不能由主人公发动。`);
  assert(actor.goodwill >= skill.requiredGoodwill, `${actor.name}的友好未达到 ${skill.requiredGoodwill}。`);
  assert(!protagonistAbilityUsed(next, actorId, skill), `${actor.name}的${skill.name}已经使用过。`);
  assert(
    listProtagonistAbilityTargets(next, actorId, skillId).some(
      (target) => target.targetType === targetType && target.targetId === targetId,
    ),
    `${targetName(next, targetType, targetId)}不是当前可选择的能力目标。`,
  );

  const request = {
    type: "protagonist_ability_approval",
    actorId,
    skillId,
    targetType,
    targetId,
    option: command.option ?? null,
  };
  const approvalMode = protagonistAbilityApprovalMode(roleOf(next, actorId));

  appendEvent(next, {
    type: "protagonist_ability_requested",
    message: `主人公宣告发动${actor.name}的「${skill.name}」。`,
  });

  if (approvalMode === "auto_accept") {
    resolveProtagonistAbility(next, request, true);
    return next;
  }

  if (approvalMode === "auto_reject") {
    rejectProtagonistAbility(next, request, "该角色强制无视友好，能力自动被拒绝。");
    return next;
  }

  next.pendingDecision = request;
  appendEvent(next, {
    type: "protagonist_ability_waiting_approval",
    visibility: VIEWERS.MASTERMIND,
    message: `${actor.name}的身份具有无视友好，剧作家需决定是否接受该能力。`,
  });
  return next;
}

export function respondProtagonistAbility(state, command) {
  const next = clone(state);
  assert(next.pendingDecision?.type === "protagonist_ability_approval", "当前没有待审批的主人公能力。");

  const request = next.pendingDecision;
  next.pendingDecision = null;
  if (command.approved) {
    resolveProtagonistAbility(next, request, false);
  } else {
    rejectProtagonistAbility(next, request, "剧作家拒绝该能力。");
  }
  return next;
}

function rejectProtagonistAbility(state, request, reason) {
  const actor = state.board.characters[request.actorId];
  const skill = characterSkill(actor, request.skillId);
  markProtagonistAbilityUsed(state, actor.id, skill);
  state.pendingDecision = null;
  appendEvent(state, {
    type: "protagonist_ability_rejected",
    message: `${actor.name}的「${skill.name}」没有生效。`,
  });
  appendEvent(state, {
    type: "protagonist_ability_rejected_reason",
    visibility: VIEWERS.MASTERMIND,
    message: reason,
  });
}

function resolveProtagonistAbility(state, request, autoAccepted) {
  const actor = state.board.characters[request.actorId];
  const skill = characterSkill(actor, request.skillId);
  markProtagonistAbilityUsed(state, actor.id, skill);
  state.pendingDecision = null;

  if (autoAccepted) {
    appendEvent(state, {
      type: "protagonist_ability_auto_accepted",
      visibility: VIEWERS.MASTERMIND,
      message: `${actor.name}没有无视友好，能力自动生效。`,
    });
  }

  if (["student_reduce_paranoia", "idol_reduce_paranoia"].includes(skill.id)) {
    applyTokenDelta(state, request.targetType, request.targetId, "paranoia", -1);
  } else if (skill.id === "idol_add_goodwill") {
    applyTokenDelta(state, request.targetType, request.targetId, "goodwill", 1);
  } else if (skill.id === "doctor_adjust_paranoia") {
    applyTokenDelta(
      state,
      request.targetType,
      request.targetId,
      "paranoia",
      request.option === "add_paranoia" ? 1 : -1,
    );
  } else if (skill.id === "shrine_remove_intrigue") {
    applyTokenDelta(state, TARGET_TYPES.LOCATION, "shrine", "intrigue", -1);
  } else if (skill.id === "shrine_reveal_role" || skill.id === "worker_reveal_self") {
    if (!state.knowledge.revealedRoleCharacterIds.includes(request.targetId)) {
      state.knowledge.revealedRoleCharacterIds.push(request.targetId);
    }
    appendEvent(state, {
      type: "role_revealed",
      message: `${targetName(state, TARGET_TYPES.CHARACTER, request.targetId)}的身份被公开。`,
    });
  } else if (skill.id === "doctor_patient_mobility") {
    appendEvent(state, {
      type: "patient_mobility_enabled",
      message: "本轮中，住院患者不再拥有禁行区域。",
    });
  } else {
    appendEvent(state, {
      type: "protagonist_ability_not_implemented",
      message: `${actor.name}的「${skill.name}」已记录为发动，但效果尚未实现。`,
    });
  }

  appendEvent(state, {
    type: "protagonist_ability_resolved",
    message: `${actor.name}的「${skill.name}」结算完毕。`,
  });
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

  const serialKillerSnapshot = livingCharacters();
  const serialKillerDeaths = [];
  for (const actor of serialKillerSnapshot) {
    if (actor.roleId !== ROLE_IDS.SERIAL_KILLER) continue;
    const others = serialKillerSnapshot.filter(
      (character) => character.id !== actor.id && character.locationId === actor.locationId,
    );
    if (others.length === 1) {
      appendEvent(state, {
        type: "serial_killer_triggered",
        visibility: VIEWERS.MASTERMIND,
        message: `${actor.name}的杀人狂能力满足条件。`,
      });
      serialKillerDeaths.push({ characterId: others[0].id, cause: "杀人狂" });
    }
  }
  if (serialKillerDeaths.length > 0) {
    killCharactersSimultaneously(state, serialKillerDeaths);
    if (state.status !== STATUS.ACTIVE) return;
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

function killCharactersSimultaneously(state, deaths) {
  const uniqueDeaths = new Map();
  for (const death of deaths) {
    const existing = uniqueDeaths.get(death.characterId);
    if (existing) {
      existing.cause = existing.cause.includes(death.cause)
        ? existing.cause
        : `${existing.cause}、${death.cause}`;
    } else {
      uniqueDeaths.set(death.characterId, { ...death });
    }
  }

  const killed = [];
  for (const death of uniqueDeaths.values()) {
    const character = state.board.characters[death.characterId];
    if (!character?.alive) continue;

    character.alive = false;
    killed.push(character);
    appendEvent(state, {
      type: "character_died",
      message: `${character.name}死亡。`,
      details: { characterId: character.id, cause: death.cause },
    });
    appendEvent(state, {
      type: "death_cause",
      visibility: VIEWERS.MASTERMIND,
      message: `${character.name}死亡原因：${death.cause}。身份：${roles[character.roleId].name}。`,
    });
  }

  if (killed.some((character) => character.roleId === ROLE_IDS.KEY_PERSON)) {
    failLoop(state, "关键人物死亡。", "本轮轮回立即失败。");
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
  state.phase = PHASES.DAWN;
  state.placedActions = [];
  state.usedAbilitiesThisDay = [];
  state.usedProtagonistAbilitiesThisDay = [];
  state.pendingDecision = null;
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
  next.phase = PHASES.DAWN;
  next.status = STATUS.ACTIVE;
  next.protagonistsAlive = true;
  next.board = buildInitialBoard(script);
  next.placedActions = [];
  next.oncePerLoopUsed = createOncePerLoopUsed();
  next.usedAbilitiesThisDay = [];
  next.usedProtagonistAbilitiesThisDay = [];
  next.usedProtagonistAbilitiesThisLoop = [];
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
  projected.discardPiles = actionDiscardPiles(state);

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
      deckId: action.deckId,
      cardId: "hidden",
      targetType: action.targetType,
      targetId: action.targetId,
    };
  });

  projected.eventLog = projected.eventLog.filter((event) => {
    if (event.visibility === "public") return true;
    return event.visibility === viewer;
  });

  return projected;
}

export function actionDiscardPiles(state) {
  return {
    [SIDES.MASTERMIND]: state.oncePerLoopUsed[SIDES.MASTERMIND].map((cardId) => ({
      side: SIDES.MASTERMIND,
      deckId: null,
      cardId,
      name: cardLabel(cardId, SIDES.MASTERMIND),
    })),
    [SIDES.PROTAGONIST]: PROTAGONIST_DECKS.flatMap((deck) =>
      state.oncePerLoopUsed[SIDES.PROTAGONIST][deck.id].map((cardId) => ({
        side: SIDES.PROTAGONIST,
        deckId: deck.id,
        deckName: deck.name,
        deckShortName: deck.shortName,
        cardId,
        name: cardLabel(cardId, SIDES.PROTAGONIST),
      })),
    ),
  };
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
