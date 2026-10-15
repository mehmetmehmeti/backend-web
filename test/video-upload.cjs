require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { VideoFilesController } = require('../dist/src/videos/video-files.controller');

function finalizedVideo(overrides = {}) {
  const now = new Date();
  return { id: 'upload-test', userId: 'owner', streamId: 'stream', deviceId: 'device',
    title: 'Recording', status: 'UPLOADING', frameCount: 769n, droppedFrames: 0n,
    sizeBytes: null, durationSeconds: 77, startedAt: now, endedAt: now,
    createdAt: now, updatedAt: now, uploadedAt: null, version: 4, ...overrides };
}

test('upload waits for finalized metadata before consuming the request or committing', async () => {
  for (const overrides of [{ frameCount: null }, { frameCount: 0n }, { endedAt: null }]) {
    let touched = false;
    const controller = new VideoFilesController({
      video: { findUnique: async () => finalizedVideo(overrides) },
      $transaction: async () => { touched = true; },
    }, {});
    const request = { header() { touched = true; throw new Error('Request must not be consumed'); } };
    await assert.rejects(() => controller.upload('upload-test', request),
      error => error.getStatus() === 409);
    assert.equal(touched, false);
  }
});

test('upload preserves finalized frame metadata in the completion event and verifies checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thesis-upload-'));
  const previous = process.env.CLOUD_RECORDINGS_DIR;
  process.env.CLOUD_RECORDINGS_DIR = directory;
  try {
    const video = finalizedVideo();
    const events = [];
    let commits = 0;
    const transaction = { video: { update: async ({ data }) => {
      commits++;
      return { ...video, ...data, version: video.version + data.version.increment };
    } } };
    const controller = new VideoFilesController({
      video: { findUnique: async () => video },
      $transaction: async fn => fn(transaction),
    }, { createEvent: async (event, tx) => {
      assert.equal(tx, transaction);
      events.push(event);
    } });
    const bytes = Buffer.from('recording upload test content');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const request = expected => Object.assign(Readable.from([bytes]), {
      header: name => name === 'x-content-sha256' ? expected : undefined,
    });
    await assert.rejects(() => controller.upload(video.id, request('0'.repeat(64))),
      error => error.getStatus() === 400);
    assert.equal(commits, 0);
    assert.deepEqual(await readdir(directory), []);
    const result = await controller.upload(video.id, request(sha256));
    assert.equal(result.sha256, sha256);
    assert.equal(result.video.status, 'completed');
    assert.equal(result.video.frame_count, '769');
    assert.equal(result.video.version, 5);
    assert.equal(result.video.size_bytes, String(bytes.length));
    assert.equal(events.length, 1);
    assert.equal(events[0].data.frame_count, '769');
    assert.equal(events[0].version, 5);
    assert.deepEqual(await readFile(join(directory, `${video.id}.mp4`)), bytes);
    assert.deepEqual(await readdir(directory), [`${video.id}.mp4`]);
  } finally {
    if (previous === undefined) delete process.env.CLOUD_RECORDINGS_DIR;
    else process.env.CLOUD_RECORDINGS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
