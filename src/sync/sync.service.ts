import { EventEmitter } from 'node:events';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CommandName,
  CommandStatus,
  CommandTarget,
  DeviceStatusValue,
  Prisma,
  StreamStatus,
  SyncAction,
  SyncInboxStatus,
  UserRole,
  UserStatus,
  VideoStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SYNC_ACTIONS,
  SYNC_ENTITY_TYPES,
  type SyncAckMessage,
  type SyncEventMessage,
} from './sync.types';

export const SYNC_DATA_CHANGED = 'sync-data-changed';

type ApplyResult = {
  status: SyncInboxStatus;
  message?: string;
};

@Injectable()
export class SyncService extends EventEmitter {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async processEvent(message: unknown): Promise<SyncAckMessage> {
    let event: SyncEventMessage;
    try {
      event = this.parseEvent(message);
    } catch (error) {
      return this.failedAck(this.eventIdOrUnknown(message), this.errorMessage(error));
    }

    const existing = await this.prisma.syncInbox.findUnique({
      where: { eventId: event.event_id },
    });
    if (existing && existing.status !== SyncInboxStatus.FAILED) {
      return this.appliedAck(event.event_id, 'Duplicate event ignored');
    }

    await this.prisma.syncInbox.upsert({
      where: { eventId: event.event_id },
      create: {
        eventId: event.event_id,
        source: event.source,
        entityType: event.entity_type,
        entityId: event.entity_id,
        action: this.toPrismaAction(event.action),
        version: event.version,
        occurredAt: new Date(event.occurred_at),
        status: SyncInboxStatus.PENDING,
        data: event.data as Prisma.InputJsonValue,
      },
      update: {
        status: SyncInboxStatus.PENDING,
        data: event.data as Prisma.InputJsonValue,
        message: null,
      },
    });

    try {
      const result = await this.applyRemoteEvent(event);
      await this.markInbox(event.event_id, result.status, result.message);
      this.emit(SYNC_DATA_CHANGED, {
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        action: event.action,
        event_id: event.event_id,
        source: event.source,
      });
      return this.appliedAck(event.event_id, result.message);
    } catch (error) {
      const messageText = this.errorMessage(error);
      await this.markInbox(event.event_id, SyncInboxStatus.FAILED, messageText);
      return this.failedAck(event.event_id, messageText);
    }
  }

  parseAck(value: unknown): Pick<SyncAckMessage, 'event_id' | 'status' | 'message'> {
    if (!this.isObject(value) || value.type !== 'ack') {
      throw new BadRequestException('Invalid sync acknowledgement');
    }
    const eventId = this.requiredString(value.event_id, 'event_id');
    const status = this.requiredString(value.status, 'status');
    if (status !== 'applied' && status !== 'failed') {
      throw new BadRequestException('Invalid sync acknowledgement status');
    }
    return {
      event_id: eventId,
      status,
      message: typeof value.message === 'string' ? value.message : undefined,
    };
  }

  private async applyRemoteEvent(event: SyncEventMessage): Promise<ApplyResult> {
    switch (event.entity_type) {
      case 'user':
        return this.applyUser(event);
      case 'device':
        return this.applyDevice(event);
      case 'stream':
        return this.applyStream(event);
      case 'video':
        return this.applyVideo(event);
      case 'command':
        return this.applyCommand(event);
    }
  }

  private async applyUser(event: SyncEventMessage): Promise<ApplyResult> {
    const data = event.data;
    await this.prisma.user.upsert({
      where: { id: event.entity_id },
      create: {
        id: event.entity_id,
        email: this.requiredString(data.email, 'data.email'),
        passwordHash: this.requiredString(data.password_hash, 'data.password_hash'),
        fullName: this.requiredString(data.full_name, 'data.full_name'),
        role: this.userRole(data.role),
        status: this.userStatus(data.status),
        version: event.version,
        createdAt: this.date(data.created_at, event.occurred_at),
        updatedAt: this.date(data.updated_at, event.occurred_at),
      },
      update: {
        email: this.optionalString(data.email),
        passwordHash: this.optionalString(data.password_hash),
        fullName: this.optionalString(data.full_name),
        role: data.role === undefined ? undefined : this.userRole(data.role),
        status: data.status === undefined ? undefined : this.userStatus(data.status),
        version: event.version,
        updatedAt: this.date(data.updated_at, event.occurred_at),
      },
    });
    return { status: SyncInboxStatus.APPLIED };
  }

