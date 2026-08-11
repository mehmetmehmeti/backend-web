import { Injectable, NotFoundException } from '@nestjs/common';
import { CommandName, CommandStatus, CommandTarget, Prisma } from '@prisma/client';
import { asObject, optionalString, requiredString } from '../common/http-body';
import { commandDto, commandName, commandStatus, commandTarget } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';

type CreateCommandInput = {
  userId: string;
  deviceId: string;
  command: CommandName;
  target: CommandTarget;
  streamId?: string;
  videoId?: string;
  source?: string;
};

@Injectable()
export class CommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncOutbox: SyncOutboxService,
  ) {}

  async list(query: Record<string, unknown>) {
    const commands = await this.prisma.command.findMany({
      where: {
        deviceId: optionalString(query.device_id ?? query.deviceId),
        userId: optionalString(query.user_id ?? query.userId),
        status:
          query.status === undefined ? undefined : commandStatus(query.status),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { commands: commands.map(commandDto) };
  }

  async get(id: string) {
    const command = await this.prisma.command.findUnique({ where: { id } });
    if (!command) {
      throw new NotFoundException('Command not found');
    }
    return { command: commandDto(command) };
  }

  async createFromHttp(userId: string, input: unknown) {
    const body = asObject(input);
    const command = await this.createCommand({
      userId,
      deviceId: requiredString(body.device_id ?? body.deviceId, 'device_id'),
      streamId: optionalString(body.stream_id ?? body.streamId),
      videoId: optionalString(body.video_id ?? body.videoId),
      command: commandName(body.command),
      target: commandTarget(body.target),
      source: optionalString(body.source) ?? 'cloud',
    });
    return { command: commandDto(command) };
  }

  async createCommand(input: CreateCommandInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const now = new Date();
    const command = await client.command.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId,
        streamId: input.streamId,
        videoId: input.videoId,
        command: input.command,
        target: input.target,
        status: CommandStatus.PENDING,
        source: input.source ?? 'cloud',
        createdAt: now,
        updatedAt: now,
      },
    });

    await this.syncOutbox.createEvent(
      {
        entityType: 'command',
        entityId: command.id,
        action: 'create',
        version: command.version,
        occurredAt: now,
        data: commandDto(command),
      },
      client,
    );

    return command;
  }

  async updateStatus(id: string, input: unknown) {
    const body = asObject(input);
    const now = new Date();
    const command = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.command.update({
        where: { id },
        data: {
          status: body.status === undefined ? undefined : commandStatus(body.status),
          claimedBy: optionalString(body.claimed_by ?? body.claimedBy),
          resultMessage: optionalString(body.result_message ?? body.resultMessage),
          errorMessage: optionalString(body.error_message ?? body.errorMessage),
          claimedAt: optionalString(body.claimed_at ?? body.claimedAt) ? new Date(String(body.claimed_at ?? body.claimedAt)) : undefined,
          processedAt: optionalString(body.processed_at ?? body.processedAt) ? new Date(String(body.processed_at ?? body.processedAt)) : undefined,
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'command',
          entityId: updated.id,
          action: 'update',
          version: updated.version,
          occurredAt: now,
          data: commandDto(updated),
        },
        tx,
      );

      return updated;
    });
    return { command: commandDto(command) };
  }
}
