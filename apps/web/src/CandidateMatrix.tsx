/** Each cell is a marginal possibility, never an independently combinable complete solution. */
export function CandidateMatrix({
  title,
  heading,
  columns,
  rows,
}: {
  title: string;
  heading: string;
  columns: string[];
  rows: {
    id: string;
    label: string;
    values: string[];
    verified: string[];
    implied?: { identity: string; observation: number };
  }[];
}) {
  return (
    <div className="knowledge-table" role="region" aria-label={`${title}滚动区域`} tabIndex={0}>
      <table className="candidate-matrix" aria-label={title}>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{heading}</th>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
            <th scope="col">剩余</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {columns.map((column) => {
                const state = !row.values.includes(column)
                  ? 'excluded'
                  : row.values.length === 1 &&
                      (row.verified.includes(column) || row.implied?.identity === column)
                    ? 'certain'
                    : 'pending';
                const label = {
                  excluded: '确定不是',
                  certain: '确定是',
                  pending: '可能是',
                }[state];
                return (
                  <td
                    key={column}
                    className={`candidate-${state}`}
                    aria-label={`${row.label} · ${column}：${label}`}
                    title={
                      row.implied?.identity === column
                        ? `公开观察 #${row.implied.observation} 的所有相容解释均要求此身份`
                        : label
                    }
                  >
                    <span aria-hidden="true">
                      {{ excluded: '×', certain: '✓', pending: '?' }[state]}
                    </span>
                  </td>
                );
              })}
              <td>{row.values.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
