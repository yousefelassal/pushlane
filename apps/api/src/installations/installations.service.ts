import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In, IsNull, Not, Raw } from 'typeorm';

import { SecretCipher } from '../../../../libs/database/src/cipher.js';
import { Installation, InstallationSession } from '../../../../libs/database/src/entities/index.js';
import { lockProject } from '../../../../libs/database/src/locks.js';
import { hashSecret } from '../../../../libs/database/src/secrets.js';

import type { DataSource, EntityManager } from 'typeorm';
import type { PushEndpoint } from '../../../../libs/contracts/src/index.js';
import type { Project } from '../../../../libs/database/src/entities/index.js';

const REGISTRATION_TOKEN_TTL_MS = 3_600_000;

/** Owns installation identity bindings, endpoint refresh, and revocation. */
@Injectable()
export class InstallationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SecretCipher) private readonly cipher: SecretCipher
  ) {}

  /**
   * Starts a new registration session and retires the installation's previous binding.
   *
   * The caller must authenticate its own user before issuing this token.
   */
  async issueToken(project: Project, input: { userId: string; installationId: string }) {
    const token = `pl_reg_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS);

    await this.dataSource.transaction(async (manager) => {
      await lockProject(manager, project.id);

      await manager.update(
        InstallationSession,
        { projectId: project.id, installationId: input.installationId, revokedAt: IsNull() },
        { revokedAt: () => 'now()' }
      );

      await manager.update(
        Installation,
        { projectId: project.id, id: input.installationId },
        { revokedAt: () => 'now()', version: () => 'version + 1' }
      );

      await manager.insert(InstallationSession, {
        id: randomUUID(),
        projectId: project.id,
        installationId: input.installationId,
        userId: input.userId,
        tokenHash: hashSecret(token),
        expiresAt,
      });
    });

    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Binds a provider endpoint to the session's installation and user.
   *
   * An endpoint can belong to one active installation per project, so registering it here retires
   * any other installation and session that held it.
   */
  async register(token: string, installationId: string, endpoint: PushEndpoint) {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.activeSession(manager, token, installationId);
      const identity =
        endpoint.kind === 'webpush' ? endpoint.subscription.endpoint : endpoint.token;
      const endpointHash = hashSecret(`${endpoint.kind}:${identity}`);
      const endpointFingerprint = hashSecret(JSON.stringify(endpoint));
      const displacedScope = {
        projectId: session.projectId,
        endpointHash,
        id: Not(installationId),
        revokedAt: IsNull(),
      };
      const displaced = await manager.find(Installation, {
        select: { sessionId: true },
        where: displacedScope,
      });

      if (displaced.length > 0) {
        await manager.update(
          InstallationSession,
          { projectId: session.projectId, id: In(displaced.map((row) => row.sessionId)) },
          { revokedAt: () => 'now()' }
        );

        await manager.update(Installation, displacedScope, {
          revokedAt: () => 'now()',
          version: () => 'version + 1',
        });
      }

      const binding = {
        userId: session.userId,
        sessionId: session.id,
        provider: endpoint.kind,
        endpointHash,
        endpointCiphertext: this.cipher.encrypt(endpoint, session.projectId),
        endpointFingerprint,
        revokedAt: null,
      };

      // The row lock orders this write after a worker's concurrent endpoint invalidation.
      const existing = await manager.findOne(Installation, {
        where: { projectId: session.projectId, id: installationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (existing) {
        const unchanged =
          existing.endpointFingerprint === endpointFingerprint &&
          existing.sessionId === session.id &&
          existing.revokedAt === null;

        await manager.update(
          Installation,
          { projectId: session.projectId, id: installationId },
          { ...binding, version: unchanged ? existing.version : existing.version + 1 }
        );
      } else {
        await manager.insert(Installation, {
          ...binding,
          projectId: session.projectId,
          id: installationId,
        });
      }

      return { id: installationId, userId: session.userId, provider: endpoint.kind };
    });
  }

  /** Revocation is durable, and repeated logout requests remain successful. */
  async revoke(token: string, installationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOneBy(InstallationSession, {
        tokenHash: hashSecret(token),
      });

      if (!session) {
        throw new UnauthorizedException('Invalid registration token.');
      }

      if (session.installationId !== installationId) {
        throw new NotFoundException('Installation not found.');
      }

      await lockProject(manager, session.projectId);

      await manager.update(
        InstallationSession,
        { id: session.id, revokedAt: IsNull() },
        { revokedAt: () => 'now()' }
      );

      await manager.update(
        Installation,
        {
          projectId: session.projectId,
          id: installationId,
          sessionId: session.id,
          revokedAt: IsNull(),
        },
        { revokedAt: () => 'now()', version: () => 'version + 1' }
      );
    });
  }

  /** Resolves a registration token to its unexpired, unrevoked session under the project lock. */
  private async activeSession(
    manager: EntityManager,
    token: string,
    installationId: string
  ): Promise<InstallationSession> {
    const candidate = await manager.findOneBy(InstallationSession, {
      tokenHash: hashSecret(token),
    });

    if (!candidate || candidate.installationId !== installationId) {
      throw new UnauthorizedException('Invalid registration token.');
    }

    await lockProject(manager, candidate.projectId);

    const session = await manager.findOne(InstallationSession, {
      where: {
        id: candidate.id,
        revokedAt: IsNull(),
        expiresAt: Raw((column) => `${column} > now()`),
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (!session) {
      throw new UnauthorizedException('Registration token expired or revoked.');
    }

    return session;
  }
}
