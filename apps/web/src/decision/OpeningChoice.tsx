import { useId, useState } from 'react';
import type { DecisionAnalysis, PolicyView } from '../../../../packages/contracts/src/decision.js';
import type { Choice } from '../../../../packages/contracts/src/game.js';
import { action, cardNames, target } from './labels.js';

export function OpeningChoice({
  data,
  view,
  busy,
  evaluate,
}: {
  data: DecisionAnalysis;
  view: PolicyView;
  busy: boolean;
  evaluate: (choice: Choice) => void;
}) {
  const menu = view.menu;
  const hand = view.ownCards.filter((c) => c.owner === menu.actor && c.status === 'hand');
  const count = data.actionInput?.cardCount ?? 1;
  const [placements, setPlacements] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      card: hand[i]?.id ?? '',
      target: view.targets?.[i] ?? '',
    })),
  );
  const [option, setOption] = useState(0);
  const guessed = new Set(
    view.reports
      .filter(
        (o) =>
          o.phase === 'final-guess' &&
          o.type === 'identity' &&
          o.data.correct === true &&
          typeof o.data.guess === 'string',
      )
      .map((o) => o.data.character),
  );
  const available = view.characters.filter((c) => c.status !== 'absent' && !guessed.has(c.id));
  const [who, setWho] = useState(available[0]?.id ?? '');
  const roles = data.actionInput?.identities ?? [];
  const [identity, setIdentity] = useState(roles[0] ?? '');
  const [reverse, setReverse] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const days = data.sheet?.incidents.map((i) => i.day) ?? [];
  const roster = useId();
  let choice: Choice | undefined;
  if (menu.kind === 'cards') {
    if (
      placements.length === count &&
      placements.every((p) => p.card && p.target) &&
      new Set(placements.map((p) => p.card)).size === count &&
      new Set(placements.map((p) => p.target)).size === count
    )
      choice = { kind: 'cards', placements };
  } else if (view.answerKind === 'identities') {
    if (who && identity)
      choice = {
        kind: 'guess',
        character: who,
        identity,
        ...(reverse && { reverseIdentity: reverse }),
      };
  } else if (view.answerKind === 'culprits') {
    if (days.every((d) => answers[d]?.trim()))
      choice = {
        kind: 'guess-culprits',
        answers: Object.fromEntries(days.map((d) => [d, answers[d]!.trim()])),
      };
  } else choice = menu.options[option];
  const setPlacement = (index: number, field: 'card' | 'target', value: string) =>
    setPlacements((list) => list.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  return (
    <details className="opening">
      <summary>评估指定行动</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (choice && !busy) evaluate(choice);
        }}
      >
        {menu.kind === 'cards' ? (
          placements.map((p, i) => (
            <div className="opening-row" key={i}>
              <label>
                行动牌
                <select
                  aria-label={count === 1 ? '行动牌' : '行动牌 ' + (i + 1)}
                  value={p.card}
                  onChange={(e) => setPlacement(i, 'card', e.target.value)}
                >
                  {hand.map((c) => (
                    <option key={c.id} value={c.id}>
                      {cardNames[c.kind]} · {c.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                放置目标
                <select
                  aria-label={count === 1 ? '放置目标' : '放置目标 ' + (i + 1)}
                  value={p.target}
                  onChange={(e) => setPlacement(i, 'target', e.target.value)}
                >
                  {view.targets?.map((id) => (
                    <option key={id} value={id}>
                      {target(id, view)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))
        ) : view.answerKind === 'identities' ? (
          <div className="opening-row">
            <label>
              回答角色
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.character}
                  </option>
                ))}
              </select>
            </label>
            <label>
              初始身份
              <select value={identity} onChange={(e) => setIdentity(e.target.value)}>
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {data.module === 'AHR' && (
              <label>
                里身份
                <select value={reverse} onChange={(e) => setReverse(e.target.value)}>
                  <option value="">无</option>
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : view.answerKind === 'culprits' ? (
          <div className="opening-row">
            <datalist id={roster}>
              {view.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.character}
                </option>
              ))}
            </datalist>
            {days.map((day) => (
              <label key={day}>
                第 {day} 天的当事人
                <input
                  list={roster}
                  value={answers[day] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [day]: e.target.value })}
                />
              </label>
            ))}
          </div>
        ) : (
          <label>
            当前行动
            <select value={option} onChange={(e) => setOption(Number(e.target.value))}>
              {menu.options.map((c, i) => (
                <option value={i} key={i}>
                  {action(c, view)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" disabled={busy || !choice}>
          求解此行动的后续
        </button>
      </form>
    </details>
  );
}
