import { BadRequestException } from '@nestjs/common';

export function asObject(value: unknown, name = 'body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function requiredString(value: unknown, name: string) {
  const result = optionalString(value);
  if (!result) {
    throw new BadRequestException(`${name} is required`);
  }
  return result;
}

export function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

export function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optionalDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
