import { Global, Module } from '@nestjs/common';
import { TypesenseConfigService } from './typesense-config.service';

@Global()
@Module({
  providers: [TypesenseConfigService],
  exports: [TypesenseConfigService],
})
export class SearchConfigModule {}
