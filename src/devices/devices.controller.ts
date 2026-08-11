import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  list() {
    return this.devicesService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.devicesService.get(id);
  }

  @Post()
  upsert(@Body() body: unknown) {
    return this.devicesService.upsert(body);
  }
}
