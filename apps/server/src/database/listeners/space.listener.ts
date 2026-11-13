import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { TypesenseConfigService } from '../../integrations/search/typesense-config.service';

export class SpaceEvent {
  spaceId: string;
  workspaceId: string;
}

@Injectable()
export class SpaceListener {
  private readonly logger = new Logger(SpaceListener.name);

  constructor(
    private readonly typesenseConfig: TypesenseConfigService,
    @InjectQueue(QueueName.SEARCH_QUEUE) private searchQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
  ) {}

  @OnEvent(EventName.SPACE_DELETED)
  async handleSpaceDeleted(event: SpaceEvent) {
    const { spaceId, workspaceId } = event;
    if (await this.isTypesenseConfigured(event.workspaceId)) {
      await this.searchQueue.add(QueueJob.SPACE_DELETED, {
        spaceId,
        workspaceId,
      });
    }

    await this.aiQueue.add(QueueJob.SPACE_DELETED, { spaceId, workspaceId });
  }

  isTypesenseConfigured(workspaceId: string): Promise<boolean> {
    return this.typesenseConfig.isConfigured(workspaceId);
  }
}
