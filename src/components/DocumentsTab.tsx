import { useState } from 'react';
import { declgenApi, upload } from '../api';
import type { AppState } from '../types';
import { Button, Card, Empty, Field } from './common';

export function DocumentsTab({
  state,
  run,
  refresh,
}: {
  state: AppState;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  refresh: () => Promise<unknown>;
}) {
  const [folder, setFolder] = useState('');
  const entries = Object.entries(state.dossier || {});

  async function chooseFolder() {
    const chosen = await window.desktop.selectFolder();
    if (chosen) setFolder(chosen);
  }

  async function loadFolder() {
    let p = folder.trim();
    while (
      p.length >= 2 &&
      ((p.startsWith('"') && p.endsWith('"')) ||
        (p.startsWith("'") && p.endsWith("'")))
    )
      p = p.slice(1, -1).trim();
    if (!p) return;
    const res = await run(() => declgenApi.selectFolder(p));
    if (res.ok === false)
      window.alert(res.error || 'Папката не може да бъде заредена.');
    await refresh();
  }

  async function chooseFiles() {
    if (window.desktop.uploadBrowserFiles) {
      const res = await run(() =>
        window.desktop.uploadBrowserFiles!('dossier'),
      );
      if (res.ok === false && !res.cancelled)
        window.alert(res.error || 'Качването не успя.');
      await refresh();
      return;
    }
    const paths = await window.desktop.selectFiles('dossier');
    if (!paths.length) return;
    const res = await run(() => upload('/api/dossier/upload', paths));
    if (res.ok === false) window.alert(res.error || 'Качването не успя.');
    await refresh();
  }

  return (
    <div className="stack gap-lg">
      <Card title="Хъб за документи">
        <div className="toolbar wrap">
          {!window.desktop.uploadBrowserFiles ? (
            <Field label="Папка на същата Windows машина">
              <div className="inline">
                <input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="Изберете или поставете папка…"
                />
                <Button onClick={chooseFolder}>Папка…</Button>
              </div>
            </Field>
          ) : null}
          <div className="toolbar-actions">
            {!window.desktop.uploadBrowserFiles ? (
              <Button kind="primary" onClick={loadFolder}>
                Зареди папката
              </Button>
            ) : null}
            <Button onClick={chooseFiles}>Избери файлове…</Button>
          </div>
        </div>
      </Card>
      <Card title={`Документи (${entries.length})`}>
        {!entries.length ? (
          <Empty>Няма заредени документи.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Тип</th>
                  <th>Доверие</th>
                  <th>OCR</th>
                  {typeof window !== 'undefined' &&
                  (window as unknown as { desktop?: { openPath?: unknown } })
                    .desktop?.openPath ? (
                    <th></th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {entries.map(([name, doc]) => (
                  <tr key={name}>
                    <td>
                      {(() => {
                        const dp = (
                          window as unknown as {
                            desktop?: {
                              openPath?: (
                                p: string,
                              ) => Promise<{ ok: boolean; error?: string }>;
                            };
                          }
                        ).desktop?.openPath;
                        return doc.source && dp ? (
                          <button
                            className="linklike"
                            title="Отвори файла"
                            onClick={async () => {
                              const r = await dp(String(doc.source));
                              if (!r.ok)
                                window.alert(
                                  r.error || 'Файлът не може да се отвори.',
                                );
                            }}
                          >
                            {name}
                          </button>
                        ) : (
                          name
                        );
                      })()}
                    </td>
                    <td>{doc.type || 'файл'}</td>
                    <td>{doc.confidence || '—'}</td>
                    <td>
                      {doc.scanned_without_text || doc.needs_ocr ? 'да' : 'не'}
                    </td>
                    {(
                      window as unknown as {
                        desktop?: {
                          openPath?: (
                            p: string,
                          ) => Promise<{ ok: boolean; error?: string }>;
                        };
                      }
                    ).desktop?.openPath ? (
                      <td>
                        {doc.source ? (
                          <Button
                            onClick={async () => {
                              const r = await (
                                window as unknown as {
                                  desktop: {
                                    openPath: (
                                      p: string,
                                    ) => Promise<{
                                      ok: boolean;
                                      error?: string;
                                    }>;
                                  };
                                }
                              ).desktop.openPath(String(doc.source));
                              if (!r.ok)
                                window.alert(
                                  r.error || 'Файлът не може да се отвори.',
                                );
                            }}
                          >
                            Отвори
                          </Button>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
