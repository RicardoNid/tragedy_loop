import { compileOfficial } from '../../../packages/content/src/official/index.js';
import { LiveKnowledge } from '../../../packages/engine/src/runtime/knowledge-live.js';
import type { KnowledgeInput } from '../../../packages/contracts/src/knowledge.js';

let solver: LiveKnowledge | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSend = 0;
let publishedRevision = -1;
function work() {
  if (!solver) return;
  try {
    solver.tick(15);
    const done = solver.paused;
    if (Date.now() - lastSend > 250 || done) {
      process.send?.(solver.snapshot());
      lastSend = Date.now();
    }
    if (!done) timer = setTimeout(work, 15);
  } catch (error) {
    process.send?.({ error: String(error) });
  }
}
process.on('message', (input: KnowledgeInput) => {
  try {
    const previousCount = solver?.observationCount;
    solver ??= new LiveKnowledge(
      compileOfficial(input.opening.module, input.opening.anniversary),
      input.opening,
    );
    if (input.after === undefined) solver.update(input.history, input.revision);
    else solver.append(input.history, input.after, input.revision);
    if (
      !input.verifyAll &&
      previousCount === solver.observationCount &&
      input.revision <= publishedRevision
    )
      return;
    if (timer) clearTimeout(timer);
    if (input.verifyAll) solver.verifyCombinations();
    publishedRevision = Math.max(publishedRevision, input.revision);
    // Candidate domains are immediately available; witness search is a separate progress stream.
    process.send?.(solver.snapshot());
    lastSend = Date.now();
    if (!solver.paused) timer = setTimeout(work, 0);
  } catch (error) {
    process.send?.({ error: String(error) });
  }
});
