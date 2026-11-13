import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { isUUID } from 'class-validator';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { TypesenseConfigService } from '../../integrations/search/typesense-config.service';
import { TypesenseClient } from './typesense.client';

export type { TypesenseHits } from './typesense.client';

@Injectable()
export class TypesenseService implements OnApplicationBootstrap {
  constructor(
    private readonly config: TypesenseConfigService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    const opts = {
      attempts: 5,
      backoff: { type: 'exponential', delay: 20000 },
      removeOnComplete: true,
      removeOnFail: true,
    };
    await this.queue.add(QueueJob.SEARCH_INDEX_PAGES, {}, opts);
    await this.queue.upsertJobScheduler(
      'typesense-reconcile',
      { every: 60 * 60 * 1000 },
      { name: QueueJob.SEARCH_INDEX_PAGES, data: {}, opts },
    );
  }

  private async client(workspaceId: string) {
    const config = await this.config.get(workspaceId);
    return config
      ? new TypesenseClient(config, this.db, this.queue, workspaceId)
      : undefined;
  }

  async search(
    query: string,
    workspaceId: string,
    titleOnly: boolean,
    page: number,
  ) {
    const client = await this.client(workspaceId);
    if (!client) throw new Error('Typesense is not configured');
    return client.search(query, workspaceId, titleOnly, page);
  }

  async syncPages(
    pageIds: string[],
    requireExisting = false,
    workspaceId?: string,
  ) {
    if (!pageIds.length) return;
    if (workspaceId) {
      const client = await this.client(workspaceId);
      await client?.syncPages(pageIds, requireExisting);
      return;
    }
    // Older queued jobs do not contain workspaceId. Resolve it from live pages.
    const ids = pageIds.filter((id) => isUUID(id));
    const slugs = pageIds.filter((id) => !isUUID(id));
    const pages = await this.db
      .selectFrom('pages')
      .select(['id', 'workspaceId'])
      .where((eb) =>
        eb.or([
          ...(ids.length ? [eb('id', 'in', ids)] : []),
          ...(slugs.length ? [eb('slugId', 'in', slugs)] : []),
        ]),
      )
      .execute();
    for (const id of new Set(pages.map((page) => page.workspaceId))) {
      await this.syncPages(
        pages.filter((page) => page.workspaceId === id).map((page) => page.id),
        requireExisting,
        id,
      );
    }
  }

  async removeByFilter(filter: string, workspaceId: string) {
    const client = await this.client(workspaceId);
    await client?.removeByFilter(filter);
  }

  async reindexBatch(cursor?: string, workspaceId?: string) {
    if (workspaceId) {
      const client = await this.client(workspaceId);
      await client?.reindexBatch(cursor);
      return;
    }
    const workspaces = await this.db
      .selectFrom('workspaces')
      .select('id')
      .execute();
    for (const workspace of workspaces) {
      if (await this.config.isConfigured(workspace.id)) {
        await this.config.queueBackfill(workspace.id);
      }
    }
  }
}
