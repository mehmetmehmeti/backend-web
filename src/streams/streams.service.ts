import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CommandName, CommandTarget, DeviceStatusValue, StreamStatus } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { asObject, optionalString, requiredString } from '../common/http-body';
import { deviceDto, streamDto } from '../common/serializers';
import { CommandsService } from '../commands/commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';

@Injectable()
export class StreamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncOutbox: SyncOutboxService,
    private readonly commandsService: CommandsService,
  ) {}

  async list(query: Record<string, unknown>) {
    const streams = await this.prisma.stream.findMany({
      where: {
        userId: optionalString(query.user_id ?? query.userId),
        deviceId: optionalString(query.device_id ?? query.deviceId),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { streams: streams.map(streamDto) };
  }

  async get(id: string) {
    const stream = await this.prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      throw new NotFoundException('Stream not found');
    }
    return { stream: streamDto(stream) };
  }

  async start(userId: string, input: unknown) {
    const body = asObject(input);
    const deviceId = requiredString(body.device_id ?? body.deviceId, 'device_id');
    const title = optionalString(body.title) ?? 'Live stream';
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${deviceId}))`;
      const active = await tx.stream.findFirst({
        where: { deviceId, status: { in: [StreamStatus.STARTING, StreamStatus.LIVE, StreamStatus.STOPPING] } },
      });
      if (active) throw new ConflictException('This device already has an active stream');
      const device = await tx.device.upsert({
        where: { id: deviceId },
        create: {
          id: deviceId,
          name: optionalString(body.device_name ?? body.deviceName) ?? deviceId,
          status: DeviceStatusValue.ONLINE,
          sourceReady: true,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
        update: {
          status: DeviceStatusValue.ONLINE,
          sourceReady: true,
          lastSeenAt: now,
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      const stream = await tx.stream.create({
        data: {
          userId,
          deviceId,
          title,
          status: StreamStatus.STARTING,
          playbackUrl: optionalString(body.playback_url ?? body.playbackUrl),
          createdAt: now,
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'device',
          entityId: device.id,
          action: device.createdAt.getTime() === now.getTime() ? 'create' : 'update',
          version: device.version,
          occurredAt: now,
          data: deviceDto(device),
        },
        tx,
      );

      await this.syncOutbox.createEvent(
        {
          entityType: 'stream',
          entityId: stream.id,
          action: 'create',
          version: stream.version,
          occurredAt: now,
          data: streamDto(stream),
        },
        tx,
      );

      const command = await this.commandsService.createCommand(
        {
          userId,
          deviceId,
          streamId: stream.id,
          command: CommandName.START,
          target: CommandTarget.STREAM,
        },
        tx,
      );

      return { stream, command };
    });

    return {
      stream: streamDto(result.stream),
      command_id: result.command.id,
    };
  }

  async stop(userId: string, id: string) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.stream.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Stream not found');
      if (current.status === StreamStatus.ENDED || current.status === StreamStatus.STOPPING)
        throw new ConflictException('Stream is already stopped or stopping');
      const recordings = await tx.video.findMany({ where: { streamId: id, status: 'RECORDING' } });
      for (const video of recordings) {
        await this.commandsService.createCommand({ userId, deviceId: current.deviceId,
          streamId: id, videoId: video.id, command: CommandName.STOP, target: CommandTarget.RECORDING }, tx);
      }
      const stream = await tx.stream.update({
        where: { id },
        data: {
          status: StreamStatus.STOPPING,
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'stream',
          entityId: stream.id,
          action: 'update',
          version: stream.version,
          occurredAt: now,
          data: streamDto(stream),
        },
        tx,
      );

      const command = await this.commandsService.createCommand(
        {
          userId,
          deviceId: stream.deviceId,
          streamId: stream.id,
          command: CommandName.STOP,
          target: CommandTarget.STREAM,
        },
        tx,
      );

      return { stream, command };
    });

    return {
      stream: streamDto(result.stream),
      command_id: result.command.id,
    };
  }
}
