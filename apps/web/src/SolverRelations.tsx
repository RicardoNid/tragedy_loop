import type {
  CandidateRelations,
  CandidateLiteral,
} from '../../../packages/contracts/src/candidate-relations';
import { useState } from 'react';

type Domains = Record<string, string[]>;
export function SolverRelations({
  relations,
  roster,
  domains,
  fixedRules = [],
}: {
  relations?: CandidateRelations;
  roster: { id: string; character: string }[];
  domains: Domains;
  fixedRules?: string[];
}) {
  const [showPairs, setShowPairs] = useState(false);
  const places: Record<string, string> = {
    school: '学校',
    shrine: '神社',
    city: '都市',
    hospital: '医院',
  };
  const name = (id: string) => {
    const c = roster.find((r) => r.id === id);
    if (!c) return places[id] ?? id;
    return roster.some((other) => other.id !== id && other.character === c.character)
      ? c.character + '（' + id + '）'
      : c.character;
  };
  const field = (key: string) => {
    const id = key.slice(key.indexOf(':') + 1);
    if (key.startsWith('identity:')) return name(id) + '的初始身份';
    if (key.startsWith('event:')) return '第 ' + id + ' 日真实事件';
    if (key.startsWith('culprit:')) return '第 ' + id + ' 日当事人';
    if (key.startsWith('schedule:')) return '第 ' + id + ' 日的事件与当事人';
    return '剧本';
  };
  const label = (key: string, values: string[]) => {
    if (key.startsWith('schedule:')) {
      const day = key.slice('schedule:'.length);
      const pairs = values.map((v) => {
        const [event, culprit] = JSON.parse(v) as [string, string];
        return (
          '（第 ' + day + ' 日真实事件为「' + event + '」 并 当事人为「' + name(culprit) + '」）'
        );
      });
      return pairs.length === 1 ? pairs[0]! : '（' + pairs.join(' 或 ') + '）';
    }
    const choices = values
      .map((v) => '「' + (key.startsWith('culprit:') ? name(v) : v) + '」')
      .join(' 或 ');
    return (
      field(key) +
      (key === 'rule' ? '采用' : '为') +
      (values.length > 1 ? '（' + choices + '）' : choices)
    );
  };
  const truth = ({ key, value, negated }: CandidateLiteral) => {
    const domain = domains[key];
    if (!domain) return;
    const fixed =
      key === 'rule' ? fixedRules.includes(value) : domain.length === 1 && domain[0] === value;
    if (fixed || !domain.includes(value)) return fixed !== !!negated;
  };
  const observations = (relations?.observations ?? []).flatMap((c) => {
    const branches = c.alternatives
      .filter((row) => !row.some((l) => truth(l) === false))
      .map((row) => row.filter((l) => truth(l) !== true));
    if (!branches.length || branches.some((row) => !row.length)) return [];
    const singles = branches.filter((row) => row.length === 1).map((row) => row[0]!);
    if (
      singles.some((l) =>
        singles.some((r) => r.key === l.key && r.value === l.value && !!r.negated !== !!l.negated),
      )
    )
      return [];
    for (const key of new Set(singles.map((l) => l.key))) {
      if (
        key !== 'rule' &&
        domains[key]?.every((v) =>
          singles.some((l) => l.key === key && !l.negated && l.value === v),
        )
      )
        return [];
    }
    if (branches.every((row) => row.every((l) => l.key === 'rule'))) return [];
    const keys = new Set(
      branches.flat().map((l) => (l.key === 'rule' ? 'plot:' + l.value : l.key)),
    );
    if (keys.size < 2) return [];
    const terms = new Set(
      branches.map((row) => {
        const term = row
          .map((l) =>
            l.negated ? '非（' + label(l.key, [l.value]) + '）' : label(l.key, [l.value]),
          )
          .join(' 并 ');
        return row.length > 1 && branches.length > 1 ? '（' + term + '）' : term;
      }),
    );
    return [{ ...c, text: [...terms].sort((a, b) => a.localeCompare(b, 'zh-CN')).join(' 或 ') }];
  });
  const pairs = relations?.pairs ?? [];
  const byFact = new Map<string, { title: string; lines: Set<string> }>();
  for (const row of observations) {
    const title = row.fact + '（公告 ' + row.observation + '）';
    const group = byFact.get(title) ?? { title, lines: new Set<string>() };
    group.lines.add(row.text);
    byFact.set(title, group);
  }
  const facts = [...byFact.values()];
  return (
    <section className="solver-relations" aria-label="逻辑关系">
      <h3>解空间逻辑关系</h3>
      {(observations.length > 0 || pairs.length > 0) && (
        <p>每条都是当前候选必须满足的条件。各条同时适用。</p>
      )}
      {!observations.length && !pairs.length && (
        <p>{relations ? '当前没有可展示的联合约束。' : '联合约束待判定。'}</p>
      )}
      {facts.map((group, i) => (
        <details key={group.title} open={i === facts.length - 1}>
          <summary>{group.title}</summary>
          <ul>
            {[...group.lines].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ))}
      {!!relations?.partiallyDisplayed?.length && (
        <p>公告 {relations.partiallyDisplayed.join('、')} 的多项联合约束仅展开了部分表达式。</p>
      )}
      {pairs.length > 0 && (
        <details onToggle={(e) => setShowPairs(e.currentTarget.open)}>
          <summary>不能同时成立的候选取值（{pairs.length} 组）</summary>
          {showPairs &&
            pairs.map((p) => (
              <details key={JSON.stringify([p.left, p.right])}>
                <summary>
                  {field(p.left)}与{field(p.right)}
                </summary>
                <ul>
                  {p.excluded.map((row, i) => (
                    <li key={i}>
                      非（{label(p.left, row.left)} 并 {label(p.right, row.right)}）
                    </li>
                  ))}
                </ul>
              </details>
            ))}
        </details>
      )}
    </section>
  );
}

export function relationDomains(
  rules: string[],
  identities: Domains,
  events: Domains,
  culprits: Domains,
): Domains {
  const domains: Domains = { rule: rules };
  for (const [kind, fields] of [
    ['identity', identities],
    ['event', events],
    ['culprit', culprits],
  ] as const)
    for (const [key, values] of Object.entries(fields)) domains[kind + ':' + key] = values;
  return domains;
}
