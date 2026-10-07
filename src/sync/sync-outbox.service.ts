import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import { Prisma, SyncAction, SyncOutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  SyncActionLabel,
  SyncEntityType,
  SyncEventData,
  SyncEventMessage,
  SyncOutboxRow,
} from './sync.types';

export const OUTBOX_EVENT_CREATED = 'outbox-event-created';

type CreateEventInput = {
  entityType: SyncEntityType;
  entityId: string;
  action: SyncActionLabel;
  version: number;
  occurredAt: Date;
  data: SyncEventData;
};

@Injectable()
export class SyncOutboxService extends EventEmitter {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createEvent(
    input: CreateEventInput,
    tx: Prisma.TransactionClient = this.prisma,
    emitCreated = true,
  ) {
    const event = await tx.syncOutbox.create({
      data: {
        source: 'cloud',
        entityType: input.entityType,
        entityId: input.entityId,
        action: this.toPrismaAction(input.action),
        version: input.version,
        occurredAt: input.occurredAt,
        status: SyncOutboxStatus.PENDING,
        data: input.data as Prisma.InputJsonValue,
      },
    });

    if (emitCreated) {
      this.emit(OUTBOX_EVENT_CREATED, {
        entity_type: input.entityType,
        entity_id: input.entityId,
        action: input.action,
        event_id: event.eventId,
      });
    }

    return event;
  }

  async listPendingEvents(limit = 50) {
    const events = await this.prisma.syncOutbox.findMany({
      where: {
        status: {
          in: [SyncOutboxStatus.PENDING, SyncOutboxStatus.SENT, SyncOutboxStatus.FAILED],
        },
      },
      orderBy: { sequence: 'asc' },
      take: limit,
    });

    return events.map((event) => this.toMessage(event));
  }

  async markSent(eventId: string) {
    await this.prisma.syncOutbox.updateMany({
      where: { eventId, status: { not: SyncOutboxStatus.APPLIED } },
      data: {
        status: SyncOutboxStatus.SENT,
        sentAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
  }

  async applyAck(eventId: string, status: 'applied' | 'failed', message?: string) {
    await this.prisma.syncOutbox.update({
      where: { eventId },
      data:
        status === 'applied'
          ? {
              status: SyncOutboxStatus.APPLIED,
              ackedAt: new Date(),
              lastError: null,
            }
          : {
              status: SyncOutboxStatus.FAILED,
              lastError: message ?? 'Edge rejected sync event',
            },
    });
  }

  private toMessage(row: SyncOutboxRow): SyncEventMessage {
    return {
      type: 'event',
      event_id: row.eventId,
      source: 'cloud',
      entity_type: row.entityType as SyncEntityType,
      entity_id: row.entityId,
      action: row.action.toLowerCase() as SyncActionLabel,
      version: row.version,
      occurred_at: row.occurredAt.toISOString(),
      updated_at: this.updatedAtFromData(row.data, row.occurredAt),
      data: this.toObject(row.data),
    };
  }

  private updatedAtFromData(value: Prisma.JsonValue, fallback: Date) {
    const data = this.toObject(value);
    const updatedAt = data.updated_at;
    return typeof updatedAt === 'string' && updatedAt.trim()
      ? updatedAt
      : fallback.toISOString();
  }

  private toObject(value: Prisma.JsonValue): SyncEventData {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as SyncEventData;
    }

    return {};
  }

  private toPrismaAction(action: SyncActionLabel) {
    switch (action) {
      case 'create':
        return SyncAction.CREATE;
      case 'update':
        return SyncAction.UPDATE;
      case 'delete':
        return SyncAction.DELETE;
    }
  }
}
