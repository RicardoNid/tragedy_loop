// One-time import helper for the pinned upstream JSONC files downloaded during verification.
import fs from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const directory = 'products/engine/tutorials/sources';
const translate = {
  boyStudent: '男学生',
  girlStudent: '女学生',
  richStudent: '大小姐',
  shrineMaiden: '巫女',
  policeOfficer: '刑警',
  officeWorker: '职员',
  doctor: '医生',
  popIdol: '偶像',
  patient: '住院患者',
  teacher: '教师',
  alien: '异界人',
  classRep: '班长',
  journalist: '媒体人',
  partTimer: '临时工',
  soldier: '军人',
  person: '平民',
  keyPerson: '关键人物',
  killer: '杀手',
  brain: '主谋',
  conspiracyTheorist: '传谣人',
  serialKiller: '杀人狂',
  friend: '亲友',
  obstinate: '强迫症',
  factor: '不安定因子',
  ninja: '忍者',
  fool: '愚者',
  twin: '双胞胎',
  paranoiac: '偏执狂',
  witch: '魔女',
  ghost: '鬼魂',
  coward: '胆小鬼',
  showOff: '纸老虎',
  wizard: '巫师',
  deepOne: '深潜者',
  alice: '爱丽丝',
  marionetteAHR: '提线木偶',
  murderPlan: '谋杀计划',
  shadowRipper: '开膛者的魔影',
  signWithMe: '和我签订契约吧！',
  unsettlingRumor: '流言四起',
  hiddenFreak: '潜伏的杀人狂',
  maleConfrontation: '男子汉的战争',
  unsafeTrigger: 'X异因子',
  loveHateSpiral: '爱与恨的螺旋',
  blackSchool: '黑暗学园',
  trickyTwins: '双子的诡计',
  danceFools: '愚者之舞',
  cursedLand: '被诅咒的土地',
  panicObsession: '恐慌与妄想',
  keyGirl: '少女大危机',
  giantTimeBombAgain: '巨大定时炸弹Y',
  resistance: '抗争者',
  intoNothingness: '虚幻世界',
  jekyllHyde: '化身博士',
  throughLookingGlass: '爱丽丝梦游仙境',
  suicide: '自杀',
  increasingUnease: '不安扩散',
  hospitalIncident: '医院事故',
  missingPerson: '失踪',
  confession: '自白',
  portent: '前兆',
  silverBullet: '银色子弹',
  serialMurder: '连续杀人',
  sacrilegiousMurder: '亵渎杀人',
  evangeliumDead: '死者默示录',
  evilContamination: '邪气污染',
  insaneMurder: '疯狂杀人',
  lastWill: '遗言',
  crimePassion: '冲动杀人',
};
const selections = [
  ['FS', 'base-game', 'The First Script (NT)'],
  ['BTX', 'base-game', "Magical Girls' Superiority"],
  ['MZ', 'midnight-circle', 'Romance Antithesis'],
  ['MC', 'midnight-circle', 'Obsession Detection'],
  ['HSA', 'cosmic-evil', 'Master Thief Seven Tails'],
  ['WM', 'cosmic-evil', 'Banquet School Life'],
  ['AHR', 'rei', 'Beyond Praying Stage'],
];
const tr = (x) => {
  if (!translate[x]) throw Error(`Missing translation: ${x}`);
  return translate[x];
};
const fixtures = selections.map(([module, file, title]) => {
  const raw = fs.readFileSync(`${directory}/${file}.jsonc`, 'utf8');
  const s = ts.parseConfigFileTextToJson(file, raw).config.scripts.find((s) => s.title === title);
  const setup = {
    module,
    anniversary: false,
    loops: s.difficultySets[0].numberOfLoops,
    days: s.daysPerLoop,
    captain: 'p0',
    discussion: 'between-loops',
    y: tr(s.mainPlot[0]),
    x: s.subPlots.map(tr),
    characters: Object.entries(s.cast).map(([id, role]) => {
      const [identity, reverse] = role.split('|');
      return {
        id,
        character: tr(id),
        identity: tr(identity),
        ...(reverse ? { reverseIdentity: tr(reverse) } : {}),
      };
    }),
    incidents: s.incidents.map((i) => ({
      day: i.day,
      name: tr(i.incident),
      culprit: i.culprit === 'School' ? 'school' : i.culprit,
    })),
  };
  const notes = [];
  if (module === 'MZ') {
    setup.incidents[1].day = 3;
    notes.push(
      'Upstream duplicates day 4. Midnight Circle Mastermind Handbook p6 explicitly identifies Office Worker confession as day 3; corrected only in this fixture.',
    );
  }
  if (module === 'FS')
    notes.push(
      'Cross-checked against official quickset/script_sheet(a5).pdf page 1. Uses 3-day NT/5th version.',
    );
  if (module === 'AHR')
    notes.push(
      'Uses 3-loop upstream variant; local wiki lists 4/3. Part Timer replacement is created by engine, not an extra cast member.',
    );
  return {
    id: `${module}-01G`,
    title,
    source: {
      url: `https://raw.githubusercontent.com/tragedy-looper/tragedy-looper.github.io/master/data/${file}/scripts.jsonc`,
      sha256: createHash('sha256').update(raw).digest('hex'),
      notes,
    },
    setup,
  };
});
fixtures.push({
  id: 'LL-01G',
  title: 'Pervasive Secrets',
  source: {
    url: 'https://docs.google.com/document/d/1P_y7dkyrjB36DprpQmHRK6zT72oKo7izW1Jrx3knToU/edit',
    modified: '2021-12-21T11:48:29.794Z',
    notes: [
      'Official sample 1, English fan translation linked from Last Liar Rulebook p18. Private role permutation is recorded host input.',
    ],
  },
  setup: {
    module: 'LL',
    anniversary: false,
    loops: 3,
    days: 5,
    captain: 'p0',
    discussion: 'between-loops',
    privateRoles: { p0: 'A', p1: 'B', p2: 'C' },
    y: '巨大定时炸弹Z',
    x: ['神话收集者', '捏造的秘密'],
    characters: [
      ['girlStudent', '女学生', '平民'],
      ['classRep', '班长', '平民'],
      ['teacher', '教师', '魔女'],
      ['alien', '异界人', '网络名流'],
      ['god', '神灵', '密钥'],
      ['denizen', '上位存在', '传谣人'],
      ['officeWorker', '职员', '怪杰'],
      ['informer', '情报商', '平民'],
      ['popIdol', '偶像', '主谋'],
      ['soldier', '军人', '平民'],
    ].map(([id, character, identity]) => ({
      id,
      character,
      identity,
      ...(id === 'god' ? { enterLoop: 3 } : {}),
    })),
    incidents: [
      { day: 2, name: '骤变', culprit: 'alien' },
      { day: 3, name: '代行者', culprit: 'officeWorker' },
      { day: 4, name: '不安扩散', culprit: 'classRep' },
      { day: 5, name: '失踪', culprit: 'informer' },
    ],
  },
});
fs.mkdirSync('tests/engine/fixtures', { recursive: true });
fs.writeFileSync(
  'tests/engine/fixtures/official-scenarios.json',
  JSON.stringify(fixtures, null, 2) + '\n',
);
