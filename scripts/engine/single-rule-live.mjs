// Feed a short, local, public observation window directly to the production solver.
export function abilityWindows({ pack, row, LiveKnowledge, project, state, card, sourceEntry }) {
  for (const [name, def] of Object.entries(pack.characters)) {
    const entries = sourceEntry('characters', name).fields['友好能力'] ?? [];
    for (const [index, ability] of def.abilities
      .filter((a) => a.threshold !== undefined)
      .entries()) {
      {
        const n = entries[index].threshold;
        const label = entries[index].text;
        // A declaration has to be legal even if its effect and all later choices are still unknown.
        row(
          '即时声明检查',
          name,
          label + ' · 差一枚',
          '独立声明 ' + ability.id + '；友好 ' + (n - 1) + '，没有希望、绝望或代为发动。',
          () => {
            const s = state('discussion');
            card(s, 'a', name === '临时工？' ? '临时工' : name);
            const owner = name === '临时工？' ? 'a_replacement' : 'a';
            const duplicate = Object.values(s.characters).find(
              (c) => c.id !== 'a' && c.character === name && name !== '临时工？',
            );
            if (duplicate) card(s, duplicate.id, '职员');
            const peer = s.characters.b;
            s.characters[owner].counters.goodwill = n - 1;
            const second = ['局外人', '模仿犯'].includes(name);
            const area =
              name === '巫女' ? 'shrine' : name === '大小姐' ? 'school' : s.characters.a.area;
            for (const c of Object.values(s.characters)) c.area = area;
            peer.counters.paranoia = 3;
            peer.counters.intrigue = 1;
            const opening = project(s, 'protagonists');
            if (name === '转校生' || name === '神灵') {
              // Isolate the threshold after a previously identified character arrives.
              opening.roster = s.setup.characters.map(({ id, character }) => ({ id, character }));
              opening.characters = opening.characters.filter((c) => c.id !== 'a');
            }

            if (name === 'AI' || name === '刑警' || name === '神灵')
              opening.incidents = [{ day: 1, name: '自杀' }];
            // Only the threshold-negative query has an unconditional answer.
            // The positive counterpart uses an actual history checkpoint elsewhere in this report.

            const k = new LiveKnowledge(pack, opening);
            const obs = [];
            if (name === '转校生' || name === '神灵')
              obs.push({
                type: 'character',
                phase: name === '神灵' ? 'loop-start' : 'day-start',
                data: {
                  character: 'a',
                  area,
                  status: 'alive',
                  counters: s.characters.a.counters,
                },
              });
            if (name === '临时工？')
              obs.push({
                type: 'character',
                phase: 'day-start',
                data: {
                  character: owner,
                  area: 'city',
                  status: 'alive',
                  counters: s.characters[owner].counters,
                },
              });
            // Use own-choice: it records the actor's independent request, excluding delegated abilities.
            obs.push({
              type: 'own-choice',
              phase: 'protagonist-abilities',
              data: { actor: 'p0', choice: { kind: 'ability', owner, ability: ability.id } },
            });
            const before = k.snapshot();
            if (before.status === 'contradiction') throw Error('开局无可用候选');
            k.append(
              obs.map((o, i) => ({
                ...o,
                day: 1,
                loop: second || name === '神灵' ? 2 : 1,
                sequence: i + 1,
              })),
              0,
              1,
            );
            const after = k.snapshot();
            return {
              status:
                after.status === 'contradiction'
                  ? '通过'
                  : after.status === 'unsupported'
                    ? '未决'
                    : '未即时排除',
              history: obs,
              detail:
                '预期独立请求不可能。即时结果 ' +
                after.status +
                '；剩余规则组合 ' +
                after.ruleCombinations.length +
                '，' +
                (after.historySearchDeferred ? '历史搜索未启动。' : '进入历史核验队列。'),
            };
          },
        );
      }
    }
  }
}

