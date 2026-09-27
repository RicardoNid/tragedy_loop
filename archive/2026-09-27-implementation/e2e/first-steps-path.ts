// Fixed choices, independent of the engine and of the currently offered options.
// Changes to these expectations require a rule/UX explanation, not automatic re-recording.
export interface GuiStep {
  day: number;
  seat: string;
  phase: string;
  option: string;
}
export const firstStepsPath: GuiStep[] = [
  { day: 1, seat: 'protagonistA', phase: '开局', option: 'protagonistA' },
  { day: 1, seat: 'protagonistA', phase: '轮回开始', option: 'finish' },
];
const turnOrder = ['protagonistA', 'protagonistB', 'protagonistC'];
const targets = ['doctor', 'male_student', 'female_student'];
for (let day = 1; day <= 4; day++) {
  const leader = turnOrder[(day - 1) % 3]!;
  firstStepsPath.push({ day, seat: leader, phase: '每日开始', option: 'finish' });
  const mastermindCards =
    day === 1
      ? ['intrigue+2:1', 'intrigue+1:2', 'anxiety+1:3']
      : ['intrigue+1:2', 'anxiety+1:3', 'anxiety+1:4'];
  for (let i = 0; i < 3; i++) {
    firstStepsPath.push(
      { day, seat: 'mastermind', phase: '剧作家行动', option: `mastermind:${mastermindCards[i]}` },
      { day, seat: 'mastermind', phase: '剧作家行动', option: `character:${targets[i]}` },
    );
  }
  for (let i = 0; i < 3; i++) {
    const seat = turnOrder[(day - 1 + i) % 3]!;
    firstStepsPath.push(
      { day, seat, phase: '主人公行动', option: `${seat}:goodwill+1:1` },
      { day, seat, phase: '主人公行动', option: `character:${targets[i]}` },
    );
  }
  firstStepsPath.push(
    { day, seat: 'mastermind', phase: '剧作家能力', option: 'finish' },
    { day, seat: leader, phase: '主人公能力', option: 'finish' },
    { day, seat: 'mastermind', phase: '每日结束', option: 'finish' },
  );
}
