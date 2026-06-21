import test from "node:test";
import assert from "node:assert/strict";

import { PHASES, ROLE_IDS, SIDES, TARGET_TYPES, VIEWERS } from "./data.mjs";
import {
  actionDiscardPiles,
  actionLimit,
  advancePhase,
  availableMastermindAbilityActors,
  availableMastermindAbilities,
  availableProtagonistAbilities,
  createGame,
  listLegalTargets,
  placeAction,
  projectView,
  requestProtagonistAbility,
  respondProtagonistAbility,
  startNextLoop,
  submitFinalGuesses,
  useMastermindAbility,
} from "./engine.mjs";

function startMastermindAction(state = createGame()) {
  return state.phase === PHASES.DAWN ? advancePhase(state) : state;
}

function placeFirstLoopDayOneFailure(state) {
  let next = startMastermindAction(state);
  next = placeAction(next, {
    side: SIDES.MASTERMIND,
    cardId: "move_vertical",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });
  next = placeAction(next, {
    side: SIDES.MASTERMIND,
    cardId: "intrigue_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "office_worker",
  });
  next = placeAction(next, {
    side: SIDES.MASTERMIND,
    cardId: "paranoia_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "doctor",
  });
  next = advancePhase(next);
  next = placeAction(next, {
    side: SIDES.PROTAGONIST,
    cardId: "forbid_intrigue",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "hospital",
  });
  next = placeAction(next, {
    side: SIDES.PROTAGONIST,
    cardId: "forbid_movement",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
  });
  next = placeAction(next, {
    side: SIDES.PROTAGONIST,
    cardId: "goodwill_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "idol",
  });
  return next;
}

test("protagonist view hides closed-script roles", () => {
  const state = createGame();
  const protagonistView = projectView(state, VIEWERS.PROTAGONISTS);
  const mastermindView = projectView(state, VIEWERS.MASTERMIND);

  assert.equal(protagonistView.board.characters.girl_student.roleId, null);
  assert.equal(protagonistView.board.characters.girl_student.roleName, "未知");
  assert.equal(protagonistView.board.characters.girl_student.goodwillLimit, 2);
  assert.equal(protagonistView.board.characters.girl_student.skills[0].requiredGoodwill, 2);
  assert.equal(mastermindView.board.characters.girl_student.roleId, ROLE_IDS.KEY_PERSON);
  assert.equal(mastermindView.board.characters.girl_student.roleName, "关键人物");
});

test("character cards expose goodwill limits, public traits, and all public skills", () => {
  const state = createGame();
  const protagonistView = projectView(state, VIEWERS.PROTAGONISTS);

  assert.equal(protagonistView.board.characters.idol.goodwillLimit, 4);
  assert.deepEqual(
    protagonistView.board.characters.idol.skills.map((skill) => skill.requiredGoodwill),
    [3, 4],
  );
  assert.equal(protagonistView.board.characters.shrine_maiden.goodwillLimit, 5);
  assert.equal(protagonistView.board.characters.shrine_maiden.publicTraits.includes("不能进入都市。"), true);
  assert.equal(protagonistView.board.characters.doctor.skills.length, 2);
  assert.equal(protagonistView.board.characters.doctor.skills[0].frequency, "per_day");
  assert.equal(protagonistView.board.characters.doctor.skills[0].additionalUsers[0].side, SIDES.MASTERMIND);
});

test("script projection reveals culprits only to mastermind", () => {
  const state = createGame();
  const protagonistView = projectView(state, VIEWERS.PROTAGONISTS);
  const mastermindView = projectView(state, VIEWERS.MASTERMIND);

  assert.equal(mastermindView.script.rules.includes("Rule Y：谋杀计划"), true);
  assert.equal(mastermindView.script.incidents[2].culpritName, "女学生");
  assert.equal(protagonistView.script.incidents[2].name, "自杀");
  assert.equal(protagonistView.script.incidents[2].culpritName, "未公开");
});

