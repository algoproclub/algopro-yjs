import type { Extension, onRequestPayload } from '@hocuspocus/server';
import { text as readStreamText } from 'node:stream/consumers';
import * as Y from 'yjs';

type CopyFileBody = {
  sourceFile?: unknown;
  targetFile?: unknown;
  securityKey?: unknown;
};

export class CopyFileAPI implements Extension {
  async onRequest(data: onRequestPayload) {
    const { request, response, instance } = data;
    const url = new URL(
      `http://${process.env.HOST ?? 'localhost'}${request.url}`
    );

    const sendError = (code: number, message: string) => {
      response.writeHead(code, { 'Content-Type': 'text/plain' });
      response.end(message);
      return Promise.reject();
    };

    if (url.pathname === '/copyFile') {
      if (request.method !== 'POST') {
        return sendError(405, 'Invalid method. Only POST is allowed.');
      }

      const body = await readStreamText(request).catch(() => null);

      if (body === null) {
        return sendError(400, 'Failed to read request body');
      }

      let payload: CopyFileBody;
      try {
        payload = JSON.parse(body) as CopyFileBody;
      } catch {
        return sendError(400, 'Invalid JSON body');
      }

      const { sourceFile, targetFile, securityKey } = payload;

      if (securityKey !== process.env.SECURITY_KEY) {
        return sendError(401, 'Unauthorized');
      }

      if (
        typeof sourceFile !== 'string' ||
        !sourceFile.match(/^[a-zA-Z0-9_\-.]+$/)
      ) {
        return sendError(400, 'Invalid source file name');
      }

      if (
        typeof targetFile !== 'string' ||
        !targetFile.match(/^[a-zA-Z0-9_\-.]+$/)
      ) {
        return sendError(400, 'Invalid target file name');
      }

      const sourceConnection = await instance.openDirectConnection(sourceFile);
      const targetConnection = await instance.openDirectConnection(targetFile);

      try {
        let sourceUpdate: Uint8Array | undefined;

        await sourceConnection.transact(sourceDoc => {
          if (sourceDoc.getMap('isInitialized').get('isInitialized') === true) {
            sourceUpdate = Y.encodeStateAsUpdate(sourceDoc);
          }
        });

        if (!sourceUpdate) {
          return sendError(400, "Source file doesn't exist");
        }

        const update = sourceUpdate;

        let targetExists = false;

        await targetConnection.transact(targetDoc => {
          targetExists =
            targetDoc.getMap('isInitialized').get('isInitialized') === true;

          if (!targetExists) {
            Y.applyUpdate(targetDoc, update);
          }
        });

        if (targetExists) {
          return sendError(400, 'Target document already exists');
        }

        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('OK');
      } finally {
        await sourceConnection.disconnect();
        await targetConnection.disconnect();
      }

      return Promise.reject();
    }
  }
}
