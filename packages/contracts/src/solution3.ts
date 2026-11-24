export interface Solution3Cell {
  mark: '' | '？' | '√' | '×';
  changed: boolean;
  reasons: string[];
}
export interface Solution3View {
  through: number;
  partial: boolean;
  conflict?: string;
  rows: {
    table: '角色身份' | '规则' | '真实事件' | '事件当事人';
    name: string;
    hidden: boolean;
    cells: Record<string, Solution3Cell>;
  }[];
  relations: { description: string; changed: boolean; checked: boolean }[];
  failureSources: string[];
  unresolved: string[];
  work: { checks: number; sources: string[]; combinations: number; configurations: number };
  batchWork: Solution3View['work'];
}
