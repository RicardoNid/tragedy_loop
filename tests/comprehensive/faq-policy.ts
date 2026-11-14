// Indexes are pinned to immutable FAQ ids/content in fixtures/faq-index.json.
// A linked test proves its stated assertions, not every possible interpretation of a FAQ.
export const inherited: { faq: number[]; test: string }[] = [
  {
    faq: [22, 70],
    test: 'BTX complete failed loop reaches final guesses; a wrong guess loses and correct guesses win',
  },
  {
    faq: [49, 51, 52, 222],
    test: 'simultaneous serial killers cannot cancel one another by execution order',
  },
  { faq: [50], test: 'immortality prevents guard consumption and actual death triggers' },
  {
    faq: [60],
    test: 'optional refusal consumes no use; an accepted no-op consumes the ability once',
  },
  {
    faq: [306],
    test: 'Q2: established hospital batch kills everyone before loop interruption, fool completion still fires',
  },
  { faq: [307], test: 'Q2: interrupted horrific murder does not run spread or fool completion' },
  {
    faq: [275, 276, 461, 462],
    test: 'LL fifth death is checked only in day-end, and final-plan hope disables traitors',
  },
  {
    faq: [465],
    test: 'LL sixth communication wins before ability effects; refusal never registers communication',
  },
  {
    faq: [287, 288, 472, 473],
    test: 'LL key reveal on the final day schedules same-day mandatory death, not next-loop restrictions',
  },
  { faq: [289, 474], test: 'LL private roles are visible only to their owner' },
  {
    faq: [290, 475],
    test: 'explicit goodwill incident thresholds override AI total-counter substitution',
  },
];
export const nonRuntime = [
  23, 24, 25, 26, 27, 100, 267, 313, 325, 326, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362,
  363, 364, 365, 455, 456, 477, 478,
];
export const unsupported = [96, 97, 98, 99, 101];
export const manual = [28];
export const limits: Record<number, string> = {
  28: 'FAQ要求实体角色牌在时之缝隙讨论后放置。当前数字会话在讨论阶段已含初始角色；实体摆放不由内核执行，UI准备阶段的显示时点待人类确认，不能标记为通过。',
};