test("protagonist side always has three action slots", () => {
  const state = createGame();

  assert.equal(actionLimit(state, SIDES.MASTERMIND), 3);
  assert.equal(actionLimit(state, SIDES.PROTAGONIST), 3);
});

test("new days begin with dawn before mastermind action", () => {
  let state = createGame();

  assert.equal(state.phase, PHASES.DAWN);

  state = advancePhase(state);
  assert.equal(state.phase, PHASES.MASTERMIND_ACTION);
});

test("opposing action projection hides card names but keeps public targets", () => {
  let state = startMastermindAction();
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "move_vertical",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });

  const protagonistView = projectView(state, VIEWERS.PROTAGONISTS);
  assert.equal(protagonistView.placedActions[0].cardId, "hidden");
  assert.equal(protagonistView.placedActions[0].targetType, TARGET_TYPES.CHARACTER);
  assert.equal(protagonistView.placedActions[0].targetId, "girl_student");
  assert.equal(
    protagonistView.eventLog.some(
      (event) => event.type === "action_placed" && event.message.includes("女学生"),
    ),
    true,
  );
  assert.equal(
    protagonistView.eventLog.some((event) => event.type === "action_placed_detail"),
    false,
  );
});

test("protagonist action cards default to fixed green red blue order", () => {
  let state = createGame();
  state.phase = PHASES.PROTAGONIST_ACTION;

  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    cardId: "goodwill_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    cardId: "paranoia_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    cardId: "paranoia_minus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "idol",
  });

  assert.deepEqual(
    state.placedActions.map((action) => action.deckId),
    ["green", "red", "blue"],
  );
});

test("protagonist action cards are tracked per colored deck", () => {
  let state = createGame();
  state.phase = PHASES.PROTAGONIST_ACTION;

  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "green",
    cardId: "goodwill_plus_2",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "red",
    cardId: "goodwill_plus_2",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "blue",
    cardId: "goodwill_plus_2",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "idol",
  });

  state = advancePhase(state);
  const protagonistDiscards = actionDiscardPiles(state)[SIDES.PROTAGONIST];

  assert.equal(state.board.characters.boy_student.goodwill, 2);
  assert.equal(state.board.characters.girl_student.goodwill, 2);
  assert.equal(state.board.characters.idol.goodwill, 2);
  assert.deepEqual(
    protagonistDiscards.map((card) => `${card.deckId}:${card.cardId}`),
    ["green:goodwill_plus_2", "red:goodwill_plus_2", "blue:goodwill_plus_2"],
  );
});

test("legal action targets remove occupied and dead characters before placement", () => {
  let state = startMastermindAction();
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "move_vertical",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });

  const mastermindTargets = listLegalTargets(state, SIDES.MASTERMIND, "paranoia_plus_1");
  assert.equal(mastermindTargets.some((target) => target.targetId === "girl_student"), false);

  state.board.characters.boy_student.alive = false;
  const protagonistTargets = listLegalTargets(state, SIDES.PROTAGONIST, "goodwill_plus_1");
  assert.equal(protagonistTargets.some((target) => target.targetId === "boy_student"), false);
  assert.throws(() =>
    placeAction(state, {
      side: SIDES.PROTAGONIST,
      cardId: "goodwill_plus_1",
      targetType: TARGET_TYPES.CHARACTER,
      targetId: "boy_student",
    }),
  );
});

test("used mastermind ability actors leave the available actor list", () => {
  let state = createGame();
  state.phase = PHASES.MASTERMIND_ABILITY;

  assert.equal(
    availableMastermindAbilityActors(state).some((character) => character.id === "doctor"),
    true,
  );

  state = useMastermindAbility(state, {
    actorId: "doctor",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "hospital",
  });

  assert.equal(
    availableMastermindAbilityActors(state).some((character) => character.id === "doctor"),
    false,
  );
});

