import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module';
import { SyncModule } from '../sync/sync.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideoFilesController } from './video-files.controller';

@Module({
  imports: [CommandsModule, SyncModule],
  controllers: [VideosController, VideoFilesController],
  providers: [VideosService],
})
export class VideosModule {}
