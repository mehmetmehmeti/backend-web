import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOutboxService } from '../sync/sync-outbox.service';

type RegisterInput = {
  email?: string;
  password?: string;
  fullName?: string;
  role?: UserRole;
};

type LoginInput = {
  email?: string;
  password?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncOutbox: SyncOutboxService,
  ) {}

  async register(input: RegisterInput) {
    const email = this.normalizeEmail(input.email);
    const password = input.password?.trim() ?? '';
    const fullName = input.fullName?.trim() ?? '';
    const role = input.role ?? UserRole.OPERATOR;

    if (!email) {
      throw new BadRequestException('email is required');
    }
    if (password.length < 8) {
      throw new BadRequestException('password must contain at least 8 characters');
    }
    if (!fullName) {
      throw new BadRequestException('fullName is required');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash: await hash(password, 12),
          role,
          status: UserStatus.ACTIVE,
          createdAt: now,
          updatedAt: now,
        },
      });

      await this.syncOutbox.createEvent(
        {
          entityType: 'user',
          entityId: created.id,
          action: 'create',
          version: created.version,
          occurredAt: now,
          data: this.toUserSyncData(created),
        },
        tx,
      );

      return created;
    });

    return {
      token: this.createToken(user),
      user: this.toPublicUser(user),
    };
  }

  async login(input: LoginInput) {
    const email = this.normalizeEmail(input.email);
    const password = input.password?.trim() ?? '';
    if (!email || !password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      token: this.createToken(user),
      user: this.toPublicUser(user),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return { user: this.toPublicUser(user) };
  }

  private createToken(user: { id: string; email: string; role: UserRole }) {
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '8h') as SignOptions['expiresIn'];
    return sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET ?? 'change-this-local-secret',
      { expiresIn },
    );
  }

  private normalizeEmail(value?: string) {
    return value?.trim().toLowerCase() ?? '';
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role.toLowerCase(),
      status: user.status.toLowerCase(),
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }

  private toUserSyncData(user: {
    id: string;
    email: string;
    fullName: string;
    passwordHash: string;
    role: UserRole;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
    version: number;
  }) {
    return {
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      full_name: user.fullName,
      role: user.role.toLowerCase(),
      status: user.status.toLowerCase(),
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
      version: user.version,
    };
  }
}
