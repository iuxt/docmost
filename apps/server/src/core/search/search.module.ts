import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PublicSpaceModule } from '../public-space/public-space.module';
import { ShareModule } from '../share/share.module';
import { TypesenseService } from './typesense.service';
import { TypesenseSearchService } from './typesense-search.service';
import { SearchQueueProcessor } from './search-queue.processor';
import { SpaceListener } from '@docmost/db/listeners/space.listener';
import { WorkspaceListener } from '@docmost/db/listeners/workspace.listener';

@Module({
  imports: [PublicSpaceModule, ShareModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    TypesenseService,
    TypesenseSearchService,
    SearchQueueProcessor,
    SpaceListener,
    WorkspaceListener,
  ],
  exports: [SearchService],
})
export class SearchModule {}
