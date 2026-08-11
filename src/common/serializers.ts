import {
  Command,
  CommandName,
  CommandStatus,
  CommandTarget,
  Device,
  DeviceStatusValue,
  Stream,
  StreamStatus,
  User,
  UserRole,
  UserStatus,
  Video,
  VideoStatus,
} from '@prisma/client';

type UserPublic = Pick<
  User,
  'id' | 'email' | 'fullName' | 'role' | 'status' | 'createdAt' | 'updatedAt' | 'version'
>;

export function userDto(user: UserPublic) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: lower(user.role),
    status: lower(user.status),
    version: user.version,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

export function userSyncData(user: UserPublic & Pick<User, 'passwordHash'>) {
  return {
    ...userDto(user),
    password_hash: user.passwordHash,
  };
}

export function deviceDto(device: Device) {
  return {
    id: device.id,
    name: device.name,
    status: lower(device.status),
    source_ready: device.sourceReady,
    streaming: device.streaming,
    recording: device.recording,
    last_error: device.lastError,
    last_seen_at: device.lastSeenAt?.toISOString() ?? null,
    version: device.version,
    created_at: device.createdAt.toISOString(),
    updated_at: device.updatedAt.toISOString(),
  };
}

export function streamDto(stream: Stream) {
  return {
    id: stream.id,
    user_id: stream.userId,
    device_id: stream.deviceId,
    title: stream.title,
    status: lower(stream.status),
    mediasoup_stream_id: stream.mediasoupStreamId,
    mediasoup_producer_id: stream.mediasoupProducerId,
    playback_url: stream.playbackUrl,
    started_at: stream.startedAt?.toISOString() ?? null,
    ended_at: stream.endedAt?.toISOString() ?? null,
    last_error: stream.lastError,
    version: stream.version,
    created_at: stream.createdAt.toISOString(),
    updated_at: stream.updatedAt.toISOString(),
  };
}

export function videoDto(video: Video) {
  return {
    id: video.id,
    user_id: video.userId,
    stream_id: video.streamId,
    device_id: video.deviceId,
    title: video.title,
    status: lower(video.status),
    edge_local_path: video.edgeLocalPath,
    cloud_path: video.cloudPath,
    playback_url: video.playbackUrl,
    started_at: video.startedAt?.toISOString() ?? null,
    ended_at: video.endedAt?.toISOString() ?? null,
    uploaded_at: video.uploadedAt?.toISOString() ?? null,
    duration_seconds: video.durationSeconds,
    size_bytes: video.sizeBytes?.toString() ?? null,
    frame_count: video.frameCount?.toString() ?? null,
    dropped_frames: video.droppedFrames?.toString() ?? null,
    version: video.version,
    created_at: video.createdAt.toISOString(),
    updated_at: video.updatedAt.toISOString(),
  };
}

export function commandDto(command: Command) {
  return {
    id: command.id,
    user_id: command.userId,
    stream_id: command.streamId,
    video_id: command.videoId,
    device_id: command.deviceId,
    command: lower(command.command),
    target: lower(command.target),
    status: lower(command.status),
    source: command.source,
    claimed_by: command.claimedBy,
    result_message: command.resultMessage,
    error_message: command.errorMessage,
    claimed_at: command.claimedAt?.toISOString() ?? null,
    processed_at: command.processedAt?.toISOString() ?? null,
    version: command.version,
    created_at: command.createdAt.toISOString(),
    updated_at: command.updatedAt.toISOString(),
  };
}

export function userRole(value: unknown) {
  const normalized = normalize(value);
  if (normalized === 'ADMIN') return UserRole.ADMIN;
  if (normalized === 'VIEWER') return UserRole.VIEWER;
  return UserRole.OPERATOR;
}

export function userStatus(value: unknown) {
  return normalize(value) === 'DISABLED' ? UserStatus.DISABLED : UserStatus.ACTIVE;
}

export function deviceStatus(value: unknown) {
  const normalized = normalize(value);
  if (normalized === 'ONLINE') return DeviceStatusValue.ONLINE;
  if (normalized === 'STREAMING') return DeviceStatusValue.STREAMING;
  if (normalized === 'ERROR') return DeviceStatusValue.ERROR;
  return DeviceStatusValue.OFFLINE;
}

export function streamStatus(value: unknown) {
  const normalized = normalize(value);
  if (normalized === 'STARTING') return StreamStatus.STARTING;
  if (normalized === 'LIVE') return StreamStatus.LIVE;
  if (normalized === 'STOPPING') return StreamStatus.STOPPING;
  if (normalized === 'ENDED') return StreamStatus.ENDED;
  if (normalized === 'ERROR') return StreamStatus.ERROR;
  return StreamStatus.OFFLINE;
}

export function videoStatus(value: unknown) {
  const normalized = normalize(value);
  if (normalized === 'UPLOADING') return VideoStatus.UPLOADING;
  if (normalized === 'COMPLETED') return VideoStatus.COMPLETED;
  if (normalized === 'FAILED') return VideoStatus.FAILED;
  return VideoStatus.RECORDING;
}

export function commandName(value: unknown) {
  return normalize(value) === 'STOP' ? CommandName.STOP : CommandName.START;
}

export function commandTarget(value: unknown) {
  const normalized = normalize(value);
  return normalized === 'RECORDING' || normalized === 'RECORD'
    ? CommandTarget.RECORDING
    : CommandTarget.STREAM;
}

export function commandStatus(value: unknown) {
  const normalized = normalize(value);
  if (normalized === 'CLAIMED') return CommandStatus.CLAIMED;
  if (normalized === 'PROCESSING') return CommandStatus.PROCESSING;
  if (normalized === 'COMPLETED') return CommandStatus.COMPLETED;
  if (normalized === 'FAILED') return CommandStatus.FAILED;
  return CommandStatus.PENDING;
}

function normalize(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function lower(value: string) {
  return value.toLowerCase();
}
