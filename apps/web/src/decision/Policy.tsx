import { useState } from 'react';
import type { PolicyNode, PolicyView } from '../../../../packages/contracts/src/decision.js';
import { action, phases, reportName } from './labels.js';

export function Policy({ policy, rootView }: { policy: PolicyNode; rootView?: PolicyView }) {
  const [route, setRoute] = useState<number[]>([]);
  let node = policy,
    view = rootView;
  for (const i of route) {
    const branch = node.responses[i]!;
    node = branch.then;
    view = branch.when;
  }
  return (
    <section className="strategy" aria-label="策略树">
      <div className="action-label">{route.length ? '后续行动' : '推荐行动'}</div>
      <h3>{action(node.choice, view)}</h3>
      {route.length > 0 && (
        <button className="text-button" onClick={() => setRoute(route.slice(0, -1))}>
          ← 上一步
        </button>
      )}
      {node.responses.length ? (
        <div className="branches">
          <h4>下一次提问</h4>
          {node.responses.map((branch, i) => (
            <details key={i}>
              <summary>
                {phases[branch.when.phase]} · 第 {branch.when.day} 天
                {node.responses.length > 1 && ' · 观察 ' + (i + 1)}
              </summary>
              <div className="branch-body">
                <p>
                  {[...new Set(branch.when.reports.map(reportName))].join('、') || '无新增公告'}
                </p>
                <details>
                  <summary>查看完整观察条件</summary>
                  <pre>{JSON.stringify(branch.when, null, 2)}</pre>
                </details>
                <button onClick={() => setRoute([...route, i])}>查看应对 →</button>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className="leaf">此分支已无需再作选择。</p>
      )}
    </section>
  );
}
