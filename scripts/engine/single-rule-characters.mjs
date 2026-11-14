// Each effect oracle describes the selected outcome independently of Ability.steps.
export function goodwillCases(h) {
  const { pack, pair, sourceEntry, role, card, cnt, eq, action } = h;
  const status = (s, id, value) => eq(s.characters[id].status, value);
  const counter = (id, key, n) => (s) => eq(cnt(s, id, key), n);
  const disclosed = (s, type, key, value) =>
    eq(
      s.observations.protagonists.some((o) => o.type === type && o.data[key] === value),
      true,
    );
  const flag = (id, key) => (s) => eq(s.characters[id].flags[key], 'yes');
  const checks = {
    student: counter('b', 'paranoia', 2),
    'rich-girl': counter('b', 'goodwill', 1),
    'idol-paranoia': counter('b', 'paranoia', 2),
    'idol-goodwill': counter('b', 'goodwill', 1),
    'media-paranoia': counter('b', 'paranoia', 4),
    'media-intrigue': counter('b', 'intrigue', 2),
    'soldier-paranoia': counter('b', 'paranoia', 5),
    'soldier-protect': (s) => eq(s.protected, true),
    nurse: counter('b', 'paranoia', 2),
    'office-worker': (s) => disclosed(s, 'identity', 'character', 'a'),
    'shrine-maiden-remove': (s) => eq(s.boards.shrine, 0),
    'shrine-maiden-reveal': (s) => disclosed(s, 'identity', 'character', 'b'),
    'alien-kill': (s) => status(s, 'b', 'dead'),
    'alien-revive': (s) => status(s, 'b', 'alive'),
    servant: (s) => eq(s.characters.a.flags.protect, 'b'),
    'transfer-student': (s) => {
      eq(cnt(s, 'b', 'intrigue'), 0);
      eq(cnt(s, 'b', 'goodwill'), 1);
    },
    'teacher-counter': counter('b', 'paranoia', 4),
    'teacher-reveal': (s) => disclosed(s, 'identity', 'character', 'b'),
    'doctor-counter': counter('b', 'paranoia', 4),
    'doctor-release': flag('c', 'free-movement'),
    'girl-release': flag('a', 'free-movement'),
    'girl-move': (s) => eq(s.characters.a.area, 'city'),
    henchman: flag('a', 'no-incidents'),
    'outsider-reveal': (s) => disclosed(s, 'identity', 'character', 'a'),
    'illusion-move': (s) => eq(s.characters.b.area, 'city'),
    'illusion-remove': (s) => status(s, 'a', 'removed'),
    'detective-incident': (s) => disclosed(s, 'culprit', 'culprit', 'b'),
    'detective-guard': counter('b', 'guard', 1),
    'divinity-incident': (s) => disclosed(s, 'culprit', 'culprit', 'b'),
    'divinity-intrigue': counter('b', 'intrigue', 0),
    'leader-goodwill': counter('b', 'goodwill', 1),
    'leader-reveal': (s) => disclosed(s, 'identity', 'character', 'b'),
    'class-representative': (s) =>
      eq(s.cards.find((c) => c.owner === 'p0' && c.kind === 'goodwill+2').status, 'hand'),
    ai: (s) => {
      status(s, 'a', 'dead');
      eq(s.incidents.length, 0);
    },
    'forensic-transfer': (s) => {
      eq(cnt(s, 'b', 'paranoia'), 2);
      eq(cnt(s, 'c', 'paranoia'), 1);
    },
    'forensic-reveal': (s) => disclosed(s, 'identity', 'character', 'b'),
    'higher-being': counter('b', 'hope', 1),
    'scholar-clear': (s) =>
      eq(
        Object.values(s.characters.a.counters).reduce((a, b) => a + b),
        0,
      ),
    'parttimer-reveal': (s) => {
      disclosed(s, 'identity', 'character', 'a');
      eq(cnt(s, 'b', 'goodwill'), 2);
    },
    'boss-reveal': (s) => disclosed(s, 'identity', 'character', 'b'),
    informant: (s) => disclosed(s, 'rule', 'rule', '流言四起'),
    'immortal-revive': (s) => {
      status(s, 'b', 'alive');
      eq(cnt(s, 'b', 'goodwill'), 2);
    },
    'little-sister': counter('b', 'paranoia', 4),
    'copycat-reveal': (s) => disclosed(s, 'identity', 'sameIdentityAs', 'a'),
    streamer: (s) => {
      eq(cnt(s, 'b', 'paranoia'), 2);
      eq(cnt(s, 'b', 'goodwill'), 1);
    },
  };
  for (const [name, def] of Object.entries(pack.characters)) {
    const fields = sourceEntry('characters', name).fields;
    const entries = fields['友好能力'] ?? [];
    const abilities = def.abilities.filter((a) => a.threshold !== undefined);
    eq(abilities.length, entries.length);
    for (const [i, definition] of entries.entries()) {
      const id = abilities[i].id,
        n = definition.threshold;
      const picks = {
        target: 'b',
        first: 'a',
        direction: 'add',
        counter: 'hope',
        from: 'b',
        to: 'c',
        area: 'city',
        day: '1',
        excluded: '因果线',
        rule: '流言四起',
        transfer: 'no',
        incident: '自杀',
        ability: 'teacher-counter',
      };
      if (id === 'forensic-transfer') picks.counter = 'paranoia';
      if (id === 'little-sister') picks.target = 'c';
      if (id === 'immortal-revive') picks.area = 'school';
      function setup(s) {
        card(s, 'a', name);
        for (const c of Object.values(s.characters)) {
          c.area = 'school';
          c.status = 'alive';
        }
        if (id.startsWith('shrine-maiden'))
          for (const c of Object.values(s.characters)) c.area = 'shrine';
        if (name === '男学生') card(s, 'b', '女学生');
        if (name === '女学生') card(s, 'b', '男学生');
        s.characters.b.counters.paranoia = 3;
        s.characters.b.counters.intrigue = 1;
        s.characters.a.counters.goodwill = n;
        if (id === 'girl-move') s.characters.a.flags['free-movement'] = 'yes';
        if (id === 'ai') role(s, 'a', '传谣人');
        if (id === 'outsider-reveal' || id === 'copycat-reveal') s.loop = 2;
        if (['alien-revive', 'forensic-reveal', 'immortal-revive'].includes(id))
          s.characters.b.status = 'dead';
        if (id === 'boss-reveal') s.setup.characters[0].territory = 'school';
        if (id === 'immortal-revive') s.setup.characters[0].x = 2;
        if (id === 'shrine-maiden-remove') s.boards.shrine = 1;
        if (id === 'doctor-release') card(s, 'c', '住院患者');
        if (id === 'little-sister') {
          card(s, 'c', '教师');
          s.characters.c.area = 'school';
        }
        if (id === 'informant')
          s.setup.x = ['流言四起', ...(pack.module === 'FS' ? [] : ['因果线'])];
        if (id === 'class-representative')
          s.cards.find((c) => c.owner === 'p0' && c.kind === 'goodwill+2').status = 'used';
        if (id === 'divinity-incident' || id === 'ai' || id === 'detective-incident')
          s.setup.incidents = [{ day: 1, name: '自杀', culprit: 'b' }];
        if (id === 'detective-incident')
          s.incidents = [{ ...s.setup.incidents[0], loop: 1, publicName: '自杀' }];
      }
      for (const limit of definition.oncePerLoop ? [false, true] : [false]) {
        pair(
          '角色友好能力',
          name,
          definition.text + (limit ? ' · 次数' : ' · 门槛及结算'),
          (limit ? 'A 本轮未用，B 已用一次。' : 'A 友好 ' + n + '，B 友好 ' + (n - 1) + '。') +
            '发动 ' +
            id +
            '。选择见公开轨迹。',
          'protagonist-abilities',
          (s, on) => {
            setup(s);
            if (!on) {
              if (limit) s.uses['loop:' + s.loop + ':a:' + id] = 1;
              else s.characters.a.counters.goodwill = n - 1;
            }
          },
          action(id, 'a', picks),
          (s) => {
            eq(
              s.observations.protagonists.some(
                (o) => o.type === 'declaration' && o.data.ability === id,
              ),
              true,
            );
            checks[id](s);
          },
        );
      }
      if (['doctor-counter', 'teacher-counter', 'higher-being'].includes(id)) {
        const alternate = id === 'higher-being' ? { counter: 'despair' } : { direction: 'remove' };
        pair(
          '角色友好能力',
          name,
          id === 'higher-being' ? '选择绝望指示物' : '选择移除不安',
          '相同合法目标 b，A 刚好达标，B 差一枚',
          'protagonist-abilities',
          (s, on) => {
            setup(s);
            if (!on) s.characters.a.counters.goodwill--;
          },
          action(id, 'a', { ...picks, ...alternate }),
          id === 'higher-being' ? counter('b', 'despair', 1) : counter('b', 'paranoia', 2),
        );
      }
      if (['doctor-counter', 'higher-being'].includes(id)) {
        pair(
          '角色能力',
          name,
          '剧作家阶段使用友好能力',
          'A 为可无视友好的主谋，B 平民。友好固定为剧作家阶段门槛。',
          'mastermind-abilities',
          (s, on) => {
            setup(s);
            role(s, 'a', on ? '主谋' : '平民');
            s.characters.a.counters.goodwill = id === 'higher-being' ? 1 : 2;
          },
          action(id, 'a', picks),
          checks[id],
        );
      }
    }
  }
}

