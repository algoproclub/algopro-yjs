import type { Extension, onChangePayload } from '@hocuspocus/server';
import { type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export class StatsSync implements Extension {
  readonly app: App;
  readonly chunkSize = 100;
  instance: onChangePayload['instance'] | null = null;
  updateTimes = new Map<string, number>();
  activeRuns = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(app: App) {
    this.app = app;
    this.timer = setInterval(() => {
      void this.runSync();
    }, 30000);
    this.timer.unref();
  }

  async onDestroy() {
    clearInterval(this.timer);
  }

  private async runSync() {
    if (this.instance === null || this.updateTimes.size === 0) {
      return;
    }

    const started = performance.now();
    const documents = this.updateTimes.size;
    this.activeRuns++;
    console.log(
      JSON.stringify({
        event: 'stats_sync_start',
        documents,
        activeRuns: this.activeRuns,
      })
    );
    let completed = false;
    try {
      await this.sync();
      completed = true;
    } catch (error) {
      console.error('Stats sync failed', error);
    } finally {
      this.activeRuns--;
      console.log(
        JSON.stringify({
          event: 'stats_sync_end',
          documents,
          durationMs: Math.round(performance.now() - started),
          activeRuns: this.activeRuns,
          completed,
        })
      );
    }
  }

  private async sync() {
    if (this.instance === null || this.updateTimes.size === 0) {
      return;
    }

    const instance = this.instance;
    const dbRoot = getDatabase(this.app).ref('files');
    const changed = this.updateTimes;
    this.updateTimes = new Map<string, number>();

    const readResults = await Promise.allSettled(
      changed.entries().map(async ([documentName, editTime]) => {
        const fileID = documentName.split('.')[0];
        const connection = await instance.openDirectConnection(documentName);

        try {
          let codeSize = 0;

          await connection.transact(document => {
            codeSize = document.getText('monaco').length;
          });

          return { fileID, editTime, codeSize };
        } finally {
          await connection.disconnect();
        }
      })
    );

    const failures = readResults.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      console.error(
        JSON.stringify({
          event: 'stats_sync_document_errors',
          failedDocuments: failures.length,
          totalDocuments: readResults.length,
        })
      );
      // Bound error output even if an entire batch fails.
      for (const failure of failures.slice(0, 3)) {
        console.error('Stats sync document failed', failure.reason);
      }
    }

    const teacherUpdates = readResults.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : []
    );

    if (teacherUpdates.length === 0) {
      return;
    }

    for (let i = 0; i < teacherUpdates.length; i += this.chunkSize) {
      const chunk = teacherUpdates.slice(i, i + this.chunkSize);

      const payload: Record<
        string,
        {
          codeSize: number;
          editTime: number;
        }
      > = {};

      chunk.forEach(({ fileID, editTime, codeSize }) => {
        payload[`${fileID}/teacher`] = { codeSize, editTime };
      });

      await dbRoot.update(payload);
    }
  }

  async onChange(data: onChangePayload) {
    this.instance = data.instance;

    const extension = data.documentName.split('.')[1];
    if (!['cpp', 'java', 'py'].includes(extension)) {
      return;
    }

    this.updateTimes.set(data.documentName, Date.now());
  }
}
