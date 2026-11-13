import { DB } from '@docmost/db/types/db';
import { PageEmbeddings } from '@docmost/db/types/embeddings.types';

export interface DbInterface extends DB {
  workspaceSearchConfigs: {
    workspaceId: string;
    locale: string;
  };
  pageEmbeddings: PageEmbeddings;
}