export function traitCases(h) {
  const { pack, pair, role, card, cnt, eq, action, apply, placements, death, configs, setupPair } =
    h;
  const mod = pack.module;
  const trait = (name, clause, example, phase, prep, choose, verify, expected) =>
    pair(
      '角色特性',
      name,
      clause,
      example,
      phase,
      (s, on) => {
        card(s, 'a', name);
        prep(s, on);
      },
      choose,
      verify,
      expected,
    );
  const setup = () =>
    configs(
      mod === 'FS' ? '复仇的火种' : '被封印的邪灵',
      mod === 'FS' ? ['流言四起'] : ['流言四起', '因果线'],
    );
  for (const name of [
    'AI',
    '妹妹',
    '模仿犯',
    '局外人',
    '转校生',
    '神灵',
    '大人物',
    '仙人',
    '临时工？',
  ]) {
    const a = setup();
    const id = name === 'AI' ? 0 : a.characters.length - 1;
    const c = a.characters[id];
    if (name !== '临时工？') c.character = name;
    if (name === '模仿犯' || name === '局外人')
      a.characters.push({ id: 'neutral', character: '偶像', identity: '平民' });
    if (name === '模仿犯') {
      c.copiedFrom = 'p0';
      c.identity = a.characters[0].identity;
    }
    if (name === '局外人') c.identity = '杀手';
    if (name === '转校生') c.enterDay = 2;
    if (name === '神灵') c.enterLoop = 2;
    if (name === '大人物') c.territory = 'city';
    if (name === '仙人') {
      c.initialArea = 'shrine';
      c.x = 2;
    }
    const b = structuredClone(a),
      d = b.characters[id];
    if (name === 'AI' || name === '妹妹') {
      const other = b.characters[name === 'AI' ? b.characters.length - 1 : 0];
      [other.identity, d.identity] = [d.identity, other.identity];
    }
    if (name === '模仿犯') d.copiedFrom = 'neutral';
    if (name === '局外人') d.identity = '主谋';
    if (name === '转校生') d.enterDay = 3;
    if (name === '神灵') d.enterLoop = 3;
    if (name === '大人物') delete d.territory;
    if (name === '仙人') d.x = -1;
    if (name === '临时工？') d.character = name;
    const clause = {
      AI: '不得配置平民',
      妹妹: '不得配置无视友好的身份',
      模仿犯: '复制指定角色的配置身份，额外占位',
      局外人: '获得所选规则以外的身份',
      转校生: '指定合法登场日',
      神灵: '指定合法登场轮',
      大人物: '指定领地',
      仙人: '指定非负 X',
      '临时工？': '不得直接用于开局配置',
    }[name];
    setupPair(name, clause, '仅改变被测配置约束；展开可见 A、B 的完整剧本。', a, b);
  }
  trait(
    '黑猫',
    '轮初神社密谋 +1',
    'A 黑猫存活，B 未登场',
    'loop-start',
    (s, on) => {
      s.characters.a.status = on ? 'alive' : 'absent';
    },
    null,
    (s) => eq(s.boards.shrine, 1),
  );
  for (const name of ['黑猫', '教主', 'AI', '仙人', '手下', '临时工？']) {
    const event = name === '黑猫' || name === '教主' ? '失踪' : name === '仙人' ? '谋杀' : '自杀';
    trait(
      name,
      {
        黑猫: '当事人事件无现象',
        教主: '当事人事件效果结算两次',
        AI: '以全部指示物判定事件',
        仙人: '顺时针相邻区域结算事件',
        手下: '友好能力抑制本人事件',
        '临时工？': '继承临时工当事人配置',
      }[name],
      {
        黑猫: '同一事件，A 当事人为黑猫，B 为普通角色',
        教主: 'A 为教主，B 为普通角色，选择同一目的版图',
        AI: '不安 0；A 有 4 友好，B 只有 3',
        仙人: 'A 为医院仙人，B 为医院普通角色，受害者在神社',
        手下: 'A 本轮已设置抑制标记，B 没有',
        '临时工？': '临时工死亡。A 替身达到限度，B 差一枚',
      }[name],
      'incident',
      (s, on) => {
        let c = s.characters.a;
        if (name === '临时工？') {
          card(s, 'a', '临时工');
          s.characters.a.status = 'dead';
          c = s.characters.a_replacement;
          c.status = 'alive';
        }
        if (['黑猫', '教主', '仙人'].includes(name) && !on) {
          card(s, 'a', '职员');
          c = s.characters.a;
        }
        s.setup.incidents = [{ day: 1, name: event, culprit: 'a' }];
        c.counters.paranoia = 5;
        if (name === 'AI') {
          c.counters.paranoia = 0;
          c.counters.goodwill = on ? 4 : 3;
        }
        if (name === '临时工？') c.counters.paranoia = on ? 3 : 2;
        if (name === '手下' && on) c.flags['no-incidents'] = 'yes';
        if (name === '仙人') {
          c.area = 'hospital';
          s.characters.b.area = 'shrine';
        }
      },
      action('', '', { area: 'city', areaMode: 'clockwise', target: 'b' }),
      (s) => {
        if (name === '黑猫') eq(s.boards.city, 0);
        if (name === '教主') eq(s.boards.city, 2);
        if (name === 'AI') eq(s.characters.a.status, 'dead');
        if (name === '仙人') eq(s.characters.b.status, 'dead');
        if (name === '手下')
          eq(s.observations.protagonists.find((o) => o.type === 'incident').data.occurred, false);
        if (name === '临时工？') eq(s.characters.a_replacement.status, 'dead');
      },
    );
  }
  for (const key of ['goodwill', 'paranoia', 'intrigue'])
    trait(
      '学者',
      '轮初放置 ' + key,
      'A 为学者，B 为普通角色',
      'loop-start',
      (s, on) => {
        if (!on) card(s, 'a', '男学生');
      },
      action('', '', { counter: key }),
      (s) => eq(cnt(s, 'a', key), 1),
    );
  trait(
    '临时工',
    '有效身份覆盖为平民',
    '给 A 临时工、B 普通角色配置主谋，巫女 b 公开 a 的生效身份。',
    'protagonist-abilities',
    (s, on) => {
      s.setup.characters[0].identity = '主谋';
      card(s, 'a', on ? '临时工' : '职员');
      card(s, 'b', '巫女');
      s.characters.b.area = s.characters.a.area;
      s.characters.b.counters.goodwill = 5;
    },
    action('shrine-maiden-reveal', 'b', { target: 'a' }),
    (s) => eq(s.observations.protagonists.find((o) => o.type === 'identity').data.identity, '平民'),
  );
  trait(
    '临时工',
    '回合末总指示物 ≥3 死亡',
    'A 有不安 2、友好 1，B 只有不安 2',
    'day-end',
    (s, on) => {
      s.characters.a.counters.paranoia = 2;
      s.characters.a.counters.goodwill = on ? 1 : 0;
    },
    null,
    (s) => eq(s.characters.a.status, 'dead'),
  );
  trait(
    '临时工',
    '死亡后下回合替身在都市登场',
    'A 临时工已死，B 存活',
    'day-start',
    (s, on) => {
      s.characters.a.status = on ? 'dead' : 'alive';
    },
    null,
    (s) => {
      eq(s.characters.a_replacement.status, 'alive');
      eq(s.characters.a_replacement.area, 'city');
    },
  );
  for (const [name, phase, key] of [
    ['转校生', 'day-start', 'enterDay'],
    ['神灵', 'loop-start', 'enterLoop'],
  ]) {
    // God arrival happens at the public continue decision (loop reset).
    if (name === '神灵') continue;
    trait(
      name,
      '指定日到场',
      'A 今日入场，B 明日入场',
      phase,
      (s, on) => {
        s.setup.characters[0][key] = on ? 1 : 2;
        s.characters.a.status = 'absent';
      },
      null,
      (s) => eq(s.characters.a.status, 'alive'),
    );
  }
  trait(
    '神灵',
    '指定轮到场',
    'A 第二轮开始登场，B 第三轮登场；双方同意继续',
    'discussion',
    (s, on) => {
      s.loop = 2;
      s.setup.loops = 3;
      s.setup.characters[0].enterLoop = on ? 2 : 3;
      s.characters.a.status = 'absent';
    },
    null,
    (s) => eq(s.characters.a.status, 'alive'),
  );
  trait(
    '手下',
    '每轮重新选择起始版图',
    'A 手下选学校，B 普通角色留在都市',
    'loop-start',
    (s, on) => {
      if (!on) card(s, 'a', '职员');
      s.characters.a.area = 'city';
    },
    action('', '', { area: 'school' }),
    (s) => eq(s.characters.a.area, 'school'),
  );
  trait(
    '幻想',
    '所在版图行动牌同时作用于幻想',
    '神社不安 +1，A 幻想在神社，B 在学校',
    'card-resolution',
    (s, on) => {
      s.characters.a.area = on ? 'shrine' : 'school';
      placements(s, [['mastermind', 'paranoia+1', 'shrine']]);
    },
    null,
    (s) => eq(cnt(s, 'a', 'paranoia'), 1),
  );
  for (const move of [true, false])
    trait(
      '从者',
      move ? '同区随行' : '同区代替死亡',
      'A 与大小姐同区，B 与其异区',
      move ? 'card-resolution' : 'day-end',
      (s, on) => {
        card(s, 'b', '大小姐');
        s.characters.a.area = on ? 'school' : 'hospital';
        if (move) placements(s, [['p0', 'horizontal', 'b']]);
        else death(s, 'b');
      },
      null,
      (s) =>
        move
          ? eq(s.characters.a.area, s.characters.b.area)
          : (eq(s.characters.a.status, 'dead'), eq(s.characters.b.status, 'alive')),
    );
  trait(
    '御神木',
    '主人公阶段转移指示物',
    'A 御神木有 1 不安，B 为 0；转移给同区角色 b',
    'protagonist-abilities',
    (s, on) => {
      s.characters.a.area = s.characters.b.area;
      s.characters.a.counters.paranoia = on ? 1 : 0;
    },
    action('sacred-tree', 'a', { target: 'b', counter: 'paranoia' }),
    (s) => eq(cnt(s, 'b', 'paranoia'), 1),
  );
  trait(
    '御神木',
    '有无视友好特性时剧作家阶段强制转移',
    'A 为主谋，B 为平民；转移 1 不安',
    'mastermind-abilities',
    (s, on) => {
      role(s, 'a', on ? '主谋' : '平民');
      s.characters.a.area = s.characters.b.area;
      s.characters.a.counters.paranoia = 1;
    },
    action('', '', { target: 'b', counter: 'paranoia' }),
    (s) => eq(cnt(s, 'b', 'paranoia'), 1),
  );
  trait(
    '大人物',
    '剧作家可使用领地作为所在区域',
    'A 领地学校，B 都市。主谋能力给学校角色 b 密谋 +1',
    'mastermind-abilities',
    (s, on) => {
      role(s, 'a', '主谋');
      s.setup.characters[0].territory = on ? 'school' : 'city';
    },
    action('brain', 'a', { areaMode: 'territory', target: 'b' }),
    (s) => eq(cnt(s, 'b', 'intrigue'), 1),
  );
  trait(
    'UP主',
    '本轮首起事件当天日末放置 Ex 牌',
    'A 本日为首起事件日，B 本日没有事件',
    'day-end',
    (s, on) => {
      if (on) s.incidents = [{ name: '自杀', day: 1, loop: 1, culprit: 'd' }];
    },
    action('', '', { target: 'b' }),
    (s) => eq(s.flags['streamer-target'], 'b'),
  );
  trait(
    'UP主',
    '可借 Ex 牌所处区域发动能力',
    'A 的 Ex 牌位于学校，B 在医院。给学校角色增加不安',
    'mastermind-abilities',
    (s, on) => {
      role(s, 'a', '传谣人');
      s.flags['streamer-target'] = on ? 'b' : 'c';
    },
    action('gossip', 'a', { areaMode: 'streamer', target: 'b' }),
    (s) => eq(cnt(s, 'b', 'paranoia'), 1),
  );
  trait(
    '仙人',
    '事件之外不安限度视作 0',
    'A 仙人 X=4，B 普通角色。均为不安 1，护士在同区请求移除不安',
    'protagonist-abilities',
    (s, on) => {
      if (!on) card(s, 'a', '职员');
      s.characters.a.paranoiaLimit = on ? 4 : 2;
      s.characters.a.counters.paranoia = 1;
      card(s, 'b', '护士');
      s.characters.b.area = s.characters.a.area;
      s.characters.b.counters.goodwill = 2;
    },
    action('nurse', 'b', { target: 'a' }),
    (s) => eq(cnt(s, 'a', 'paranoia'), 0),
  );
}

