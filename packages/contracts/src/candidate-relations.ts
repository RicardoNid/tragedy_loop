/** Read-only projections for display. Each producer supplies its own surviving tuples. */
export interface CandidateLiteral {
  key: string;
  value: string;
  negated?: boolean;
}
export interface CandidateClause {
  observation: number;
  fact: string;
  /** At least one branch must hold. All literals within a branch must hold together. */
  alternatives: CandidateLiteral[][];
}
export interface CandidatePair {
  left: string;
  right: string;
  /** These two sets of values cannot occur together. */
  excluded: { left: string[]; right: string[] }[];
}
export interface CandidateRelations {
  /** Presentation budget exhausted while summarizing these observations. */
  partiallyDisplayed?: number[];
  observations: CandidateClause[];
  pairs: CandidatePair[];
}

/** Aggregate already projected pairs for transport. Absence is meaningful only
 * after the caller has supplied all of its possible pairs, including unknowns. */
export class CandidatePairDisplay {
  private pairs = new Map<string, Map<string, Map<string, Set<string>>>>();
  /** A schedule tuple is one value throughout grouping and display. */
  recordEventPair(field: string, value: string, day: string, event: string, culprit: string) {
    this.add(field, 'schedule:' + day, value, JSON.stringify([event, culprit]));
  }
  record(left: string, right: string, a: string, b: string) {
    if (right === 'rule' || (left !== 'rule' && left > right)) return this.add(right, left, b, a);
    this.add(left, right, a, b);
  }
  private add(left: string, right: string, a: string, b: string) {
    let rights = this.pairs.get(left);
    if (!rights) this.pairs.set(left, (rights = new Map()));
    let rows = rights.get(right);
    if (!rows) rights.set(right, (rows = new Map()));
    let values = rows.get(a);
    if (!values) rows.set(a, (values = new Set()));
    values.add(b);
  }
  finish(): CandidatePair[] {
    const result: CandidatePair[] = [];
    for (const [left, rights] of this.pairs)
      for (const [right, rows] of rights) {
        const values = [...new Set([...rows.values()].flatMap((row) => [...row]))].sort();
        const groups = new Map<string, { left: string[]; right: string[] }>();
        for (const [a, allowed] of rows) {
          if (allowed.size === values.length) continue;
          let missing = values.filter((b) => !allowed.has(b));
          if (right.startsWith('schedule:')) {
            // Emit a triple only if all three binary projections still permit it.
            const present = [...allowed].map((pair) => JSON.parse(pair) as [string, string]);
            const events = new Set(present.map(([e]) => e));
            const culprits = new Set(present.map(([, c]) => c));
            missing = missing.filter((pair) => {
              const [e, c] = JSON.parse(pair) as [string, string];
              return events.has(e) && culprits.has(c);
            });
          }
          if (!missing.length) continue;
          const key = JSON.stringify(missing);
          let group = groups.get(key);
          if (!group) groups.set(key, (group = { left: [], right: missing }));
          group.left.push(a);
        }
        if (groups.size) result.push({ left, right, excluded: [...groups.values()] });
      }
    return result;
  }
}