// Start through initialize() and follow real player decisions, with no injected counters or phases.
export function legalHistory({
  pack,
  row,
  configs,
  initialize,
  advance,
  project,
  LiveKnowledge,
  HistorySearch,
  normalizeHistory,
  eq,
}) {
  const fs = pack.module === 'FS';
  row(
    '合法开局端到端',
    '男学生',
    '成功使用友好能力排除必定拒绝身份',
    'A 男学生是传谣人，B 与邪教徒交换身份。双方配置都合法；男学生获得 2 友好，成功移除同区女学生的不安。',
    () => {
      const a = configs(
        fs ? '守护此地' : '被封印的邪灵',
        fs ? ['流言四起'] : ['流言四起', '因果线'],
      );
      // Place the two students in school, keep the other two away from it.
      a.characters = ['男学生', '女学生', '医生', '巫女'].map((character, i) => ({
        id: 'abcd'[i],
        character,
        identity: ['传谣人', '平民', '邪教徒', fs ? '关键人物' : '主谋'][i],
      }));
      const b = structuredClone(a);
      b.characters[0].identity = '邪教徒';
      b.characters[2].identity = '传谣人';
      let s = initialize(pack, a).state;
      eq(initialize(pack, b).diagnostics, []);
      const opening = project(s, 'protagonists');
      const k = new LiveKnowledge(pack, opening);
      const placements = {
        mastermind: [
          ['paranoia+1', 'b'],
          ['block-goodwill', 'shrine'],
          ['paranoia-1', 'hospital'],
        ],
        p0: [['goodwill+2', 'a']],
        p1: [['horizontal', 'school']],
        p2: [['vertical', 'city']],
      };
      for (let i = 0; i < 45; i++) {
        const d = s.pending;
        let choice = d.options.find((c) => c.kind === 'pass') ?? d.options[0];
        if (d.kind === 'cards')
          choice = {
            kind: 'cards',
            placements: placements[d.actor].map(([kind, target]) => ({
              card: s.cards.find(
                (c) => c.owner === d.actor && c.kind === kind && c.status === 'hand',
              ).id,
              target,
            })),
          };
        if (d.actor === 'p0' && d.kind === 'ability')
          choice = d.options.find((o) => o.ability === 'student' && o.owner === 'a') ?? choice;
        if (d.kind === 'choice') choice = d.options.find((o) => o.value === 'b') ?? choice;
        const out = advance(pack, s, d.actor, {
          id: 'full-' + i,
          expectedRevision: s.revision,
          decisionId: d.id,
          choice,
        });
        eq(out.status, 'ok');
        s = out.state;
        if (
          s.observations.protagonists.some(
            (o) => o.type === 'declaration' && o.data.ability === 'student',
          )
        )
          break;
      }
      eq(s.characters.b.counters.paranoia, 0);
      const view = project(s, 'protagonists'),
        history = view.observations;
      eq(
        history.some((o) => o.type === 'declaration' && o.data.character === 'a'),
        true,
      );
      k.update(history, view.revision);
      const fast = k.snapshot().identities.a ?? [];
      const evidence = { observations: history, normalized: normalizeHistory(history), version: 1 };
      const results = [a, b].map((config) => {
        const search = new HistorySearch(pack, config, evidence, opening);
        for (let i = 0; i < 15000 && search.result === 'unknown' && !search.blocked; i++)
          search.step();
        return search.result;
      });
      const valid = results.join(',') === 'possible,excluded';
      return {
        status:
          !valid || !fast.includes('传谣人')
            ? '未通过'
            : fast.includes('邪教徒')
              ? '未即时排除'
              : '通过',
        detail:
          '历史搜索 A、B = ' +
          results.join('、') +
          '。即时矩阵 a = ' +
          fast.join('、') +
          '。预期实际成功结算保留传谣人、排除邪教徒。',
        history,
        input: [a, b],
      };
    },
  );
}
