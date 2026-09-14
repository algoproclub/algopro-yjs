import type { Extension, onRequestPayload } from '@hocuspocus/server';
import * as Y from 'yjs';

type CopyFileBody = {
  sourceFile?: unknown;
  targetFile?: unknown;
  securityKey?: unknown;
};

const maxBodyBytes = 64 * 1024;

export class CopyFileAPI implements Extension {
  async onRequest(data: onRequestPayload) {
    const { request, response, instance } = data;
    const url = new URL(
      `http://${process.env.HOST ?? 'localhost'}${request.url}`
    );

    const sendResponse = (code: number, message: string) => {
      if (code === 413) {
        response.setHeader('Connection', 'close');
        request.resume();
      }
      response.writeHead(code, { 'Content-Type': 'text/plain' });
      response.end(message);
      return Promise.reject();
    };

    if (url.pathname === '/copyFile') {
      if (request.method !== 'POST') {
        return sendResponse(405, 'Invalid method. Only POST is allowed.');
      }

      if (Number(request.headers['content-length']) > maxBodyBytes) {
        return sendResponse(413, 'Request body too large');
      }

      const body = Buffer.alloc(maxBodyBytes);
      let bodyBytes = 0;
      let bodyTooLarge = false;
      try {
        for await (const chunk of request.iterator({
          destroyOnReturn: false,
        })) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (bodyBytes + buffer.length > maxBodyBytes) {
            bodyTooLarge = true;
            break;
          }
          buffer.copy(body, bodyBytes);
          bodyBytes += buffer.length;
        }
      } catch {
        return sendResponse(400, 'Failed to read request body');
      }

      if (bodyTooLarge) {
        return sendResponse(413, 'Request body too large');
      }

      let payload: CopyFileBody;
      try {
        payload = JSON.parse(
          body.toString('utf8', 0, bodyBytes)
        ) as CopyFileBody;
      } catch {
        return sendResponse(400, 'Invalid JSON body');
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return sendResponse(400, 'Invalid JSON body');
      }

      const { sourceFile, targetFile, securityKey } = payload;

      if (securityKey !== process.env.SECURITY_KEY) {
        return sendResponse(401, 'Unauthorized');
      }

      if (
        typeof sourceFile !== 'string' ||
        !sourceFile.match(/^[a-zA-Z0-9_\-.]+$/)
      ) {
        return sendResponse(400, 'Invalid source file name');
      }

      if (
        typeof targetFile !== 'string' ||
        !targetFile.match(/^[a-zA-Z0-9_\-.]+$/)
      ) {
        return sendResponse(400, 'Invalid target file name');
      }

      const connections: Awaited<
        ReturnType<typeof instance.openDirectConnection>
      >[] = [];
      let statusCode = 200;
      let message = 'OK';

      try {
        const sourceConnection =
          await instance.openDirectConnection(sourceFile);
        connections.push(sourceConnection);
        let sourceUpdate: Uint8Array | undefined;

        await sourceConnection.transact(sourceDoc => {
          if (sourceDoc.getMap('isInitialized').get('isInitialized') === true) {
            sourceUpdate = Y.encodeStateAsUpdate(sourceDoc);
          }
        });

        if (!sourceUpdate) {
          statusCode = 400;
          message = "Source file doesn't exist";
        } else {
          const targetConnection =
            await instance.openDirectConnection(targetFile);
          connections.push(targetConnection);
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
            statusCode = 400;
            message = 'Target document already exists';
          }
        }
      } catch (error) {
        console.error(
          'Failed to copy file:',
          error instanceof Error ? error.message : error
        );
        statusCode = 500;
        message = 'Failed to copy file';
      } finally {
        const results = await Promise.allSettled(
          connections.map(connection => connection.disconnect())
        );
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error(
              'Failed to disconnect copied document:',
              result.reason instanceof Error
                ? result.reason.message
                : result.reason
            );
            if (statusCode === 200) {
              statusCode = 500;
              message = 'Failed to copy file';
            }
          }
        }
      }

      return sendResponse(statusCode, message);
    }
  }
}
