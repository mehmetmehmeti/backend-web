import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [SyncModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
