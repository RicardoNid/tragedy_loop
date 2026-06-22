export const SIDES = {
  MASTERMIND: "mastermind",
  PROTAGONIST: "protagonist",
};

export const PROTAGONIST_DECKS = [
  { id: "green", name: "绿色", shortName: "绿", color: "#2e7d58" },
  { id: "red", name: "红色", shortName: "红", color: "#9f3441" },
  { id: "blue", name: "蓝色", shortName: "蓝", color: "#315b88" },
];

export const VIEWERS = {
  MASTERMIND: "mastermind",
  PROTAGONISTS: "protagonists",
};

export const TARGET_TYPES = {
  CHARACTER: "character",
  LOCATION: "location",
};

export const PHASES = {
  DAWN: "dawn",
  MASTERMIND_ACTION: "mastermind_action",
  PROTAGONIST_ACTION: "protagonist_action",
  ACTION_RESOLUTION: "action_resolution",
  MASTERMIND_ABILITY: "mastermind_ability",
  PROTAGONIST_ABILITY: "protagonist_ability",
  INCIDENT: "incident",
  LEADER_ROTATION: "leader_rotation",
  END_OF_DAY: "end_of_day",
  LOOP_END: "loop_end",
  FINAL_GUESS: "final_guess",
  FINISHED: "finished",
};

export const LOCATION_IDS = {
  HOSPITAL: "hospital",
  SHRINE: "shrine",
  CITY: "city",
  SCHOOL: "school",
};

export const ROLE_IDS = {
  CIVILIAN: "civilian",
  KEY_PERSON: "key_person",
  MASTERMIND: "mastermind_role",
  KILLER: "killer",
  CULTIST: "cultist",
  SERIAL_KILLER: "serial_killer",
  RUMOR_MONGER: "rumor_monger",
};

export const locations = {
  [LOCATION_IDS.HOSPITAL]: {
    id: LOCATION_IDS.HOSPITAL,
    name: "医院",
    x: 0,
    y: 0,
  },
  [LOCATION_IDS.SHRINE]: {
    id: LOCATION_IDS.SHRINE,
    name: "神社",
    x: 1,
    y: 0,
  },
  [LOCATION_IDS.CITY]: {
    id: LOCATION_IDS.CITY,
    name: "都市",
    x: 0,
    y: 1,
  },
  [LOCATION_IDS.SCHOOL]: {
    id: LOCATION_IDS.SCHOOL,
    name: "学校",
    x: 1,
    y: 1,
  },
};

export const roles = {
  [ROLE_IDS.CIVILIAN]: {
    id: ROLE_IDS.CIVILIAN,
    name: "平民",
    traits: [],
    summary: "没有隐藏能力。",
  },
  [ROLE_IDS.KEY_PERSON]: {
    id: ROLE_IDS.KEY_PERSON,
    name: "关键人物",
    traits: [],
    summary: "该角色死亡时，主人公当前轮回立即失败。",
  },
  [ROLE_IDS.MASTERMIND]: {
    id: ROLE_IDS.MASTERMIND,
    name: "主谋",
    traits: ["无视友好"],
    summary: "剧作家能力阶段，可向同区域角色或所在版图放置 1 枚密谋。",
  },
  [ROLE_IDS.KILLER]: {
    id: ROLE_IDS.KILLER,
    name: "杀手",
    traits: ["无视友好"],
    summary: "回合结束时，可因密谋杀害关键人物；自身密谋 4 枚以上时可杀害主人公。",
  },
  [ROLE_IDS.CULTIST]: {
    id: ROLE_IDS.CULTIST,
    name: "邪教徒",
    traits: ["强制无视友好"],
    summary: "行动结算阶段，无视同一区域中角色身上和该角色所在版图上的禁止密谋卡牌。",
  },
  [ROLE_IDS.SERIAL_KILLER]: {
    id: ROLE_IDS.SERIAL_KILLER,
    name: "杀人狂",
    traits: [],
    summary: "回合结束时，若同区域仅有 1 名其他角色，那名角色死亡。",
  },
  [ROLE_IDS.RUMOR_MONGER]: {
    id: ROLE_IDS.RUMOR_MONGER,
    name: "传谣人",
    traits: [],
    summary: "剧作家能力阶段，可向同区域角色放置 1 枚不安。",
  },
};

