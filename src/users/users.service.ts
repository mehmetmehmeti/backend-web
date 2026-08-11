import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asObject, optionalString } from '../common/http-body';
import { userDto, userRole, userStatus, userSyncData } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncOutbox: SyncOutboxService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { users: users.map(userDto) };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { user: userDto(user) };
  }

  async update(id: string, input: unknown) {
    const body = asObject(input);
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          fullName: optionalString(body.full_name ?? body.fullName),
          role: body.role === undefined ? undefined : userRole(body.role),
          status: body.status === undefined ? undefined : userStatus(body.status),
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'user',
          entityId: updated.id,
          action: 'update',
          version: updated.version,
          occurredAt: now,
          data: userSyncData(updated),
        },
        tx as Prisma.TransactionClient,
      );

      return updated;
    });
    return { user: userDto(user) };
  }
}
