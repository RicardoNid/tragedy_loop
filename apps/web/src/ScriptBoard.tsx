import type { MastermindReviewView } from '../../../packages/contracts/src/review';
import { label, name } from './labels';

export function ScriptBoard({ view }: { view: MastermindReviewView }) {
  const { secret } = view;
  return (
    <section className="secret" aria-label="剧作家剧本信息">
      <h3>剧本规则</h3>
      <dl className="rule-list">
        <dt>规则 Y</dt>
        <dd>{secret.y}</dd>
        <dt>规则 X</dt>
        <dd>{secret.x.join('、')}</dd>
        {secret.alternateY && (
          <>
            <dt>备用规则 Y</dt>
            <dd>
              {secret.alternateY}
              {secret.activeAlternateY && '（已启用）'}
            </dd>
          </>
        )}
        {secret.secretAddition && (
          <>
            <dt>追加身份</dt>
            <dd>{secret.secretAddition}</dd>
          </>
        )}
        {secret.anniversaryFragment && (
          <>
            <dt>周年因果残片</dt>
            <dd>{name(secret.anniversaryFragment, view)}</dd>
          </>
        )}
        {secret.seatRoles && (
          <>
            <dt>主人公分工</dt>
            <dd>
              {Object.entries(secret.seatRoles)
                .map(([seat, role]) => label(seat) + ' · ' + role)
                .join('、')}
            </dd>
          </>
        )}
      </dl>
      <h3>全部角色（{secret.roster.length}）</h3>
      <div className="roster-scroll">
        <table aria-label="剧作家角色名册">
          <thead>
            <tr>
              <th>角色</th>
              <th>当前身份</th>
              <th>状态与位置</th>
              <th>剧本设定</th>
            </tr>
          </thead>
          <tbody>
            {secret.roster.map((c) => {
              const assigned = secret.characters.find((entry) => entry.id === c.id)?.identity;
              const status = c.status === 'absent' && c.appeared ? '暂不在场' : label(c.status);
              const details = [
                assigned && assigned !== c.identity && '剧本身份 ' + assigned,
                c.initialIdentity !== c.identity &&
                  c.initialIdentity !== assigned &&
                  '初始身份 ' + c.initialIdentity,
                c.reverseIdentity && '里身份 ' + c.reverseIdentity,
                c.initialArea && '起始于' + label(c.initialArea),
                c.enterDay && '第 ' + c.enterDay + ' 日登场',
                c.enterLoop && '第 ' + c.enterLoop + ' 轮登场',
                c.territory && '领地 ' + label(c.territory),
                c.copiedFrom && '复制 ' + name(c.copiedFrom, view),
                c.x !== undefined && 'X = ' + c.x,
              ].filter(Boolean);
              return (
                <tr key={c.id}>
                  <th scope="row">{c.character}</th>
                  <td>{c.identity}</td>
                  <td>
                    {status}
                    {c.status !== 'absent' && ' · ' + label(c.area)}
                  </td>
                  <td>{details.join('、') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>真实事件日程</h3>
      {secret.incidents.length ? (
        <ul>
          {secret.incidents.map((e, i) => (
            <li key={i}>
              第 {e.day} 日 · {e.name} · 当事人 {name(e.culprit, view)}
              {e.publicName && e.publicName !== e.name && '（公开名：' + e.publicName + '）'}
            </li>
          ))}
        </ul>
      ) : (
        <p>本剧本无预定事件</p>
      )}
      {!!secret.occurred.length && (
        <>
          <h3>已发生事件</h3>
          <ul>
            {secret.occurred.map((e, i) => (
              <li key={i}>
                第 {e.loop} 轮第 {e.day} 日 · {e.name} · 当事人 {name(e.culprit, view)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