export const actionCards = {
  move_vertical: {
    id: "move_vertical",
    name: "移动上下",
    sideNames: { mastermind: "移动上下", protagonist: "移动上下" },
    effect: "move",
    movement: "vertical",
    targetTypes: [TARGET_TYPES.CHARACTER],
  },
  move_horizontal: {
    id: "move_horizontal",
    name: "移动左右",
    sideNames: { mastermind: "移动左右", protagonist: "移动左右" },
    effect: "move",
    movement: "horizontal",
    targetTypes: [TARGET_TYPES.CHARACTER],
  },
  move_diagonal: {
    id: "move_diagonal",
    name: "斜向移动",
    sideNames: { mastermind: "斜向移动" },
    effect: "move",
    movement: "diagonal",
    targetTypes: [TARGET_TYPES.CHARACTER],
    oncePerLoop: true,
  },
  forbid_movement: {
    id: "forbid_movement",
    name: "禁止移动",
    sideNames: { protagonist: "禁止移动" },
    effect: "forbid_movement",
    targetTypes: [TARGET_TYPES.CHARACTER],
    oncePerLoopBySide: { protagonist: true },
  },
  goodwill_plus_1: {
    id: "goodwill_plus_1",
    name: "友好 +1",
    sideNames: { protagonist: "友好 +1" },
    effect: "token",
    token: "goodwill",
    amount: 1,
    targetTypes: [TARGET_TYPES.CHARACTER],
  },
  goodwill_plus_2: {
    id: "goodwill_plus_2",
    name: "友好 +2",
    sideNames: { protagonist: "友好 +2" },
    effect: "token",
    token: "goodwill",
    amount: 2,
    targetTypes: [TARGET_TYPES.CHARACTER],
    oncePerLoop: true,
  },
  forbid_goodwill: {
    id: "forbid_goodwill",
    name: "禁止友好",
    sideNames: { mastermind: "禁止友好" },
    effect: "forbid_token",
    token: "goodwill",
    targetTypes: [TARGET_TYPES.CHARACTER],
  },
  paranoia_plus_1: {
    id: "paranoia_plus_1",
    name: "不安 +1",
    sideNames: { mastermind: "不安 +1", protagonist: "不安 +1" },
    effect: "token",
    token: "paranoia",
    amount: 1,
    targetTypes: [TARGET_TYPES.CHARACTER],
  },
  paranoia_minus_1: {
    id: "paranoia_minus_1",
    name: "不安 -1",
    sideNames: { mastermind: "不安 -1", protagonist: "不安 -1" },
    effect: "token",
    token: "paranoia",
    amount: -1,
    targetTypes: [TARGET_TYPES.CHARACTER],
    oncePerLoopBySide: { protagonist: true },
  },
  forbid_paranoia: {
    id: "forbid_paranoia",
    name: "禁止不安",
    sideNames: { mastermind: "禁止不安" },
    effect: "forbid_token",
    token: "paranoia",
    targetTypes: [TARGET_TYPES.CHARACTER],
  },
  intrigue_plus_1: {
    id: "intrigue_plus_1",
    name: "密谋 +1",
    sideNames: { mastermind: "密谋 +1" },
    effect: "token",
    token: "intrigue",
    amount: 1,
    targetTypes: [TARGET_TYPES.CHARACTER, TARGET_TYPES.LOCATION],
  },
  intrigue_plus_2: {
    id: "intrigue_plus_2",
    name: "密谋 +2",
    sideNames: { mastermind: "密谋 +2" },
    effect: "token",
    token: "intrigue",
    amount: 2,
    targetTypes: [TARGET_TYPES.CHARACTER, TARGET_TYPES.LOCATION],
    oncePerLoop: true,
  },
  forbid_intrigue: {
    id: "forbid_intrigue",
    name: "禁止密谋",
    sideNames: { protagonist: "禁止密谋" },
    effect: "forbid_token",
    token: "intrigue",
    targetTypes: [TARGET_TYPES.CHARACTER, TARGET_TYPES.LOCATION],
  },
};