  private async applyDevice(event: SyncEventMessage): Promise<ApplyResult> {
    const data = event.data;
    await this.prisma.device.upsert({
      where: { id: event.entity_id },
      create: {
        id: event.entity_id,
        name: this.optionalString(data.name) ?? event.entity_id,
        status: this.deviceStatus(data.status),
        sourceReady: Boolean(data.source_ready),
        streaming: Boolean(data.streaming),
        recording: Boolean(data.recording),
        lastError: this.optionalString(data.last_error),
        lastSeenAt: this.optionalDate(data.last_seen_at),
        version: event.version,
      },
      update: {
        name: this.optionalString(data.name),
        status: data.status === undefined ? undefined : this.deviceStatus(data.status),
        sourceReady: data.source_ready === undefined ? undefined : Boolean(data.source_ready),
        streaming: data.streaming === undefined ? undefined : Boolean(data.streaming),
        recording: data.recording === undefined ? undefined : Boolean(data.recording),
        lastError: this.optionalString(data.last_error),
        lastSeenAt: this.optionalDate(data.last_seen_at),
        version: event.version,
      },
    });
    return { status: SyncInboxStatus.APPLIED };
  }

  private async applyStream(event: SyncEventMessage): Promise<ApplyResult> {
    const data = event.data;
    await this.ensureDevice(this.requiredString(data.device_id, 'data.device_id'));
    await this.ensureUser(this.requiredString(data.user_id, 'data.user_id'));
    await this.prisma.stream.upsert({
      where: { id: event.entity_id },
      create: {
        id: event.entity_id,
        userId: this.requiredString(data.user_id, 'data.user_id'),
        deviceId: this.requiredString(data.device_id, 'data.device_id'),
        title: this.optionalString(data.title) ?? 'Live stream',
        status: this.streamStatus(data.status),
        mediasoupStreamId: this.optionalString(data.mediasoup_stream_id),
        mediasoupProducerId: this.optionalString(data.mediasoup_producer_id),
        playbackUrl: this.optionalString(data.playback_url),
        startedAt: this.optionalDate(data.started_at),
        endedAt: this.optionalDate(data.ended_at),
        lastError: this.optionalString(data.last_error),
        version: event.version,
      },
      update: {
        status: data.status === undefined ? undefined : this.streamStatus(data.status),
        mediasoupProducerId: this.optionalString(data.mediasoup_producer_id),
        playbackUrl: this.optionalString(data.playback_url),
        startedAt: this.optionalDate(data.started_at),
        endedAt: this.optionalDate(data.ended_at),
        lastError: this.optionalString(data.last_error),
        version: event.version,
      },
    });
    return { status: SyncInboxStatus.APPLIED };
  }

  private async applyVideo(event: SyncEventMessage): Promise<ApplyResult> {
    const data = event.data;
    await this.ensureDevice(this.requiredString(data.device_id, 'data.device_id'));
    await this.ensureUser(this.requiredString(data.user_id, 'data.user_id'));
    await this.prisma.video.upsert({
      where: { id: event.entity_id },
      create: {
        id: event.entity_id,
        userId: this.requiredString(data.user_id, 'data.user_id'),
        streamId: this.optionalString(data.stream_id),
        deviceId: this.requiredString(data.device_id, 'data.device_id'),
        title: this.optionalString(data.title) ?? 'Recording',
        status: this.videoStatus(data.status),
        edgeLocalPath: this.optionalString(data.edge_local_path),
        cloudPath: this.optionalString(data.cloud_path),
        playbackUrl: this.optionalString(data.playback_url),
        startedAt: this.optionalDate(data.started_at),
        endedAt: this.optionalDate(data.ended_at),
        uploadedAt: this.optionalDate(data.uploaded_at),
        durationSeconds: this.optionalNumber(data.duration_seconds),
        sizeBytes: this.optionalBigInt(data.size_bytes),
        frameCount: this.optionalBigInt(data.frame_count),
        droppedFrames: this.optionalBigInt(data.dropped_frames),
        version: event.version,
      },
      update: {
        status: data.status === undefined ? undefined : this.videoStatus(data.status),
        edgeLocalPath: this.optionalString(data.edge_local_path),
        cloudPath: this.optionalString(data.cloud_path),
        playbackUrl: this.optionalString(data.playback_url),
        endedAt: this.optionalDate(data.ended_at),
        uploadedAt: this.optionalDate(data.uploaded_at),
        durationSeconds: this.optionalNumber(data.duration_seconds),
        sizeBytes: this.optionalBigInt(data.size_bytes),
        frameCount: this.optionalBigInt(data.frame_count),
        droppedFrames: this.optionalBigInt(data.dropped_frames),
        version: event.version,
      },
    });
    return { status: SyncInboxStatus.APPLIED };
  }

