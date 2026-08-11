import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { StreamsService } from './streams.service';

@Controller('streams')
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.streamsService.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.streamsService.get(id);
  }

  @Post('start')
  start(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.streamsService.start(user.id, body);
  }

  @Post(':id/stop')
  stop(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.streamsService.stop(user.id, id);
  }
}
