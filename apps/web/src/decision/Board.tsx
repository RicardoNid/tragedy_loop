import type { DecisionAnalysis, PolicyView } from '../../../../packages/contracts/src/decision.js';
import type { Area, Counter } from '../../../../packages/contracts/src/game.js';
import { areas, counters, phases, actor, cardNames, target } from './labels.js';

export function Board({ view, sheet }: { view: PolicyView; sheet?: DecisionAnalysis['sheet'] }) {
  const shown: Area[] = ['hospital', 'shrine', 'city', 'school'];
  if (view.characters.some((c) => c.area === 'far')) shown.push('far');
  return (
    <section className="panel board-panel" aria-label="公开盘面">
      <div className="panel-heading">
        <h2>公开盘面</h2>
        <span>
          第 {view.loop}
          {sheet && ' / ' + sheet.loops} 轮回 · 第 {view.day}
          {sheet && ' / ' + sheet.days} 天
        </span>
      </div>
      <div className="board-grid">
        {shown.map((area) => {
          const people = view.characters.filter((c) => c.area === area && c.status !== 'absent');
          const setting = view.phase === 'mastermind-cards' || view.phase === 'protagonist-cards';
          const placed = setting
            ? view.placements.filter(
                (p) => p.target === area || people.some((c) => c.id === p.target),
              )
            : [];
          return (
            <article className={'place place-' + area} key={area}>
              <div className="place-heading">
                <h3>{areas[area]}</h3>
                {area !== 'far' && <span>密谋 {view.boards[area]}</span>}
              </div>
              <ul>
                {people.map((c) => (
                  <li key={c.id}>
                    <strong>{c.character}</strong>
                    {c.status !== 'alive' && <small>{c.status === 'dead' ? '死亡' : '离场'}</small>}
                    {Object.entries(c.counters)
                      .filter(([, n]) => n > 0)
                      .map(([key, n]) => (
                        <small key={key}>
                          {counters[key as Counter]} {n}
                        </small>
                      ))}
                  </li>
                ))}
              </ul>
              {!people.length && <span className="empty">无人</span>}
              {placed.length > 0 && (
                <div className="placed">
                  {placed.map((p) => {
                    const card = view.ownCards.find((c) => c.id === p.card);
                    return (
                      <div key={p.owner + '/' + p.target}>
                        {actor(p.owner)} · {card ? cardNames[card.kind] : '暗置牌'}
                        {p.target !== area && ' → ' + target(p.target, view)}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="board-foot">
        <span>{phases[view.phase]}</span>
        <span>
          {actor(view.menu.actor)}行动{view.personalRole && ' · Ex ' + view.personalRole}
        </span>
      </div>
      <details className="observations">
        <summary>查看观察记录（{view.reports.length}）</summary>
        {sheet && (
          <p>
            事件表　
            {sheet.incidents.map((i) => '第 ' + i.day + ' 天 ' + i.name).join('、') || '无事件'}
          </p>
        )}
        <pre>{JSON.stringify(view, null, 2)}</pre>
      </details>
    </section>
  );
}
