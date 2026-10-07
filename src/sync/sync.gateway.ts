import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { OUTBOX_EVENT_CREATED, SyncOutboxService } from './sync-outbox.service';
import { SyncService } from './sync.service';

const SYNC_PATH = '/sync';

@Injectable()
export class SyncGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncGateway.name);
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly clients = new Set<WebSocket>();
  private flushTimer?: NodeJS.Timeout;
  private sending = false;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly syncService: SyncService,
    private readonly syncOutbox: SyncOutboxService,
  ) {}

  onModuleInit() {
    const httpServer = this.adapterHost.httpAdapter.getHttpServer() as HttpServer;

    httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);
      if (url.pathname !== SYNC_PATH) {
        return;
      }
      if (!this.isAuthorized(request, url)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.server.handleUpgrade(request, socket, head, (client) => {
        this.server.emit('connection', client, request);
      });
    });

    this.server.on('connection', (client) => this.handleConnection(client));
    this.syncOutbox.on(OUTBOX_EVENT_CREATED, () => {
      void this.sendPendingEvents();
    });
    this.flushTimer = setInterval(() => void this.sendPendingEvents(), 1000);
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    for (const client of this.clients) {
      client.close();
    }
    this.server.close();
  }

  private handleConnection(client: WebSocket) {
    this.clients.add(client);
    client.on('message', (message) => {
      void this.handleMessage(client, message);
    });
    client.on('close', () => this.clients.delete(client));
    client.on('error', (error) => {
      this.logger.warn(`Sync WebSocket error: ${error.message}`);
      this.clients.delete(client);
    });
    void this.sendPendingEvents(client);
  }

  private async handleMessage(client: WebSocket, raw: RawData) {
    let payload: unknown;
    try {
      payload = JSON.parse(this.rawToString(raw));
    } catch {
      this.sendJson(client, {
        type: 'ack',
        event_id: 'unknown',
        status: 'failed',
        source: 'cloud',
        occurred_at: new Date().toISOString(),
        message: 'Sync message must be valid JSON',
      });
      return;
    }

    if (this.isAck(payload)) {
      try {
        const ack = this.syncService.parseAck(payload);
        await this.syncOutbox.applyAck(ack.event_id, ack.status, ack.message);
      } catch (error) {
        this.logger.warn(error instanceof Error ? error.message : 'Invalid sync ack');
      }
      return;
    }

    const ack = await this.syncService.processEvent(payload);
    this.sendJson(client, ack);
  }

  private async sendPendingEvents(target?: WebSocket) {
    if (this.sending) return;
    this.sending = true;
    try {
    const clients = target ? [target] : [...this.clients];
    const openClients = clients.filter((client) => client.readyState === WebSocket.OPEN);
    if (!openClients.length) {
      return;
    }

    const events = await this.syncOutbox.listPendingEvents();
    for (const event of events) {
      for (const client of openClients) {
        this.sendJson(client, event);
      }
      await this.syncOutbox.markSent(event.event_id);
    }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Sync send failed');
    } finally {
      this.sending = false;
    }
  }

  private sendJson(client: WebSocket, payload: object) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }

  private isAuthorized(request: IncomingMessage, url: URL) {
    const expected = process.env.EDGE_SYNC_TOKEN?.trim();
    if (!expected) {
      return false;
    }
    const provided =
      url.searchParams.get('token') ??
      this.headerValue(request.headers['x-edge-sync-token']);
    return provided === expected;
  }

  private headerValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }

  private rawToString(raw: RawData) {
    if (Buffer.isBuffer(raw)) {
      return raw.toString('utf8');
    }
    if (Array.isArray(raw)) {
      return Buffer.concat(raw).toString('utf8');
    }
    return Buffer.from(raw).toString('utf8');
  }

  private isAck(payload: unknown): payload is { type: 'ack' } {
    return typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'ack';
  }
}