export function extraCases(h) {
  const {
    pack,
    pair,
    card,
    role,
    cnt,
    eq,
    action,
    sourceEntry,
    setupPair,
    configs,
    placements,
    death,
  } = h;
  const fs = pack.module === 'FS';
  const base = () =>
    configs(fs ? '复仇的火种' : '被封印的邪灵', fs ? ['流言四起'] : ['流言四起', '因果线']);
  for (const [name, def] of Object.entries(pack.characters)) {
    if (name === '临时工？') continue;
    const source = sourceEntry('characters', name).fields;
    const s = base();
    const c = s.characters[name === 'AI' ? 0 : s.characters.length - 1];
    const dup = s.characters.find((x) => x.character === name && x !== c);
    if (dup) dup.character = '班长';
    c.character = name;
    if (name === '局外人') c.identity = '杀手';
    if (name === '模仿犯') {
      c.identity = s.characters[0].identity;
      c.copiedFrom = s.characters[0].id;
    }
    if (name === '转校生') c.enterDay = 1;
    if (name === '神灵') c.enterLoop = 1;
    if (name === '仙人') c.x = 2;
    if (name === '大人物') c.territory = 'school';
    const names = { 医院: 'hospital', 学校: 'school', 神社: 'shrine', 都市: 'city', 远方: 'far' };
    const areas = Object.entries(names)
      .filter(([word]) => source['初始区域'].includes(word))
      .map(([, v]) => v);
    for (const area of name === '手下' ? ['school', 'city', 'hospital', 'shrine'] : areas) {
      c.initialArea = area;
      const wrong = structuredClone(s);
      wrong.characters.find((x) => x.id === c.id).initialArea = Object.values(names).find(
        (v) => !(name === '手下' ? ['school', 'city', 'hospital', 'shrine'] : areas).includes(v),
      );
      setupPair(
        name,
        '初始区域 ' + area,
        'A 从 ' +
          area +
          ' 开始，B 从 ' +
          wrong.characters.find((x) => x.id === c.id).initialArea +
          ' 开始。',
        s,
        wrong,
      );
    }
    if (name === '仙人') continue;
    const limit = Number(String(source['不安限度']).normalize('NFKC'));
    pair(
      '角色不安限度',
      name,
      '不安限度 ' + limit,
      limit
        ? '自杀事件；A 刚好达到限度，B 差一枚。'
        : '自杀事件；A 黑猫存活且零不安，B 黑猫已死亡。',
      'incident',
      (s, on) => {
        card(s, 'a', name);
        s.characters.a.status = !on && !limit ? 'dead' : 'alive';
        s.characters.a.counters.paranoia = Math.max(0, limit - (on ? 0 : 1));
        s.setup.incidents = [{ day: 1, name: '自杀', culprit: 'a' }];
        if (name === '临时工') s.characters.a_replacement.status = 'absent';
      },
      null,
      (s) => eq(s.observations.protagonists.find((o) => o.type === 'incident').data.occurred, true),
    );
    for (const [word, dest] of Object.entries(names).filter(([word]) =>
      source['禁行区域'].includes(word),
    )) {
      const boards = ['hospital', 'shrine', 'city', 'school'];
      const origin = def.initial.find((x) => boards.includes(x));
      const kind = ['', 'horizontal', 'vertical', 'diagonal'][
        boards.indexOf(origin) ^ boards.indexOf(dest)
      ];
      pair(
        '角色禁行',
        name,
        '禁止进入' + word,
        '同一张 ' + kind + ' 移动牌，A 保留禁行，B 允许前往目的地。',
        'card-resolution',
        (s, on) => {
          card(s, 'a', name);
          s.characters.a.area = origin;
          s.characters.a.status = 'alive';
          if (!on) s.characters.a.flags['free-movement'] = 'yes';
          placements(s, [['mastermind', kind, 'a']]);
        },
        null,
        (s) => eq(s.characters.a.area, origin),
      );
    }
  }
  pair(
    '角色特性',
    '幻想',
    '不能对其放置行动牌',
    '同一主人公把不安 +1 放到角色 a。A 是男学生，B 是幻想；只保留 A。',
    'protagonist-cards',
    (s, on) => {
      if (!on) card(s, 'a', '幻想');
    },
    (s, d) => ({
      kind: 'cards',
      placements: [
        {
          card: s.cards.find((c) => c.owner === d.actor && c.kind === 'paranoia+1').id,
          target: 'a',
        },
      ],
    }),
    (s) => eq(s.placements[0].target, 'a'),
    'excluded',
    (s) => s.placements.length === 1,
  );
  for (const [name, id] of [
    ['护士', 'nurse'],
    ['局外人', 'outsider-reveal'],
    ['模仿犯', 'copycat-reveal'],
  ]) {
    pair(
      '角色友好能力',
      name,
      '即使必定无视友好也可发动',
      'A 邪教徒、B 平民；两者均应能发动。若公开身份不同，公开后的观察应区分两者。',
      'protagonist-abilities',
      (s, on) => {
        card(s, 'a', name);
        role(s, 'a', on ? '邪教徒' : '平民');
        s.loop = 2;
        s.characters.a.counters.goodwill = 3;
        s.characters.b.area = s.characters.a.area;
        s.characters.b.counters.paranoia = 3;
        if (name === '模仿犯')
          for (const id of ['b', 'c', 'd']) role(s, id, on ? '邪教徒' : '平民');
      },
      action(id, 'a', { target: 'b' }),
      (s) =>
        eq(
          s.observations.protagonists.some((o) => o.type === 'refused'),
          false,
        ),
      name === '局外人' ? 'excluded' : 'possible',
    );
  }
  pair(
    '角色特性',
    '临时工？',
    '继承原配置身份',
    '原临时工分别配置主谋或平民，替身合法登场并公开其身份',
    'protagonist-abilities',
    (s, on) => {
      s.setup.characters[0].identity = on ? '主谋' : '平民';
      card(s, 'a', '临时工');
      s.characters.a.status = 'dead';
      s.characters.a_replacement.status = 'alive';
      s.characters.a_replacement.counters.goodwill = 3;
    },
    action('parttimer-reveal', 'a_replacement', { target: 'a_replacement' }),
    (s) => eq(s.observations.protagonists.find((o) => o.type === 'identity').data.identity, '主谋'),
  );
  pair(
    '角色能力',
    'UP主',
    '可将 Ex 牌转移给同区另一角色',
    'A 目标 b 携带 Ex 牌，B 牌在其他角色。选择转移给 c',
    'protagonist-abilities',
    (s, on) => {
      card(s, 'a', 'UP主');
      for (const c of Object.values(s.characters)) c.area = 'school';
      s.characters.a.counters.goodwill = 3;
      s.flags['streamer-target'] = on ? 'b' : 'd';
    },
    action('streamer', 'a', { areaMode: 'actual', target: 'b', transfer: 'yes', newTarget: 'c' }),
    (s) => eq(s.flags['streamer-target'], 'c'),
  );
  for (const [name, id] of [
    ['模仿犯', 'copycat-reveal'],
    ['局外人', 'outsider-reveal'],
  ]) {
    pair(
      '角色友好能力',
      name,
      '须从第二轮才可使用',
      'A 第二轮，B 第一轮。用相同友好数量声明能力。',
      'protagonist-abilities',
      (s, on) => {
        card(s, 'a', name);
        s.loop = on ? 2 : 1;
        s.characters.a.counters.goodwill = 3;
      },
      action(id),
      (s) =>
        eq(
          s.observations.protagonists.some((o) => o.type === 'identity'),
          true,
        ),
    );
  }
}
