/** Offline prototype. Each trace is the net public result of a single legal
 * local execution, after replacements and simultaneous settlement. */
export interface LocalExplanation {
  id: string;
  literals: readonly string[];
  traces: readonly (readonly string[])[];
  exhaustive: boolean;
}
export function reverseWindow(
  explanations: readonly LocalExplanation[],
  // Each entry represents one completely delivered batch. Its string is a
  // canonical public signature in the caller's observation scope.
  batches: readonly string[],
  closure: 'open' | 'complete' | 'gap',
) {
  const rejected: string[] = [];
  const supported: LocalExplanation[] = [];
  for (const branch of explanations) {
    const compatible = branch.traces.some(
      (trace) =>
        (closure !== 'complete' || trace.length === batches.length) &&
        batches.every((batch, i) => trace[i] === batch),
    );
    if (closure === 'gap' || compatible || !branch.exhaustive) supported.push(branch);
    else rejected.push(branch.id);
  }
  // Disjunction of whole conjunctions. Never form a Cartesian product of their columns.
  return {
    rejected,
    alternatives: supported.map((branch) => branch.literals),
    conflict: !supported.length,
  };
}
