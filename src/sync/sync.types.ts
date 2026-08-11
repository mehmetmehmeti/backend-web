import type { Prisma } from '@prisma/client';

export const SYNC_ENTITY_TYPES = [
  'user',
  'device',
  'stream',
  'video',
  'command',
] as const;

export const SYNC_ACTIONS = ['create', 'update', 'delete'] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];
export type SyncActionLabel = (typeof SYNC_ACTIONS)[number];
export type SyncSource = 'cloud' | 'edge';
export type SyncEventData = Record<string, unknown>;

export type SyncEventMessage = {
  type?: 'event';
  event_id: string;
  source: SyncSource;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncActionLabel;
  version: number;
  occurred_at: string;
  updated_at?: string;
  data: SyncEventData;
};

export type SyncAckMessage = {
  type: 'ack';
  event_id: string;
  status: 'applied' | 'failed';
  source: SyncSource;
  occurred_at: string;
  message?: string;
};

export type SyncOutboxRow = {
  eventId: string;
  source: string;
  entityType: string;
  entityId: string;
  action: string;
  version: number;
  occurredAt: Date;
  data: Prisma.JsonValue;
};