  private async applyCommand(event: SyncEventMessage): Promise<ApplyResult> {
    const data = event.data;
    await this.ensureDevice(this.requiredString(data.device_id, 'data.device_id'));
    await this.ensureUser(this.requiredString(data.user_id, 'data.user_id'));
    await this.prisma.command.upsert({
      where: { id: event.entity_id },
      create: {
        id: event.entity_id,
        userId: this.requiredString(data.user_id, 'data.user_id'),
        streamId: this.optionalString(data.stream_id),
        videoId: this.optionalString(data.video_id),
        deviceId: this.requiredString(data.device_id, 'data.device_id'),
        command: this.commandName(data.command),
        target: this.commandTarget(data.target),
        status: this.commandStatus(data.status),
        source: this.optionalString(data.source) ?? 'edge',
        claimedBy: this.optionalString(data.claimed_by),
        resultMessage: this.optionalString(data.result_message),
        errorMessage: this.optionalString(data.error_message),
        claimedAt: this.optionalDate(data.claimed_at),
        processedAt: this.optionalDate(data.processed_at),
        version: event.version,
      },
      update: {
        status: data.status === undefined ? undefined : this.commandStatus(data.status),
        claimedBy: this.optionalString(data.claimed_by),
        resultMessage: this.optionalString(data.result_message),
        errorMessage: this.optionalString(data.error_message),
        claimedAt: this.optionalDate(data.claimed_at),
        processedAt: this.optionalDate(data.processed_at),
        version: event.version,
      },
    });
    return { status: SyncInboxStatus.APPLIED };
  }

  private async ensureUser(id: string) {
    await this.prisma.user.upsert({
      where: { id },
      create: {
        id,
        email: `synced-${id}@edge.local`,
        passwordHash: 'synced-user-no-local-login',
        fullName: 'Synced user',
        role: UserRole.OPERATOR,
        status: UserStatus.ACTIVE,
      },
      update: {},
    });
  }

  private async ensureDevice(id: string) {
    await this.prisma.device.upsert({
      where: { id },
      create: { id, name: id, status: DeviceStatusValue.OFFLINE },
      update: {},
    });
  }

  private parseEvent(value: unknown): SyncEventMessage {
    if (!this.isObject(value)) {
      throw new BadRequestException('Sync event payload must be an object');
    }
    const entityType = this.requiredString(value.entity_type, 'entity_type');
    const action = this.requiredString(value.action, 'action');
    if (!SYNC_ENTITY_TYPES.includes(entityType as never)) {
      throw new BadRequestException('Unsupported entity_type');
    }
    if (!SYNC_ACTIONS.includes(action as never)) {
      throw new BadRequestException('Unsupported action');
    }

    return {
      type: value.type === 'event' ? 'event' : undefined,
      event_id: this.requiredString(value.event_id, 'event_id'),
      source: 'edge',
      entity_type: entityType as never,
      entity_id: this.requiredString(value.entity_id, 'entity_id'),
      action: action as never,
      version: this.optionalNumber(value.version) ?? 1,
      occurred_at: this.requiredString(value.occurred_at, 'occurred_at'),
      updated_at: this.optionalString(value.updated_at),
      data: this.isObject(value.data) ? (value.data as Record<string, unknown>) : {},
    };
  }

