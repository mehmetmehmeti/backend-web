import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class EdgeSyncAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = process.env.EDGE_SYNC_TOKEN?.trim();
    if (!expected) {
      throw new UnauthorizedException('EDGE_SYNC_TOKEN is not configured');
    }

    const provided = this.readToken(request);
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid edge sync token');
    }

    return true;
  }

  private readToken(request: Request) {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim();
    }

    const header = request.headers['x-edge-sync-token'];
    if (typeof header === 'string' && header.trim()) {
      return header.trim();
    }

    const query = request.query.token;
    if (typeof query === 'string' && query.trim()) {
      return query.trim();
    }

    return undefined;
  }
}

