import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { TypesenseConfigService } from '../../integrations/search/typesense-config.service';

export class WorkspaceEvent {
  workspaceId: string;
}

@Injectable()
export class WorkspaceListener {
  private readonly logger = new Logger(WorkspaceListener.name);

  constructor(
    private readonly typesenseConfig: TypesenseConfigService,
    @InjectQueue(QueueName.SEARCH_QUEUE) private searchQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
  ) {}

  @OnEvent(EventName.WORKSPACE_DELETED)
  async handlePageDeleted(event: WorkspaceEvent) {
    const { workspaceId } = event;
    if (await this.isTypesenseConfigured(event.workspaceId)) {
      await this.searchQueue.add(QueueJob.WORKSPACE_DELETED, { workspaceId });
    }

    await this.aiQueue.add(QueueJob.WORKSPACE_DELETED, { workspaceId });
  }

  isTypesenseConfigured(workspaceId: string): Promise<boolean> {
    return this.typesenseConfig.isConfigured(workspaceId);
  }
}
