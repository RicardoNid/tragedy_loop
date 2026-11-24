import { useEffect, useMemo, useState } from 'react';
import {
  awaitingFirstPlacement,
  completeObservationGroups,
  type PlayerView,
} from '../../../packages/contracts/src/game';
import type { Solution3View } from '../../../packages/contracts/src/solution3';
import { api } from './api';
import { label } from './labels';

const labels: Record<string, string> = {
  hospital: '医院群众',
  shrine: '神社群众',
  city: '都市群众',
  school: '学校群众',
};
export function Knowledge3({ id, shown }: { id: string; shown: PlayerView }) {
  const [error, setError] = useState('');
  const [cursor, seek] = useState<number | null>(null);
  const [detail, setDetail] = useState(false);
  const [selected, select] = useState<[string, string, string]>();
  const [result, setResult] = useState<{ target: number; view: Solution3View }>();
  const waiting = awaitingFirstPlacement(shown);
  const groups = useMemo(() => completeObservationGroups(shown.observations, false), [shown]);
  const end = shown.observations.at(-1)?.sequence ?? 0;
  const target = cursor === null ? end : Math.min(cursor, end);
  useEffect(() => {
    if (waiting || shown.module === 'AHR') return;
    let active = true;
    api
      .solution3(id, target, detail)
      .then((view) => {
        if (active) {
          setResult({ target, view });
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [id, target, detail, waiting, shown.module]);
  const s = result?.target === target ? result.view : undefined;
  const cell =
    selected &&
    s?.rows.find((r) => r.name === selected[1] && r.table === selected[0])?.cells[selected[2]];
  return (
    <section className="panel knowledge" aria-label="解空间3">
      <h2>求解器3</h2>
      {error && <p role="alert">{error}</p>}
      {waiting ? (
        <p>等待第一轮回角色登场</p>
      ) : shown.module === 'AHR' ? (
        <p>AHR 不在本次范围内</p>
      ) : (
        <>
          <label>
            公开记录{' '}
            <select
              value={cursor === null ? 'live' : target}
              onChange={(e) => seek(e.target.value === 'live' ? null : Number(e.target.value))}
            >
              <option value="live">实时 · #{end}</option>
              <option value="0">开局</option>
              {groups.map((group) => {
                const o = group.at(-1)!;
                return (
                  <option key={o.sequence} value={o.sequence}>
                    #{o.sequence} · 第{o.loop}轮第{o.day}日 · {label(o.phase)}
                  </option>
                );
              })}
            </select>
          </label>
          {s ? (
            <>
              {s.conflict && <p role="alert">矛盾 · {s.conflict}</p>}
              <p>
                已处理至 #{s.through} · {s.partial ? '等待完整公告' : '已处理完整批次'} ·
                部分规则待验证
              </p>
              <p>√ 确定　× 排除　？限定集合　空白 尚无单格结论。高亮表示本批变化。</p>
              {(['角色身份', '规则', '真实事件', '事件当事人'] as const).map((table) => {
                const rows = s.rows.filter((r) => r.table === table),
                  columns = [...new Set(rows.flatMap((r) => Object.keys(r.cells)))];
                return (
                  <details key={table} open>
                    <summary>{table}</summary>
                    <div style={{ overflowX: 'auto' }}>
                      <table aria-label={table}>
                        <thead>
                          <tr>
                            <th>对象</th>
                            {columns.map((c) => (
                              <th key={c}>{labels[c] ?? c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.name}>
                              <th>{row.name}</th>
                              {row.hidden ? (
                                <td colSpan={columns.length || 1}>未登场</td>
                              ) : (
                                columns.map((col) => {
                                  const c = row.cells[col];
                                  if (!c) return <td key={col}>—</td>;
                                  return (
                                    <td
                                      key={col}
                                      title={c.reasons[0]}
                                      style={c.changed ? { backgroundColor: '#fff1ba' } : undefined}
                                    >
                                      {c.mark && (
                                        <button
                                          type="button"
                                          aria-label={row.name + ' ' + col + ' ' + c.mark + ' 证据'}
                                          onClick={() => select([table, row.name, col])}
                                        >
                                          {c.changed ? (
                                            <mark>
                                              <strong>{c.mark}</strong>
                                            </mark>
                                          ) : (
                                            c.mark
                                          )}
                                        </button>
                                      )}
                                    </td>
                                  );
                                })
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
              {selected && cell?.mark && (
                <section aria-label="所选命题的证据">
                  <h3>{selected.join(' · ')}</h3>
                  <ul>
                    {cell.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}
              {s.failureSources.length > 0 && (
                <p>本轮可生效的主线失败条件 · {s.failureSources.join('、')}</p>
              )}
              <p>
                本次读取检查来源 {s.work.sources.length} · 关系检查 {s.work.checks} · 局部组合{' '}
                {s.work.combinations} · 完整配置 {s.work.configurations}
              </p>
              <details open={detail} onToggle={(e) => setDetail(e.currentTarget.open)}>
                <summary>联合关系及证据</summary>
                {detail && (
                  <>
                    <p>
                      上个完整批次检查来源 {s.batchWork.sources.length} · 局部组合{' '}
                      {s.batchWork.combinations}
                    </p>
                    <p>{s.batchWork.sources.join('、')}</p>
                    <ol>
                      {s.relations.map((r, i) => (
                        <li key={i}>
                          {r.changed ? '本批新增 · ' : r.checked ? '本批检查 · ' : ''}
                          {r.description}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </details>
              <details>
                <summary>未决范围（{s.unresolved.length}）</summary>
                {s.unresolved.map((u) => (
                  <p key={u}>{u}</p>
                ))}
              </details>
            </>
          ) : (
            <p>读取公开记录</p>
          )}
        </>
      )}
    </section>
  );
}