test("mastermind can use doctor goodwill ability when doctor has goodwill-refusal trait", () => {
  let state = createGame();
  state.phase = PHASES.MASTERMIND_ABILITY;
  state.board.characters.doctor.locationId = "school";

  const doctorAbilities = availableMastermindAbilities(state).filter(
    (ability) => ability.actorId === "doctor",
  );
  assert.equal(
    doctorAbilities.some((ability) => ability.abilityId === "doctor_adjust_paranoia"),
    true,
  );

  state = useMastermindAbility(state, {
    actorId: "doctor",
    abilityId: "doctor_adjust_paranoia",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
    option: "add_paranoia",
  });

  assert.equal(state.board.characters.boy_student.paranoia, 1);
  assert.equal(
    availableMastermindAbilityActors(state).some((character) => character.id === "doctor"),
    false,
  );
});

test("protagonist ability availability ignores whether the target token would change", () => {
  let state = createGame();
  state.phase = PHASES.PROTAGONIST_ABILITY;
  state.board.characters.boy_student.goodwill = 2;
  state.board.characters.girl_student.paranoia = 0;

  const ability = availableProtagonistAbilities(state).find(
    (candidate) => candidate.actorId === "boy_student" && candidate.skillId === "student_reduce_paranoia",
  );
  assert.ok(ability);
  assert.equal(ability.targets.some((target) => target.targetId === "girl_student"), true);

  state = requestProtagonistAbility(state, {
    actorId: "boy_student",
    skillId: "student_reduce_paranoia",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });

  assert.equal(state.pendingDecision, null);
  assert.equal(state.board.characters.girl_student.paranoia, 0);
  assert.equal(
    availableProtagonistAbilities(state).some(
      (candidate) => candidate.actorId === "boy_student" && candidate.skillId === "student_reduce_paranoia",
    ),
    false,
  );
});

test("protagonist abilities on goodwill-refusal roles wait for mastermind approval", () => {
  let state = createGame();
  state.phase = PHASES.PROTAGONIST_ABILITY;
  state.board.characters.doctor.goodwill = 2;
  state.board.characters.doctor.locationId = "school";

  state = requestProtagonistAbility(state, {
    actorId: "doctor",
    skillId: "doctor_adjust_paranoia",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
    option: "add_paranoia",
  });

  assert.equal(state.pendingDecision?.type, "protagonist_ability_approval");
  assert.equal(state.board.characters.boy_student.paranoia, 0);

  state = respondProtagonistAbility(state, { approved: true });

  assert.equal(state.pendingDecision, null);
  assert.equal(state.board.characters.boy_student.paranoia, 1);
});

test("multiple forbid intrigue cards all become ineffective", () => {
  let state = startMastermindAction();
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "intrigue_plus_1",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "hospital",
  });
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "paranoia_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "doctor",
  });
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "move_vertical",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });
  state = advancePhase(state);
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "green",
    cardId: "forbid_intrigue",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "hospital",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "red",
    cardId: "forbid_intrigue",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "school",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "blue",
    cardId: "goodwill_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
  });

  state = advancePhase(state);

  assert.equal(state.board.locations.hospital.intrigue, 1);
  assert.equal(
    state.eventLog.some((event) => event.type === "forbid_intrigue_overloaded"),
    true,
  );
});

test("single forbid intrigue card prevents intrigue on its target", () => {
  let state = startMastermindAction();
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "intrigue_plus_1",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "hospital",
  });
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "paranoia_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "doctor",
  });
  state = placeAction(state, {
    side: SIDES.MASTERMIND,
    cardId: "move_vertical",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "girl_student",
  });
  state = advancePhase(state);
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "green",
    cardId: "forbid_intrigue",
    targetType: TARGET_TYPES.LOCATION,
    targetId: "hospital",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "red",
    cardId: "goodwill_plus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "boy_student",
  });
  state = placeAction(state, {
    side: SIDES.PROTAGONIST,
    deckId: "blue",
    cardId: "paranoia_minus_1",
    targetType: TARGET_TYPES.CHARACTER,
    targetId: "doctor",
  });

  state = advancePhase(state);

  assert.equal(state.board.locations.hospital.intrigue, 0);
});

