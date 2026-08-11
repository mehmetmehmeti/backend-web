import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncGateway } from './sync.gateway';
import { SyncOutboxService } from './sync-outbox.service';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncOutboxService, SyncGateway],
  exports: [SyncService, SyncOutboxService],
})
export class SyncModule {}

