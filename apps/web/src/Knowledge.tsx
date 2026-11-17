import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '../../../packages/contracts/src/game.js';
import type { KnowledgeView } from '../../../packages/contracts/src/knowledge.js';
import { api } from './api';
import { CandidateMatrix } from './CandidateMatrix';
import { recordSolver } from './review-log';

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
  const [visible, setVisible] = useState(true);
  const [results, setResults] = useState<Record<number, KnowledgeView>>({});
  const [error, setError] = useState('');
  const [logError, setLogError] = useState('');
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
        try {
          await recordSolver(id, result);
          setLogError('');
        } catch (e) {
          setLogError('求解诊断记录写入失败：' + String(e));
        }
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
    <section className="panel knowledge" aria-label="解空间">
      <div className="section-heading">
        <h2>实时解空间</h2>
        <label>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{' '}
          显示推理辅助
        </label>
      </div>
      {visible && (
        <>
          {logError && <p role="alert">{logError}</p>}
          <p className="muted">
            主人公共享观察 · ✓ 确定是 · × 确定不是 · ?
            可能是。公开观察直接确定的身份会立即打勾，其余唯一候选需有合法历史支持。不同格仍须满足同一剧本的约束。
          </p>
          <p aria-live="polite">
            {error ||
              (result
                ? result.status === 'running' && !result.ruleDigest
                  ? '正在同步公开观察'
                  : (result.historySearchDeferred ?? result.scope?.deferred) &&
                      result.status === 'incomplete'
                    ? '局部传播完成，联合历史待核验'
                    : statuses[result.status]
                : shown.revision === liveRevision
                  ? '正在同步公开观察'
                  : '此观察版本暂无计算结果')}{' '}
            · 观察版本 {shown.revision}
          </p>
          {result &&
            result.status !== 'waiting' &&
            (result.ruleDigest || result.status !== 'running') && (
              <>
                <div className="knowledge-metrics">
                  <span>候选取值 {result.propagation?.candidateValues ?? 0}</span>
                  <span>已验证取值 {result.propagation?.verifiedValues ?? 0}</span>
                  <span>待验证取值 {result.unresolved}</span>
                  <span>联合解总数：{result.jointCount ?? '未计算'}</span>
                </div>
                {columns && (result.domainComplete || columns.identities.length > 0) && (
                  <>
                    <CandidateMatrix
                      title="角色 × 初始身份"
                      heading="角色"
                      columns={columns.identities}
                      rows={roster.map((c) => ({
                        id: c.id,
                        label: c.character,
                        values: result.identities[c.id] ?? [],
                        verified: result.verified?.identities[c.id] ?? [],
                        implied: result.impliedIdentities?.[c.id],
                      }))}
                    />
                    {columns.days.length > 0 && (
                      <>
                        <CandidateMatrix
                          title="事件 × 当事人"
                          heading="事件日期"
                          columns={columns.culprits.map(characterName)}
                          rows={columns.days.map(
                            (day) => ({
                              id: day,
                              label: `第 ${day} 日`,
                              values: (result.culprits[day] ?? []).map(characterName),
                              verified: (result.verified?.culprits[day] ?? []).map(characterName),
                            }),
                          )}
                        />
                        <div className="knowledge-table">
                          <table aria-label="真实事件候选">
                            <caption>真实事件候选</caption>
                            <thead>
                              <tr>
                                <th scope="col">日期</th>
                                <th scope="col">真实事件候选</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(result.realIncidents ?? {}).map(([day, names]) => (
                                <tr key={day}>
                                  <th scope="row">第 {day} 日</th>
                                  <td>{mark(names, result.verified?.realIncidents[day])}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    <div className="knowledge-table">
                      <table aria-label="规则候选判定">
                        <caption>规则候选</caption>
                        <thead>
                          <tr>
                            <th>规则</th>
                            <th>是否采用</th>
                          </tr>
                        </thead>
                        <tbody>
                          {columns.rules.map((rule) => {
                            const present = result.rules.includes(rule);
                            const forced =
                              result.verified?.rules.includes(rule) &&
                              result.ruleCombinations?.every(
                                (c) => c.y === rule || c.x.includes(rule),
                              );
                            return (
                              <tr key={rule}>
                                <th scope="row">{rule}</th>
                                <td>{present ? (forced ? '✓' : '？') : '×'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <details>
                      <summary>
                        规则组合候选（{result.ruleCombinations?.length ?? 0}）与特殊参数
                      </summary>
                      <div className="knowledge-table">
                        <table aria-label="规则组合候选">
                          <caption>规则组合候选 · 包含尚未整体验证的组合</caption>
                          <thead>
                            <tr>
                              <th scope="col">Y 规则</th>
                              <th scope="col">X 规则组合</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.ruleCombinations?.map((combination) => (
                              <tr key={`${combination.y}/${combination.x.join('/')}`}>
                                <td>{combination.y}</td>
                                <td>{combination.x.join(' ＋ ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!!Object.keys(result.parameters ?? {}).length && (
                        <div className="knowledge-table">
                          <table aria-label="特殊参数候选">
                            <caption>特殊参数候选</caption>
                            <thead>
                              <tr>
                                <th scope="col">角色与参数</th>
                                <th scope="col">候选值</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(result.parameters ?? {}).map(([key, values]) => {
                                const [label, ...rest] = parameter(key, values).split('：');
                                return (
                                  <tr key={key}>
                                    <th scope="row">{label}</th>
                                    <td>{rest.join('：')}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <p>
                        列表中的取值不能任意组合；仍需满足联合约束。规则组合列表包含尚未整体验证的组合。
                      </p>
                    </details>
                  </>
                )}
                {result.transition && (
                  <p>
                    解空间 S{result.transition.toVersion} ← S{result.transition.fromVersion} ＋
                    新观察 #{result.transition.firstObservation}–{result.transition.lastObservation}
                    ；已有逻辑关系继续保留。
                  </p>
                )}
                {!result.domainComplete && (
                  <p>候选域尚未就绪；不能据此断言唯一身份或排除未列出的取值。</p>
                )}
                <p className="muted">
                  信息批次 {result.propagation?.informationVersion ?? 0} · 约束版本{' '}
                  {result.propagation?.constraintVersion ?? 0} · 已检查约束{' '}
                  {result.propagation?.checks ?? 0} 次 · 已搜索 {result.expansions} 个行动分支 ·
                  证据截至第 {result.evidenceThrough} 条观察
                </p>
                {result.reasons.map((r) => (
                  <p key={r}>{r}</p>
                ))}
                {result.scope && (
                  <details open>
                    <summary>本次计算范围 · 观察 #{result.scope.observation}</summary>
                    <p>
                      {result.scope.publicSettlement
                        ? '这条变化与已声明的能力或公开牌面吻合，已直接更新盘面。'
                        : '角色、规则、事件分别筛选；下列“跳过”只表示未参与本次原因计算，仍保留在总解空间。身份名额等关联约束可能继续传播。'}
                    </p>
                    <div className="knowledge-table">
                      <table aria-label="本次计算范围">
                        <thead>
                          <tr>
                            <th>类别</th>
                            <th>可能来源</th>
                            <th>本次跳过</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th>角色</th>
                            <td>{result.scope.characters.map(characterName).join('、') || '无'}</td>
                            <td>
                              {result.scope.skippedCharacters.map(characterName).join('、') || '无'}
                            </td>
                          </tr>
                          <tr>
                            <th>规则</th>
                            <td>{result.scope.rules.join('、') || '无直接来源'}</td>
                            <td>{result.scope.skippedRules.join('、') || '无'}</td>
                          </tr>
                          <tr>
                            <th>事件</th>
                            <td>{result.scope.events.join('、') || '无直接来源'}</td>
                            <td>{result.scope.skippedEvents.join('、') || '无'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {result.scope.compound && (
                      <div aria-label="复合结算">
                        <p>本次局部结算检查了 {result.scope.compound.branches} 个分支。
                          {result.scope.compound.unresolved && '仍有可能的解释，已保留相关候选。'}</p>
                        {!!result.scope.compound.participants.length && <p>参与角色 · {result.scope.compound.participants.map(characterName).join('、')}</p>}
                        {!!result.scope.compound.variables.length && <p>关联变量 · {result.scope.compound.variables.map(key => {
                          const [kind, subject] = key.split(':');
                          if (kind === 'event' || kind === 'culprit') return `第 ${subject} 天的${kind === 'event' ? '真实事件' : '当事人'}`;
                          if (kind === 'identity') return characterName(subject!) + '的身份';
                          return key;
                        }).join('、')}</p>}
                      </div>
                    )}
                    {result.scope.fields && (
                      <ul aria-label="复合观察的逐项原因">
                        {result.scope.fields.map((row) => (
                          <li key={row.field}>
                            {row.field} · {row.alternatives?.join(' 或 ') ?? '有待核验'}
                            {row.alternatives?.length === 0 && '已排除'}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!result.scope.fields && result.scope.alternatives && (
                      <p>
                        本次保留的原因（{result.scope.alternatives.length}） ·{' '}
                        {result.scope.alternatives.join('、') || '无'}
                      </p>
                    )}
                    {result.scope.conservative.map((r) => (
                      <p key={r}>{r}</p>
                    ))}
                  </details>
                )}
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
                {result.transition && (
                  <p>
                    本次新增历史搜索起点 {result.transition.newHistoryRoots ?? 0} 个，推进隐藏行动{' '}
                    {result.transition.historyBranches ?? 0} 个分支。
                    {!!result.transition.historyCandidates?.length &&
                      '超出局部传播范围的观察编号：' +
                        result.transition.historyCandidates.join('、') +
                        '。'}
                  </p>
                )}
                {!!result.deductions?.length && (
                  <details>
                    <summary>排除依据</summary>
                    {result.deductions.map((d, index) => (
                      <p key={`${d.observation}-${index}`}>
                        观察 #{d.observation}：{d.reason}
                      </p>
                    ))}
                  </details>
                )}
                {!!result.relations?.length && (
                  <details open>
                    <summary>跨表逻辑关系（{result.relations.length}）</summary>
                    <p>
                      这些关系与候选表共同组成解空间。每条关系必须成立，同一组合内的原因可以是“或”；不同观察还共同受身份名额、阶段和轮回使用次数限制。
                    </p>
                    {result.relations.map((relation) => (
                      <details
                        open={relation.observation > 0 && relation === result.relations?.at(-1)}
                        key={relation.id}
                        aria-label={`观察 ${relation.observation} 的逻辑关系`}
                      >
                        <summary>
                          <strong>
                            {relation.observation ? `观察 #${relation.observation}：` : ''}
                            {relation.fact}
                          </strong>
                        </summary>
                        {relation.implications.map((text) => (
                          <p key={text}>{text}</p>
                        ))}
                        <div className="knowledge-table">
                          <table aria-label={`观察 ${relation.observation} 的条件关系`}>
                            <thead>
                              <tr>
                                <th>适用规则组合</th>
                                <th>至少满足一个原因</th>
                                <th>共同约束与保留条件</th>
                              </tr>
                            </thead>
                            <tbody>
                              {relation.cases.map((row, i) => (
                                <tr key={i}>
                                  <td>{row.when.join('；')}</td>
                                  <td>{row.alternatives.join(' 或 ') || '无相容原因'}</td>
                                  <td>
                                    {[...row.limits, ...row.notes].join('；') ||
                                      '仍需满足已有联合约束'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                  </details>
                )}
                <details>
                  <summary>计算依据与边界</summary>
                  <p>
                    计算范围是目前已公开的角色名单。新角色首次登场后，运算器扩大名单并用全部已有观察重新核验；名单不变时，沿用上一次的解空间。每格显示该取值是否有合法解释。不同格的候选仍须满足同一个剧本的约束。
                  </p>
                  <small>规则版本：{result.ruleDigest || '待计算'}</small>
                </details>
              </>
            )}
        </>
      )}
    </section>
  );
}
