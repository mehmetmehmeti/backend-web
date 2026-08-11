import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { CommandsService } from './commands.service';

@Controller('commands')
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.commandsService.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.commandsService.get(id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.commandsService.createFromHttp(user.id, body);
  }

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.commandsService.updateStatus(id, body);
  }
}
