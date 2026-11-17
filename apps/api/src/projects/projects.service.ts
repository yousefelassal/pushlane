import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { PLAN_LIMITS, providerCredentialsSchema } from '../../../../libs/contracts/src/index.js';
import { SecretCipher } from '../../../../libs/database/src/cipher.js';
import { MonthlyUsage, Project } from '../../../../libs/database/src/entities/index.js';
import { hashSecret } from '../../../../libs/database/src/secrets.js';
import { currentMonth } from '../../../../libs/database/src/sql.js';

import type { Repository } from 'typeorm';
import type {
  Environment,
  Plan,
  ProviderCredentials,
} from '../../../../libs/contracts/src/index.js';

/** Provisions isolated project environments and authenticates backend keys. */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(MonthlyUsage) private readonly usage: Repository<MonthlyUsage>,
    @Inject(SecretCipher) private readonly cipher: SecretCipher
  ) {}

  /** Returns the only copy of the backend API key. The database keeps its hash. */
  async create(input: {
    name: string;
    environment: Environment;
    plan: Plan;
    credentials: ProviderCredentials;
  }) {
    const id = randomUUID();
    const apiKey = `pl_${input.environment === 'production' ? 'live' : 'test'}_${randomBytes(32).toString('base64url')}`;

    await this.projects.insert({
      id,
      name: input.name,
      environment: input.environment,
      plan: input.plan,
      apiKeyHash: hashSecret(apiKey),
      credentialsCiphertext: this.cipher.encrypt(input.credentials, id),
    });

    return {
      projectId: id,
      apiKey,
      environment: input.environment,
      plan: input.plan,
    };
  }

  async authenticate(apiKey: string): Promise<Project> {
    const project = await this.projects.findOneBy({ apiKeyHash: hashSecret(apiKey) });

    if (!project) {
      throw new UnauthorizedException('Invalid backend API key.');
    }

    return project;
  }

  /** Public project settings and allowance usage. Never includes secrets. */
  async describe(project: Project) {
    const month = currentMonth();
    const usage = await this.usage.findOneBy({ projectId: project.id, month });
    const credentials = this.cipher.decrypt(
      project.credentialsCiphertext,
      project.id,
      providerCredentialsSchema
    );
    const { monthlyDispatches: limit, logRetentionDays } = PLAN_LIMITS[project.plan];
    const reservedDispatches = usage?.reservedDispatches ?? 0;

    return {
      id: project.id,
      name: project.name,
      environment: project.environment,
      plan: project.plan,
      providers: Object.keys(credentials),
      webPushPublicKey: credentials.webpush?.publicKey ?? null,
      usage: {
        month: month.slice(0, 7),
        reservedDispatches,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - reservedDispatches),
      },
      logRetentionDays,
    };
  }
}
