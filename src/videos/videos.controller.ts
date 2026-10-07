import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { VideosService } from './videos.service';

@Controller()
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Get('videos')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, unknown>) {
    return this.videosService.list({ ...query, user_id: user.id });
  }

  @Get('videos/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.videosService.get(id, user.id);
  }

  @Post('streams/:streamId/recordings/start')
  startRecording(
    @CurrentUser() user: AuthenticatedUser,
    @Param('streamId') streamId: string,
    @Body() body: unknown,
  ) {
    return this.videosService.startRecording(user.id, streamId, body);
  }

  @Post('streams/:streamId/recordings/stop')
  stopRecording(
    @CurrentUser() user: AuthenticatedUser,
    @Param('streamId') streamId: string,
    @Body() body: unknown,
  ) {
    return this.videosService.stopRecording(user.id, streamId, body);
  }

}