test("serial killers at the same timing resolve simultaneously", () => {
  let state = createGame();
  state.phase = PHASES.END_OF_DAY;
  state.board.characters.boy_student.roleId = ROLE_IDS.SERIAL_KILLER;
  state.board.characters.girl_student.roleId = ROLE_IDS.SERIAL_KILLER;
  state.board.characters.boy_student.locationId = "school";
  state.board.characters.girl_student.locationId = "school";
  for (const character of Object.values(state.board.characters)) {
    if (!["boy_student", "girl_student"].includes(character.id)) {
      character.alive = false;
    }
  }

  state = advancePhase(state);

  assert.equal(state.board.characters.boy_student.alive, false);
  assert.equal(state.board.characters.girl_student.alive, false);
});

test("day-one tutorial line can fail the loop via serial killer", () => {
  let state = createGame();
  state = placeFirstLoopDayOneFailure(state);

  state = advancePhase(state);
  assert.equal(state.board.characters.girl_student.locationId, "shrine");
  assert.equal(state.board.characters.office_worker.intrigue, 1);

  state = advancePhase(state);
  state = advancePhase(state);
  state = advancePhase(state);
  state = advancePhase(state);

  assert.equal(state.status, "loop_failed");
  assert.equal(state.phase, "loop_end");
  assert.equal(state.board.characters.girl_student.alive, false);
  assert.equal(state.eventLog.some((event) => event.type === "loop_failed"), true);
});

test("starting the next loop resets board state but keeps log history", () => {
  let state = createGame();
  state = placeFirstLoopDayOneFailure(state);
  state = advancePhase(state);
  state = advancePhase(state);
  state = advancePhase(state);
  state = advancePhase(state);
  state = advancePhase(state);

  const failedLogLength = state.eventLog.length;
  state = startNextLoop(state);

  assert.equal(state.loop, 2);
  assert.equal(state.day, 1);
  assert.equal(state.status, "active");
  assert.equal(state.board.characters.girl_student.alive, true);
  assert.equal(state.board.characters.girl_student.locationId, "school");
  assert.equal(state.eventLog.length > failedLogLength, true);
});

test("day-three suicide incident fails the loop when paranoia reaches threshold", () => {
  let state = createGame();
  state.day = 3;
  state.phase = "incident";
  state.board.characters.girl_student.goodwill = 1;
  state.board.characters.girl_student.paranoia = 3;
  state.board.characters.girl_student.intrigue = 2;

  state = advancePhase(state);

  assert.equal(state.status, "loop_failed");
  assert.equal(state.phase, "loop_end");
  assert.equal(state.board.characters.girl_student.alive, false);
  assert.equal(state.board.characters.girl_student.goodwill, 1);
  assert.equal(state.board.characters.girl_student.paranoia, 3);
  assert.equal(state.board.characters.girl_student.intrigue, 2);
});

test("final guesses decide the winner after all loops fail", () => {
  let state = createGame();
  state.loop = 3;
  state.day = 3;
  state.phase = "incident";
  state.board.characters.girl_student.paranoia = 3;
  state = advancePhase(state);

  assert.equal(state.status, "final_guess");

  const guesses = {
    boy_student: ROLE_IDS.CIVILIAN,
    girl_student: ROLE_IDS.KEY_PERSON,
    shrine_maiden: ROLE_IDS.SERIAL_KILLER,
    office_worker: ROLE_IDS.KILLER,
    idol: ROLE_IDS.RUMOR_MONGER,
    doctor: ROLE_IDS.MASTERMIND,
  };

  state = submitFinalGuesses(state, guesses);
  assert.equal(state.status, "finished");
  assert.equal(state.winner, SIDES.PROTAGONIST);
});
