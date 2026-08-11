import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [SyncModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