  private async markInbox(
    eventId: string,
    status: SyncInboxStatus,
    message?: string,
  ) {
    await this.prisma.syncInbox.update({
      where: { eventId },
      data: {
        status,
        message,
        processedAt: new Date(),
      },
    });
  }

  private appliedAck(eventId: string, message?: string): SyncAckMessage {
    return {
      type: 'ack',
      event_id: eventId,
      status: 'applied',
      source: 'cloud',
      occurred_at: new Date().toISOString(),
      message,
    };
  }

  private failedAck(eventId: string, message: string): SyncAckMessage {
    return {
      type: 'ack',
      event_id: eventId,
      status: 'failed',
      source: 'cloud',
      occurred_at: new Date().toISOString(),
      message,
    };
  }

  private eventIdOrUnknown(value: unknown) {
    return this.isObject(value) && typeof value.event_id === 'string'
      ? value.event_id
      : 'unknown';
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Sync event failed';
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private requiredString(value: unknown, name: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${name} is required`);
    }
    return value.trim();
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private optionalNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private optionalBigInt(value: unknown) {
    const numberValue = this.optionalNumber(value);
    return numberValue === undefined ? undefined : BigInt(Math.trunc(numberValue));
  }

  private optionalDate(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private date(value: unknown, fallback: string) {
    return this.optionalDate(value) ?? new Date(fallback);
  }

  private userRole(value: unknown) {
    const normalized = this.optionalString(value)?.toUpperCase();
    return normalized === 'ADMIN'
      ? UserRole.ADMIN
      : normalized === 'VIEWER'
        ? UserRole.VIEWER
        : UserRole.OPERATOR;
  }

  private userStatus(value: unknown) {
    return this.optionalString(value)?.toUpperCase() === 'DISABLED'
      ? UserStatus.DISABLED
      : UserStatus.ACTIVE;
  }

  private deviceStatus(value: unknown) {
    const normalized = this.optionalString(value)?.toUpperCase();
    if (normalized === 'ONLINE') return DeviceStatusValue.ONLINE;
    if (normalized === 'STREAMING') return DeviceStatusValue.STREAMING;
    if (normalized === 'ERROR') return DeviceStatusValue.ERROR;
    return DeviceStatusValue.OFFLINE;
  }

  private streamStatus(value: unknown) {
    const normalized = this.optionalString(value)?.toUpperCase();
    if (normalized === 'STARTING') return StreamStatus.STARTING;
    if (normalized === 'LIVE') return StreamStatus.LIVE;
    if (normalized === 'STOPPING') return StreamStatus.STOPPING;
    if (normalized === 'ENDED') return StreamStatus.ENDED;
    if (normalized === 'ERROR') return StreamStatus.ERROR;
    return StreamStatus.OFFLINE;
  }

  private videoStatus(value: unknown) {
    const normalized = this.optionalString(value)?.toUpperCase();
    if (normalized === 'UPLOADING') return VideoStatus.UPLOADING;
    if (normalized === 'COMPLETED') return VideoStatus.COMPLETED;
    if (normalized === 'FAILED') return VideoStatus.FAILED;
    return VideoStatus.RECORDING;
  }

  private commandName(value: unknown) {
    return this.optionalString(value)?.toUpperCase() === 'STOP'
      ? CommandName.STOP
      : CommandName.START;
  }

  private commandTarget(value: unknown) {
    const normalized = this.optionalString(value)?.toUpperCase();
    return normalized === 'RECORDING' || normalized === 'RECORD'
      ? CommandTarget.RECORDING
      : CommandTarget.STREAM;
  }

  private commandStatus(value: unknown) {
    const normalized = this.optionalString(value)?.toUpperCase();
    if (normalized === 'CLAIMED') return CommandStatus.CLAIMED;
    if (normalized === 'PROCESSING') return CommandStatus.PROCESSING;
    if (normalized === 'COMPLETED') return CommandStatus.COMPLETED;
    if (normalized === 'FAILED') return CommandStatus.FAILED;
    return CommandStatus.PENDING;
  }

  private toPrismaAction(action: string) {
    if (action === 'update') return SyncAction.UPDATE;
    if (action === 'delete') return SyncAction.DELETE;
    return SyncAction.CREATE;
  }
}
