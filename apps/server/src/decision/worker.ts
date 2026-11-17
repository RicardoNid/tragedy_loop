import { analyze, type AnalysisRequest } from './analyze.js';

process.once('message', (request: AnalysisRequest) => {
  try {
    process.send!({ ok: true, result: analyze(request) }, () => process.disconnect());
  } catch (e) {
    process.send!({ ok: false, error: e instanceof Error ? e.message : '局面无法读取' }, () =>
      process.disconnect(),
    );
  }
});
