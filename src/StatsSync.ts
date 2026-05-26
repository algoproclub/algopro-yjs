import type { Extension, onChangePayload } from '@hocuspocus/server';
import { type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export class StatsSync implements Extension {
  readonly app: App;
  readonly chunkSize = 100;
  instance: onChangePayload['instance'] | null = null;
  updateTimes = new Map<string, number>();

  constructor(app: App) {
    this.app = app;
    setInterval(() => {
      void this.sync();
    }, 30000);
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
