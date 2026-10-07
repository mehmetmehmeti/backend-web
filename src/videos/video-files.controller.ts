import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Put, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sign, verify } from 'jsonwebtoken';
import { VideoStatus } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { EdgeSyncAuthGuard } from '../auth/edge-sync-auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';
import { videoDto } from '../common/serializers';

@Controller('videos')
export class VideoFilesController {
  private readonly directory = resolve(process.env.CLOUD_RECORDINGS_DIR || 'recordings');
  constructor(private readonly prisma: PrismaService, private readonly outbox: SyncOutboxService) {}

  @Public()
  @UseGuards(EdgeSyncAuthGuard)
  @Put(':id/file')
  async upload(@Param('id') id: string, @Req() req: Request) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) throw new NotFoundException('Video metadata has not synchronized yet');
    if (![VideoStatus.UPLOADING, VideoStatus.COMPLETED].includes(video.status as never))
      throw new BadRequestException('Recording has not finished');
    const expectedHash = req.header('x-content-sha256');
    if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash))
      throw new BadRequestException('SHA-256 checksum is required');
    await mkdir(this.directory, { recursive: true });
    const destination = resolve(this.directory, `${video.id}.mp4`);
    const temporary = `${destination}.${randomUUID()}.part`;
    const hash = createHash('sha256');
    let bytes = 0;
    const limit = Number(process.env.MAX_RECORDING_BYTES || 5 * 1024 ** 3);
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) return callback(new Error('Recording exceeds upload limit'));
      hash.update(chunk); callback(null, chunk);
    } });
    try {
      await pipeline(req, counter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (!bytes || hash.digest('hex') !== expectedHash)
        throw new BadRequestException('Recording checksum mismatch');
      await rename(temporary, destination);
      const now = new Date();
      return await this.prisma.$transaction(async tx => {
        const updated = await tx.video.update({ where: { id }, data: {
          status: VideoStatus.COMPLETED, cloudPath: destination,
          playbackUrl: `${(process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '')}/videos/${id}/file`,
          uploadedAt: now, sizeBytes: BigInt(bytes), version: { increment: 1 }, updatedAt: now,
        } });
        await this.outbox.createEvent({ entityType: 'video', entityId: id, action: 'update',
          version: updated.version, occurredAt: now, data: videoDto(updated) }, tx);
        return { video: videoDto(updated), sha256: expectedHash };
      });
    } finally { await rm(temporary, { force: true }); }
  }

  @Post(':id/playback')
  async playback(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video || video.userId !== user.id) throw new NotFoundException('Video not found');
    if (video.status !== VideoStatus.COMPLETED || !video.cloudPath)
      throw new BadRequestException('Recording is not available yet');
    const token = sign({ sub: user.id, videoId: id, purpose: 'video-playback' },
      process.env.JWT_SECRET!, { expiresIn: '1h' });
    return { url: `${video.playbackUrl}?ticket=${encodeURIComponent(token)}` };
  }

  @Public()
  @Get(':id/file')
  async file(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    let subject: string;
    try {
      const claims = verify(String(req.query.ticket || ''), process.env.JWT_SECRET!) as {
        sub: string; videoId: string; purpose: string;
      };
      if (claims.videoId !== id || claims.purpose !== 'video-playback') throw new Error();
      subject = claims.sub;
    } catch { throw new UnauthorizedException('A valid playback ticket is required'); }
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video || video.userId !== subject || video.status !== VideoStatus.COMPLETED)
      throw new NotFoundException('Video not found');
    const filename = resolve(this.directory, `${video.id}.mp4`);
    await stat(filename).catch(() => { throw new NotFoundException('Recording file missing'); });
    // Express sendFile implements byte ranges, including seeking in a browser video element.
    res.type('video/mp4');
    res.sendFile(filename);
  }
}
