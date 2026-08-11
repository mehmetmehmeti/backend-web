import { Injectable, NotFoundException } from '@nestjs/common';
import { asObject, optionalBoolean, optionalDate, optionalString, requiredString } from '../common/http-body';
import { deviceDto, deviceStatus } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncOutbox: SyncOutboxService,
  ) {}

  async list() {
    const devices = await this.prisma.device.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return { devices: devices.map(deviceDto) };
  }

  async get(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    return { device: deviceDto(device) };
  }

  async upsert(input: unknown) {
    const body = asObject(input);
    const id = requiredString(body.id ?? body.device_id, 'id');
    const now = new Date();
    const device = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.device.upsert({
        where: { id },
        create: {
          id,
          name: optionalString(body.name) ?? id,
          status: deviceStatus(body.status),
          sourceReady: optionalBoolean(body.source_ready) ?? false,
          streaming: optionalBoolean(body.streaming) ?? false,
          recording: optionalBoolean(body.recording) ?? false,
          lastError: optionalString(body.last_error),
          lastSeenAt: optionalDate(body.last_seen_at),
          createdAt: now,
          updatedAt: now,
        },
        update: {
          name: optionalString(body.name),
          status: body.status === undefined ? undefined : deviceStatus(body.status),
          sourceReady:
            body.source_ready === undefined ? undefined : optionalBoolean(body.source_ready),
          streaming: body.streaming === undefined ? undefined : optionalBoolean(body.streaming),
          recording: body.recording === undefined ? undefined : optionalBoolean(body.recording),
          lastError: optionalString(body.last_error),
          lastSeenAt: optionalDate(body.last_seen_at),
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'device',
          entityId: updated.id,
          action: updated.createdAt.getTime() === now.getTime() ? 'create' : 'update',
          version: updated.version,
          occurredAt: now,
          data: deviceDto(updated),
        },
        tx,
      );

      return updated;
    });

    return { device: deviceDto(device) };
  }
}
