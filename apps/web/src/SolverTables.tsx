import type { ComponentProps } from 'react';
import { CandidateMatrix } from './CandidateMatrix';

/** Presentation only. Each solver supplies its own candidate judgments. */
export function SolverTables({
  identities,
  rules,
  events,
}: {
  identities?: Pick<ComponentProps<typeof CandidateMatrix>, 'columns' | 'rows'>;
  rules: { name: string; state: '✓' | '?' | '×' }[];
  events: { day: string; names: string; culprits: string }[];
}) {
  return (
    <>
      <p className="muted solver-legend">✓ 确定是 · × 确定不是 · ? 可能是</p>
      {identities && <CandidateMatrix title="角色 × 初始身份" heading="角色" {...identities} />}
      <div className="knowledge-table" tabIndex={0}>
        <table aria-label="规则表格">
          <caption>规则</caption>
          <thead>
            <tr>
              <th scope="col">规则</th>
              <th scope="col">是否采用</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.name}>
                <th scope="row">{rule.name}</th>
                <td>{rule.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="knowledge-table" tabIndex={0}>
        <table aria-label="事件表格">
          <caption>事件</caption>
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">真实事件候选</th>
              <th scope="col">当事人候选</th>
            </tr>
          </thead>
          <tbody>
            {events.length ? (
              events.map((event) => (
                <tr key={event.day}>
                  <th scope="row">第 {event.day} 日</th>
                  <td>{event.names}</td>
                  <td>{event.culprits}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>无事件</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
