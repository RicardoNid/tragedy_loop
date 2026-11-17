import { useState } from 'react';
import type { DecisionAnalysis } from '../../../../packages/contracts/src/decision.js';
import type {
  Hypothesis,
  InvestigationOptions,
  InvestigationTarget,
} from '../../../../packages/contracts/src/investigation.js';
import { action, phases, reasons, target } from './labels.js';

export function Investigation({
  data,
  busy,
  submit,
}: {
  data: DecisionAnalysis;
  busy: boolean;
  submit(options: InvestigationOptions): void;
}) {
  const root = data.view!;
  const subjects: { value: InvestigationTarget; label: string }[] = [
    ...root.characters.map((c) => ({
      value: { kind: 'identity' as const, character: c.id },
      label: c.character + '的初始身份',
    })),
    ...(data.sheet?.incidents ?? []).map((i) => ({
      value: { kind: 'culprit' as const, day: i.day },
      label: '第 ' + i.day + ' 天' + i.name + '的当事人',
    })),
  ];
  const [selected, setSelected] = useState(
    JSON.stringify(data.suggestedInvestigation?.target ?? subjects[0]?.value),
  );
  const [depth, setDepth] = useState(String(data.suggestedInvestigation?.maxAbilities ?? 1));
  const [path, setPath] = useState<number[]>([]);
  const result =
    data.investigation &&
    JSON.stringify(data.investigation.options.target) === selected &&
    (data.investigation.options.maxAbilities ?? 1) === Number(depth)
      ? data.investigation.result
      : undefined;
  let node = result?.plan,
    view: Pick<typeof root, 'characters' | 'ownCards'> = root;
  for (const i of path) {
    if (node?.kind !== 'act' || !node.responses[i]) break;
    const r = node.responses[i]!;
    node = r.then;
    view = r.when.view;
  }
  const display = (a: Hypothesis) =>
    'culprit' in a
      ? target(a.culprit, root)
      : [a.identity, a.reverseIdentity].filter(Boolean).join('／');
  return (
    <section className="panel investigation">
      <div className="panel-heading">
        <h2>调查解空间</h2>
        <span>当前主人公能力阶段</span>
      </div>
      <p>比较每项行动后仍可能成立的答案，选择最坏情况下余项最少的路线。</p>
      <div className="controls">
        <label>
          调查对象
          <select
            aria-label="调查对象"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPath([]);
            }}
          >
            {subjects.map((s) => (
              <option key={JSON.stringify(s.value)} value={JSON.stringify(s.value)}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          最多发动
          <input
            aria-label="调查发动上限"
            type="number"
            min="0"
            value={depth}
            onChange={(e) => {
              setDepth(e.target.value);
              setPath([]);
            }}
          />
        </label>
        <button
          disabled={
            busy || !selected || !/^\d+$/.test(depth) || !Number.isSafeInteger(Number(depth))
          }
          onClick={() => {
            const selection = subjects.find((s) => JSON.stringify(s.value) === selected);
            if (selection) {
              setPath([]);
              submit({ target: selection.value, maxAbilities: Number(depth) });
            }
          }}
        >
          求解调查
        </button>
      </div>
      {result && (
        <div className="verdict" role="status">
          <strong>
            {result.status === 'optimal'
              ? '已确定最优调查'
              : result.status === 'no-candidates'
                ? '没有相容候选'
                : '调查尚无定论'}
          </strong>
          {result.reason && <p>{reasons[result.reason]}</p>}
          {result.worstRemaining !== undefined && (
            <p>
              当前 {result.answers?.length} 种答案 · 这条路线最坏剩 {result.worstRemaining} 种
            </p>
          )}
          {node && (
            <div className="strategy">
              {node.kind === 'stop' ? (
                <p>结束调查后仍可能是{node.answers.map(display).join('、')}。</p>
              ) : (
                <>
                  <div className="action-label">调查行动</div>
                  <h3>{action(node.choice, view)}</h3>
                  {node.responses.map((r, i) => (
                    <details key={i}>
                      <summary>
                        观察 {i + 1} · {phases[r.when.view.phase]}
                      </summary>
                      <pre>{JSON.stringify(r.when.view, null, 2)}</pre>
                      <button onClick={() => setPath([...path, i])}>查看调查应对</button>
                    </details>
                  ))}
                </>
              )}
              {!!path.length && (
                <button className="text-button" onClick={() => setPath(path.slice(0, -1))}>
                  ← 返回调查上一步
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
