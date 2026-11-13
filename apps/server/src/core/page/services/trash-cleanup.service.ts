import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { executeTx } from '@docmost/db/utils';

const DEFAULT_RETENTION_DAYS = 30;

@Injectable()
export class TrashCleanupService {
  private readonly logger = new Logger(TrashCleanupService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    private readonly pageRepo: PageRepo,
  ) {}

  @Interval('trash-cleanup', 24 * 60 * 60 * 1000) // every 24 hours
  async cleanupOldTrash() {
    try {
      this.logger.debug('Starting trash cleanup job');

      const workspaces = await this.db
        .selectFrom('workspaces')
        .select(['id', 'trashRetentionDays'])
        .where('deletedAt', 'is', null)
        .execute();

      let totalCleaned = 0;

      for (const workspace of workspaces) {
        const retentionDays =
          workspace.trashRetentionDays ?? DEFAULT_RETENTION_DAYS;

        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - retentionDays);

        const oldDeletedPages = await this.db
          .selectFrom('pages')
          .select(['id'])
          .where('workspaceId', '=', workspace.id)
          .where('deletedAt', '<', retentionDate)
          .execute();

        for (const page of oldDeletedPages) {
          try {
            if (await this.cleanupPage(page.id, workspace.id, retentionDate)) {
              totalCleaned++;
            }
          } catch (error) {
            this.logger.error(
              `Failed to cleanup page ${page.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              error instanceof Error ? error.stack : undefined,
            );
          }
        }
      }

      this.logger.debug(
        totalCleaned > 0
          ? `Trash cleanup completed: ${totalCleaned} pages cleaned`
          : 'No old trash items to clean up',
      );
    } catch (error) {
      this.logger.error(
        'Trash cleanup job failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async cleanupPage(
    pageId: string,
    workspaceId: string,
    retentionDate: Date,
  ) {
    const deletedIds = await executeTx(this.db, async (trx) => {
      const candidate = await trx
        .selectFrom('pages')
        .select('spaceId')
        .where('id', '=', pageId)
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();
      if (!candidate) return [];

      // Restore and hierarchy changes take the same lock before touching rows.
      await this.pageRepo.lockPageHierarchySpaces([candidate.spaceId], trx);
      const root = await trx
        .selectFrom('pages')
        .select('id')
        .where('id', '=', pageId)
        .where('workspaceId', '=', workspaceId)
        .where('spaceId', '=', candidate.spaceId)
        .where('deletedAt', '<', retentionDate)
        .forUpdate()
        .executeTakeFirst();
      if (!root) return [];

      const descendants = await trx
        .withRecursive('page_descendants', (qb) =>
          qb
            .selectFrom('pages')
            .select('id')
            .where('id', '=', pageId)
            .unionAll((qb) =>
              qb
                .selectFrom('pages as p')
                .select('p.id')
                .innerJoin('page_descendants as pd', 'pd.id', 'p.parentPageId'),
            ),
        )
        .selectFrom('pages')
        .select(['pages.id', 'pages.deletedAt'])
        .where('pages.id', 'in', (qb) =>
          qb.selectFrom('page_descendants').select('id'),
        )
        .orderBy('pages.id')
        .forUpdate()
        .execute();

      // parent_page_id cascades on deletion. Never cascade into a restored or
      // recently trashed descendant, even if the root has expired.
      if (
        descendants.some(
          (page) => !page.deletedAt || page.deletedAt >= retentionDate,
        )
      )
        return [];
      const deleted = await trx
        .deleteFrom('pages')
        .where(
          'id',
          'in',
          descendants.map((page) => page.id),
        )
        .returning('id')
        .execute();
      return deleted.map((page) => page.id);
    });

    // Do not delete files until the page deletion has committed successfully.
    for (const id of deletedIds) {
      await this.attachmentQueue.add(
        QueueJob.DELETE_PAGE_ATTACHMENTS,
        { pageId: id },
        {
          jobId: `delete-page-attachments-${id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    }
    return deletedIds.length > 0;
  }
}
