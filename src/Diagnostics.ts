import type { Extension, onListenPayload } from '@hocuspocus/server';
import { getHeapStatistics } from 'node:v8';
import { performance } from 'node:perf_hooks';
import { Text } from 'yjs';
import type { FirebaseAuth } from './FirebaseAuth.js';
import type { StatsSync } from './StatsSync.js';

export class Diagnostics implements Extension {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly auth: FirebaseAuth,
    private readonly stats: StatsSync
  ) {}

  async onListen({ instance }: onListenPayload) {
    const intervalMs = Number(process.env.DIAGNOSTICS_INTERVAL_MS ?? 30000);
    if (
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 0 ||
      intervalMs > 2147483647
    ) {
      throw new Error(
        'DIAGNOSTICS_INTERVAL_MS must be an integer from 0 to 2147483647'
      );
    }
    clearInterval(this.timer);
    let previousUtilization = performance.eventLoopUtilization();
    const report = () => {
      const memory = process.memoryUsage();
      const now = Date.now();
      let directConnections = 0;
      let documentConnections = 0;
      let idleDocuments = 0;
      let textCharacters = 0;
      let largestTextCharacters = 0;
      let expiredTokens = 0;
      let yjsStructs = 0;
      let largestDocumentStructs = 0;
      for (const document of instance.documents.values()) {
        directConnections += document.directConnectionsCount;
        documentConnections += document.getConnections().length;
        if (document.getConnectionsCount() === 0) idleDocuments++;
        let documentStructs = 0;
        for (const structs of document.store.clients.values()) {
          documentStructs += structs.length;
        }
        yjsStructs += documentStructs;
        largestDocumentStructs = Math.max(
          largestDocumentStructs,
          documentStructs
        );
        // Do not create missing shared types or serialize document contents.
        const text = document.share.get('monaco');
        if (text instanceof Text) {
          textCharacters += text.length;
          largestTextCharacters = Math.max(largestTextCharacters, text.length);
        }
      }
      for (const token of this.auth.tokenCache.values()) {
        if (token.exp * 1000 <= now) expiredTokens++;
      }
      const utilization = performance.eventLoopUtilization();
      const delta = performance.eventLoopUtilization(
        utilization,
        previousUtilization
      );
      previousUtilization = utilization;
      console.log(
        JSON.stringify({
          event: 'server_diagnostics',
          timestamp: new Date(now).toISOString(),
          pid: process.pid,
          nodeVersion: process.version,
          uptimeSeconds: Math.round(process.uptime()),
          ...memory,
          heapSizeLimit: getHeapStatistics().heap_size_limit,
          eventLoopUtilization: delta.utilization,
          documents: instance.getDocumentsCount(),
          loadingDocuments: instance.loadingDocuments.size,
          unloadingDocuments: instance.unloadingDocuments.size,
          idleDocuments,
          webSocketConnections:
            instance.getConnectionsCount() - directConnections,
          documentConnections,
          directConnections,
          yjsStructs,
          largestDocumentStructs,
          textCharacters,
          largestTextCharacters,
          tokenCacheEntries: this.auth.tokenCache.size,
          expiredTokenCacheEntries: expiredTokens,
          pendingStatsDocuments: this.stats.updateTimes.size,
          activeStatsRuns: this.stats.activeRuns,
        })
      );
    };
    report();
    if (intervalMs > 0) {
      this.timer = setInterval(report, intervalMs);
      this.timer.unref();
    }
  }

  async onDestroy() {
    clearInterval(this.timer);
  }
}
