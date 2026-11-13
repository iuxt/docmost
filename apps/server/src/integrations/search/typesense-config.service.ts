import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  EncryptionPurpose,
  EncryptionService,
} from '../encryption/encryption.service';
import { QueueJob, QueueName } from '../queue/constants';
import { UpdateTypesenseConfigDto } from '../../core/workspace/dto/update-typesense-config.dto';

export interface TypesenseConfig {
  url: string;
  apiKey: string;
  locale: string;
}

@Injectable()
export class TypesenseConfigService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly encryption: EncryptionService,
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly queue: Queue,
  ) {}

  async get(workspaceId: string): Promise<TypesenseConfig | undefined> {
    if (!workspaceId) return;
    const row = await this.db
      .selectFrom('workspaceSearchConfigs')
      .select(['url', 'apiKey', 'locale'])
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (row) {
      return {
        url: row.url,
        locale: row.locale,
        apiKey: this.encryption.decrypt(
          row.apiKey,
          EncryptionPurpose.SEARCH_CREDENTIALS,
        ),
      };
    }
  }

  async isConfigured(workspaceId: string): Promise<boolean> {
    return Boolean(await this.get(workspaceId));
  }

  async getSettings(workspaceId: string) {
    const config = await this.get(workspaceId);
    return {
      url: config?.url ?? '',
      locale: config?.locale ?? 'zh',
      hasApiKey: Boolean(config?.apiKey),
    };
  }

  private async resolve(
    workspaceId: string,
    dto: UpdateTypesenseConfigDto,
  ): Promise<TypesenseConfig> {
    const current = await this.get(workspaceId);
    const apiKey = dto.apiKey?.trim() || current?.apiKey;
    if (!apiKey)
      throw new BadRequestException('Typesense API key is required.');
    return { url: dto.url.replace(/\/+$/, ''), apiKey, locale: dto.locale };
  }

  async testConnection(workspaceId: string, dto: UpdateTypesenseConfigDto) {
    const config = await this.resolve(workspaceId, dto);
    await this.checkConnection(config);
    return { success: true };
  }

  private async checkConnection(config: TypesenseConfig) {
    try {
      // /health is public and cannot verify the API key.
      const response = await fetch(`${config.url}/collections`, {
        headers: { 'X-TYPESENSE-API-KEY': config.apiKey },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok || !Array.isArray(await response.json()))
        throw new Error();
    } catch {
      throw new BadRequestException(
        'Unable to connect to Typesense. Check the URL and API key.',
      );
    }
  }

  async save(workspaceId: string, dto: UpdateTypesenseConfigDto) {
    const config = await this.resolve(workspaceId, dto);
    await this.checkConnection(config);
    const values = {
      workspaceId,
      url: config.url,
      apiKey: this.encryption.encrypt(
        config.apiKey,
        EncryptionPurpose.SEARCH_CREDENTIALS,
      ),
      locale: config.locale,
    };
    await this.db
      .insertInto('workspaceSearchConfigs')
      .values(values)
      .onConflict((oc) => oc.column('workspaceId').doUpdateSet(values))
      .execute();
    await this.queueBackfill(workspaceId);
    return this.getSettings(workspaceId);
  }

  async queueBackfill(workspaceId: string) {
    await this.queue.add(
      QueueJob.SEARCH_INDEX_PAGES,
      { workspaceId },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 20000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
