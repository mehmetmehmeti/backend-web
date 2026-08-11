import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { SyncService, SYNC_DATA_CHANGED } from './sync.service';
import { OUTBOX_EVENT_CREATED, SyncOutboxService } from './sync-outbox.service';

@Controller('sync/events')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly syncOutbox: SyncOutboxService,
  ) {}

  @Public()
  @Get('stream')
  stream(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    const write = (event: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const onChange = (payload: unknown) => write('sync-change', payload);
    this.syncService.on(SYNC_DATA_CHANGED, onChange);
    this.syncOutbox.on(OUTBOX_EVENT_CREATED, onChange);
    write('ready', { occurred_at: new Date().toISOString() });

    const heartbeat = setInterval(() => {
      if (!closed) res.write(': keep-alive\n\n');
    }, 15000);

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      this.syncService.off(SYNC_DATA_CHANGED, onChange);
      this.syncOutbox.off(OUTBOX_EVENT_CREATED, onChange);
      res.end();
    });
  }
}

