import { useEffect, useRef, useState } from 'react';
export function ImportDialog({
  kind,
  close,
  submit,
}: {
  kind: '问题' | '策略';
  close(): void;
  submit(value: unknown, name: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  function accept() {
    try {
      const value = JSON.parse(source.replace(/^\uFEFF/, ''));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      submit(value, name || '导入的' + kind);
    } catch {
      setError('请粘贴一份完整的 JSON 对象。');
    }
  }
  return (
    <dialog ref={dialog} onCancel={close} aria-labelledby="import-title">
      <div className="panel-heading">
        <h2 id="import-title">导入{kind}</h2>
        <button aria-label="关闭" onClick={close}>
          ×
        </button>
      </div>
      <p>
        {kind === '问题'
          ? '支持候选重放或完整观察。剧本输入仅在本地处理。'
          : '可读取策略树、求解结果或观察求解结果。'}
      </p>
      <label className="file-label">
        选择 JSON 文件
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              if (f.size > 2 * 1024 * 1024) {
                setError('文件超过 2 MiB。');
                return;
              }
              setSource(await f.text());
              setName(f.name);
              setError('');
            } catch {
              setError('文件读取失败。');
            }
          }}
        />
      </label>
      <label className="json-label">
        JSON 内容
        <textarea
          rows={10}
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button onClick={close}>取消</button>
        <button className="primary" onClick={accept}>
          载入{kind}
        </button>
      </div>
    </dialog>
  );
}
