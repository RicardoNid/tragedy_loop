import test from "node:test";
import assert from "node:assert/strict";

import { PHASES, ROLE_IDS, SIDES, TARGET_TYPES, VIEWERS } from "./data.mjs";
import {
  actionLimit,
  advancePhase,
  availableMastermindAbilityActors,
  createGame,
  listLegalTargets,
  placeAction,
  projectView,
  startNextLoop,
  submitFinalGuesses,
  useMastermindAbility,
} from "./engine.mjs";

function placeFirstLoopDayOneFailure(state) {
  let next = state;
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

test("legal action targets remove occupied and dead characters before placement", () => {
  let state = createGame();
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
  state.board.characters.girl_student.paranoia = 3;

  state = advancePhase(state);

  assert.equal(state.status, "loop_failed");
  assert.equal(state.phase, "loop_end");
  assert.equal(state.board.characters.girl_student.alive, false);
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
