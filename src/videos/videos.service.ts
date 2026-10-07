import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CommandName, CommandTarget, VideoStatus } from '@prisma/client';
import { asObject, optionalNumber, optionalString } from '../common/http-body';
import { videoDto } from '../common/serializers';
import { CommandsService } from '../commands/commands.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncOutbox: SyncOutboxService,
    private readonly commandsService: CommandsService,
  ) {}

  async list(query: Record<string, unknown>) {
    const videos = await this.prisma.video.findMany({
      where: {
        userId: optionalString(query.user_id ?? query.userId),
        streamId: optionalString(query.stream_id ?? query.streamId),
        deviceId: optionalString(query.device_id ?? query.deviceId),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { videos: videos.map(videoDto) };
  }

  async get(id: string, userId: string) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video || video.userId !== userId) {
      throw new NotFoundException('Video not found');
    }
    return { video: videoDto(video) };
  }

  async startRecording(userId: string, streamId: string, input: unknown) {
    const body = asObject(input);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const stream = await tx.stream.findUnique({ where: { id: streamId } });
      if (!stream || stream.userId !== userId) {
        throw new NotFoundException('Stream not found');
      }

      if (stream.status !== 'LIVE') throw new ConflictException('Stream must be live before recording');
      const active = await tx.video.findFirst({ where: { deviceId: stream.deviceId, status: 'RECORDING' } });
      if (active) throw new ConflictException('This device is already recording');

      const video = await tx.video.create({
        data: {
          userId,
          streamId,
          deviceId: stream.deviceId,
          title: optionalString(body.title) ?? `${stream.title} recording`,
          status: VideoStatus.RECORDING,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'video',
          entityId: video.id,
          action: 'create',
          version: video.version,
          occurredAt: now,
          data: videoDto(video),
        },
        tx,
      );

      const command = await this.commandsService.createCommand(
        {
          userId,
          deviceId: stream.deviceId,
          streamId,
          videoId: video.id,
          command: CommandName.START,
          target: CommandTarget.RECORDING,
        },
        tx,
      );

      return { video, command };
    });

    return {
      video: videoDto(result.video),
      command_id: result.command.id,
    };
  }

  async stopRecording(userId: string, streamId: string, input: unknown) {
    const body = asObject(input);
    const explicitVideoId = optionalString(body.video_id ?? body.videoId);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const stream = await tx.stream.findUnique({ where: { id: streamId } });
      if (!stream || stream.userId !== userId) {
        throw new NotFoundException('Stream not found');
      }

      const existingVideo = explicitVideoId
        ? await tx.video.findUnique({ where: { id: explicitVideoId } })
        : await tx.video.findFirst({
            where: { streamId, status: VideoStatus.RECORDING },
            orderBy: { createdAt: 'desc' },
          });
      if (!existingVideo || existingVideo.streamId !== streamId || existingVideo.userId !== userId) {
        throw new NotFoundException('Recording video not found');
      }
      if (existingVideo.status !== VideoStatus.RECORDING)
        throw new ConflictException('Recording has already stopped');

      const video = await tx.video.update({
        where: { id: existingVideo.id },
        data: {
          status: VideoStatus.UPLOADING,
          endedAt: now,
          durationSeconds: optionalNumber(body.duration_seconds ?? body.durationSeconds),
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'video',
          entityId: video.id,
          action: 'update',
          version: video.version,
          occurredAt: now,
          data: videoDto(video),
        },
        tx,
      );

      const command = await this.commandsService.createCommand(
        {
          userId,
          deviceId: stream.deviceId,
          streamId,
          videoId: video.id,
          command: CommandName.STOP,
          target: CommandTarget.RECORDING,
        },
        tx,
      );

      return { video, command };
    });

    return {
      video: videoDto(result.video),
      command_id: result.command.id,
    };
  }

  async markUploaded(id: string, input: unknown) {
    const body = asObject(input);
    const now = new Date();
    const video = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.video.update({
        where: { id },
        data: {
          status: VideoStatus.COMPLETED,
          edgeLocalPath: optionalString(body.edge_local_path ?? body.edgeLocalPath),
          cloudPath: optionalString(body.cloud_path ?? body.cloudPath),
          playbackUrl: optionalString(body.playback_url ?? body.playbackUrl),
          uploadedAt: now,
          sizeBytes: optionalNumber(body.size_bytes ?? body.sizeBytes),
          frameCount: optionalNumber(body.frame_count ?? body.frameCount),
          droppedFrames: optionalNumber(body.dropped_frames ?? body.droppedFrames),
          version: { increment: 1 },
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'video',
          entityId: updated.id,
          action: 'update',
          version: updated.version,
          occurredAt: now,
          data: videoDto(updated),
        },
        tx,
      );

      return updated;
    });
    return { video: videoDto(video) };
  }
}
