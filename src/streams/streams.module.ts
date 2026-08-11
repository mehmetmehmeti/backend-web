import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module';
import { SyncModule } from '../sync/sync.module';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';

@Module({
  imports: [CommandsModule, SyncModule],
  controllers: [StreamsController],
  providers: [StreamsService],
})
export class StreamsModule {}
