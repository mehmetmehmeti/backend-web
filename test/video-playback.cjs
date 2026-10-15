require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verify } = require('jsonwebtoken');
const { VideoFilesController } = require('../dist/src/videos/video-files.controller');

test('playback uses the current server address, not a stored localhost URL', async () => {
  const previousBase = process.env.PUBLIC_API_URL;
  const previousSecret = process.env.JWT_SECRET;
  process.env.PUBLIC_API_URL = 'http://192.168.0.92:3000/';
  process.env.JWT_SECRET = 'playback-unit-test-secret';
  try {
    const video = { id: 'recording-id', userId: 'owner', status: 'COMPLETED', cloudPath: '/recordings/test.mp4', playbackUrl: 'http://localhost:3000/videos/recording-id/file' };
    const controller = new VideoFilesController({ video: { findUnique: async () => video } }, {});
    const { url } = await controller.playback(video.id, { id: 'owner' });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'http://192.168.0.92:3000');
    assert.equal(parsed.pathname, '/videos/recording-id/file');
    const ticket = verify(parsed.searchParams.get('ticket'), process.env.JWT_SECRET);
    assert.equal(ticket.sub, 'owner');
    assert.equal(ticket.videoId, video.id);
    assert.equal(ticket.purpose, 'video-playback');
    await assert.rejects(() => controller.playback(video.id, { id: 'another-user' }), error => error.getStatus() === 404);
    video.status = 'UPLOADING';
    await assert.rejects(() => controller.playback(video.id, { id: 'owner' }), error => error.getStatus() === 400);
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousBase;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