export const hands = {
  [SIDES.MASTERMIND]: [
    { cardId: "move_vertical", quantity: 1 },
    { cardId: "move_horizontal", quantity: 1 },
    { cardId: "move_diagonal", quantity: 1 },
    { cardId: "forbid_goodwill", quantity: 1 },
    { cardId: "paranoia_plus_1", quantity: 2 },
    { cardId: "paranoia_minus_1", quantity: 1 },
    { cardId: "forbid_paranoia", quantity: 1 },
    { cardId: "intrigue_plus_1", quantity: 1 },
    { cardId: "intrigue_plus_2", quantity: 1 },
  ],
  [SIDES.PROTAGONIST]: [
    { cardId: "move_vertical", quantity: 1 },
    { cardId: "move_horizontal", quantity: 1 },
    { cardId: "forbid_movement", quantity: 1 },
    { cardId: "goodwill_plus_1", quantity: 1 },
    { cardId: "goodwill_plus_2", quantity: 1 },
    { cardId: "paranoia_plus_1", quantity: 1 },
    { cardId: "paranoia_minus_1", quantity: 1 },
    { cardId: "forbid_intrigue", quantity: 1 },
  ],
};

export const beginnerScript = {
  id: "beginner-first-steps",
  name: "初学者剧本",
  moduleName: "First Steps",
  loops: 3,
  daysPerLoop: 3,
  finalGuess: false,
  protagonistCount: 1,
  actionSlots: {
    [SIDES.MASTERMIND]: 3,
    [SIDES.PROTAGONIST]: 3,
  },
  notes: [
    "角色初始区域来自当前项目资料的可运行默认布局，仍需用纸质角色牌校对。",
    "第一版规则核心覆盖新手剧本闭环，暂不实现完整友好能力库。",
  ],
  publicInfo: {
    incidents: [{ day: 3, incidentId: "suicide", name: "自杀" }],
    rules: ["Rule Y：谋杀计划", "Rule X：开膛者的魔影"],
  },
  closedInfo: {
    ruleY: "谋杀计划",
    ruleX: ["开膛者的魔影"],
  },
  characters: [
    {
      id: "boy_student",
      name: "男学生",
      roleId: ROLE_IDS.CIVILIAN,
      initialLocationId: LOCATION_IDS.SCHOOL,
      paranoiaLimit: 2,
      goodwillLimit: 2,
      attributes: ["学生", "少年"],
      forbiddenLocationIds: [],
      publicTraits: [],
      skills: [
        {
          id: "student_reduce_paranoia",
          name: "学生的安抚",
          requiredGoodwill: 2,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "选择同一区域的另一名学生；若其身上有不安，移除 1 枚。",
        },
      ],
    },
    {
      id: "girl_student",
      name: "女学生",
      roleId: ROLE_IDS.KEY_PERSON,
      initialLocationId: LOCATION_IDS.SCHOOL,
      paranoiaLimit: 3,
      goodwillLimit: 2,
      attributes: ["学生", "少女"],
      forbiddenLocationIds: [],
      publicTraits: [],
      skills: [
        {
          id: "student_reduce_paranoia",
          name: "学生的安抚",
          requiredGoodwill: 2,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "选择同一区域的另一名学生；若其身上有不安，移除 1 枚。",
        },
      ],
    },
    {
      id: "shrine_maiden",
      name: "巫女",
      roleId: ROLE_IDS.SERIAL_KILLER,
      initialLocationId: LOCATION_IDS.SHRINE,
      paranoiaLimit: 2,
      goodwillLimit: 5,
      attributes: ["少女"],
      forbiddenLocationIds: [LOCATION_IDS.CITY],
      publicTraits: ["不能进入都市。"],
      skills: [
        {
          id: "shrine_remove_intrigue",
          name: "净化神社",
          requiredGoodwill: 3,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "仅当巫女在神社时可用；若神社有密谋，移除 1 枚。",
        },
        {
          id: "shrine_reveal_role",
          name: "神谕",
          requiredGoodwill: 5,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: true,
          frequency: "per_loop",
          effect: "选择同一区域任意 1 名角色；剧作家告知其身份。",
        },
      ],
    },
    {
      id: "office_worker",
      name: "职员",
      roleId: ROLE_IDS.KILLER,
      initialLocationId: LOCATION_IDS.CITY,
      paranoiaLimit: 2,
      goodwillLimit: 3,
      attributes: ["成人"],
      forbiddenLocationIds: [LOCATION_IDS.SCHOOL],
      publicTraits: ["不能进入学校。"],
      skills: [
        {
          id: "worker_reveal_self",
          name: "自我介绍",
          requiredGoodwill: 3,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "声明使用能力；剧作家告知职员的身份。",
        },
      ],
    },
    {
      id: "idol",
      name: "偶像",
      roleId: ROLE_IDS.RUMOR_MONGER,
      initialLocationId: LOCATION_IDS.CITY,
      paranoiaLimit: 2,
      goodwillLimit: 4,
      attributes: ["少女"],
      forbiddenLocationIds: [],
      publicTraits: [],
      skills: [
        {
          id: "idol_reduce_paranoia",
          name: "鼓舞",
          requiredGoodwill: 3,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "选择同一区域的另一名角色；若其身上有不安，移除 1 枚。",
        },
        {
          id: "idol_add_goodwill",
          name: "声援",
          requiredGoodwill: 4,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "选择同一区域的另一名角色；在其身上放置 1 枚友好。",
        },
      ],
    },
    {
      id: "doctor",
      name: "医生",
      roleId: ROLE_IDS.MASTERMIND,
      initialLocationId: LOCATION_IDS.HOSPITAL,
      paranoiaLimit: 2,
      goodwillLimit: 3,
      attributes: ["成人"],
      forbiddenLocationIds: [],
      publicTraits: [],
      skills: [
        {
          id: "doctor_adjust_paranoia",
          name: "诊疗",
          requiredGoodwill: 2,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          additionalUsers: [
            {
              side: SIDES.MASTERMIND,
              timing: "剧作家能力阶段",
              condition: "若医生已有 2 枚或以上友好，且身份具有无视友好或必定无视友好特性。",
            },
          ],
          oncePerLoop: false,
          frequency: "per_day",
          effect:
            "选择同一区域的另一名角色，并声明移除或放置不安；剧作家按声明移除或放置 1 枚不安。若医生已有 2 枚或以上友好且身份具备无视友好，剧作家能力阶段也可使用此能力。",
        },
        {
          id: "doctor_patient_mobility",
          name: "出院许可",
          requiredGoodwill: 3,
          timing: "主人公能力阶段",
          usableBy: [SIDES.PROTAGONIST],
          oncePerLoop: false,
          frequency: "per_day",
          effect: "声明使用能力；本轮中，住院患者不再拥有禁行区域。",
        },
      ],
    },
  ],
  incidents: [
    {
      id: "day3_suicide",
      day: 3,
      incidentId: "suicide",
      name: "自杀",
      culpritId: "girl_student",
    },
  ],
};

export function getScript(scriptId = beginnerScript.id) {
  if (scriptId !== beginnerScript.id) {
    throw new Error(`Unknown script: ${scriptId}`);
  }
  return beginnerScript;
}
