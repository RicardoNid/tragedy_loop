import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '../../../packages/contracts/src/game.js';
import type { KnowledgeView } from '../../../packages/contracts/src/knowledge.js';
import { api } from './api';
import { SolverTables } from './SolverTables';
import { relationDomains, SolverRelations } from './SolverRelations';

const statuses = {
  waiting: '等待首批角色登场',
  running: '候选已建立，正在验证',
  exact: '候选取值验证完成',
  incomplete: '尚未判定完毕',
  unsupported: '暂不支持此配置',
  contradiction: '观察与规则矛盾',
  error: '计算失败',
};
export function Knowledge({
  id,
  shown,
  liveRevision,
}: {
  id: string;
  shown: Pick<PlayerView, 'revision' | 'characters' | 'roster'>;
  liveRevision: number;
}) {
  const [results, setResults] = useState<Record<number, KnowledgeView>>({});
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    setResults({});
    setError('');
  }, [id]);
  useEffect(() => {
    const token = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.knowledge(id);
        if (generation.current !== token) return;
        if (result.revision === liveRevision)
          setResults((old) => ({ ...old, [result.revision]: result }));
        setError('');
      } catch (e) {
        if (generation.current === token) setError(String(e));
      }
      if (generation.current === token) timer = setTimeout(poll, 700);
    }
    void poll();
    return () => {
      generation.current++;
      clearTimeout(timer);
    };
  }, [id, liveRevision]);
  const result = results[shown.revision];
  const columns = result?.openingColumns;
  const roster = shown.roster ?? shown.characters;
  const characterName = (id: string) =>
    roster.find((c) => c.id === id)?.character ??
    ({ hospital: '医院', shrine: '神社', city: '都市', school: '学校' } as Record<string, string>)[
      id
    ] ??
    id;
  const mark = (values: string[] | undefined, verified: string[] | undefined) =>
    values
      ?.map((value) => `${value}${values.length === 1 && verified?.includes(value) ? ' ✓' : ' ?'}`)
      .join('、') || '无候选';
  const parameter = (key: string, values: string[]) => {
    const [kind, id] = key.split(':');
    const names: Record<string, string> = {
      firstX: '首先公开的副线',
      secretAddition: '额外身份',
      reverse: '里身份',
      alternateY: '备选主线',
      privateRoles: '私有席位排列（依次为 P0、P1、P2）',
      copy: '复制对象',
      x: '不安限度 X',
      enterDay: '登场日期',
      enterLoop: '登场轮回',
      territory: '领地',
      area: '初始地点',
    };
    const areas: Record<string, string> = {
      hospital: '医院',
      shrine: '神社',
      city: '都市',
      school: '学校',
      far: '远方',
    };
    return `${id ? (roster.find((c) => c.id === id)?.character ?? id) + ' · ' : ''}${names[kind!] ?? kind}：${values.map((v) => (kind === 'copy' ? (roster.find((c) => c.id === v)?.character ?? v) : (areas[v] ?? v))).join('、')}`;
  };
  return (
    <section
      className="panel knowledge"
      aria-label="解空间"
      data-evidence-through={result?.evidenceThrough}
    >
      <h2>求解器1</h2>
      <p aria-live="polite">
        {error || (result ? statuses[result.status] : '正在同步公开观察')}
        {' · 观察版本 '}
        {shown.revision}
      </p>
      {result?.openingCartesianBound !== undefined && (
        <section aria-label="求解次数对比">
          <strong>求解次数对比</strong>
          <p>穷举基准（开局各变量自由组合上限） {BigInt(result.openingCartesianBound).toLocaleString('zh-CN')} 组
            {' · '}剪枝后累计实际建立历史核验 {result.generated.toLocaleString('zh-CN')} 次</p>
          <p>累计约束检查 {result.propagation?.checks.toLocaleString('zh-CN') ?? '待统计'} 次
            {' · '}历史搜索展开 {result.expansions.toLocaleString('zh-CN')} 次</p>
        </section>
      )}
      {result &&
        result.status !== 'waiting' &&
        (result.ruleDigest || result.status !== 'running') && (
          <>
            <SolverTables
              identities={
                columns
                  ? {
                      columns: columns.identities,
                      rows: roster.map((c) => ({
                        id: c.id,
                        label: c.character,
                        values: result.identities[c.id] ?? [],
                        verified: result.verified?.identities[c.id] ?? [],
                        implied: result.impliedIdentities?.[c.id],
                      })),
                    }
                  : undefined
              }
              rules={(columns?.rules ?? []).map((rule) => ({
                name: rule,
                state: !result.rules.includes(rule)
                  ? '×'
                  : result.verified?.rules.includes(rule) &&
                      !!result.ruleCombinations?.length &&
                      result.ruleCombinations.every((c) => c.y === rule || c.x.includes(rule))
                    ? '✓'
                    : '?',
              }))}
              events={(columns?.days ?? []).map((day) => ({
                day,
                names: mark(result.realIncidents?.[day], result.verified?.realIncidents[day]),
                culprits: mark(
                  result.culprits[day]?.map(characterName),
                  result.verified?.culprits[day]?.map(characterName),
                ),
              }))}
            />
            <SolverRelations
              relations={
                result.status === 'unsupported' || result.status === 'contradiction'
                  ? undefined
                  : result.candidateRelations
              }
              roster={roster}
              domains={relationDomains(
                result.rules,
                result.identities,
                result.realIncidents ?? {},
                result.culprits,
              )}
              fixedRules={result.rules.filter(
                (r) =>
                  result.ruleCombinations?.length &&
                  result.ruleCombinations.every((p) => p.y === r || p.x.includes(r)),
              )}
            />
            {!!Object.keys(result.parameters ?? {}).length && (
              <details>
                <summary>特殊参数</summary>
                <ul>
                  {Object.entries(result.parameters ?? {}).map(([key, values]) => (
                    <li key={key}>{parameter(key, values)}</li>
                  ))}
                </ul>
              </details>
            )}
            {!result.domainComplete && <p>候选域尚未就绪，未列出的取值仍待判定。</p>}
            {result.status === 'incomplete' && shown.revision === liveRevision && (
              <button
                onClick={async () => {
                  try {
                    await api.verifyKnowledge(id);
                    setError('');
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                核验联合历史
              </button>
            )}
          </>
        )}
    </section>
  );
}
