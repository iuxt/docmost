import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { isUUID } from 'class-validator';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { TypesenseService } from './typesense.service';

@Processor(QueueName.SEARCH_QUEUE, { concurrency: 1 })
export class SearchQueueProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger = new Logger(SearchQueueProcessor.name);

  constructor(
    private readonly environment: EnvironmentService,
    private readonly typesense: TypesenseService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (this.environment.getSearchDriver() !== 'typesense') return;
    switch (job.name) {
      case QueueJob.SEARCH_INDEX_PAGES:
        await this.typesense.reindexBatch(job.data.cursor);
        break;
      case QueueJob.PAGE_CREATED:
        await this.typesense.syncPages(job.data.pageIds ?? [], true);
        break;
      case QueueJob.PAGE_UPDATED:
      case QueueJob.PAGE_CONTENT_UPDATED:
      case QueueJob.PAGE_MOVED_TO_SPACE:
      case QueueJob.PAGE_RESTORED:
      case QueueJob.PAGE_SOFT_DELETED:
      case QueueJob.PAGE_DELETED:
        // Read current state even for deletion events: an older queued delete
        // must not remove a page that has since been restored.
        await this.typesense.syncPages(job.data.pageIds ?? []);
        break;
      case QueueJob.SPACE_DELETED:
      case QueueJob.WORKSPACE_DELETED: {
        const field =
          job.name === QueueJob.SPACE_DELETED ? 'spaceId' : 'workspaceId';
        const id = job.data[field];
        if (!isUUID(id)) throw new Error(`Invalid ${field}`);
        await this.typesense.removeByFilter(`${field}:=${id}`);
        break;
      }
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job) {
    // The error message is controlled by our transport, without document text.
    this.logger.error(`Search indexing job ${job.name} failed`);
  }

  async onModuleDestroy() {
    if (this.worker) await this.worker.close();
  }
}
