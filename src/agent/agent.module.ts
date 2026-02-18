import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { DocumentLoaderService } from './document-loader.service';
import { RagService } from './rag.service';
import { TextSplitterService } from './text-splitter.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  controllers: [RagController],
  providers: [
    DocumentLoaderService,
    RagService,
    TextSplitterService,
    VectorStoreService,
  ],
  exports: [
    DocumentLoaderService,
    RagService,
    TextSplitterService,
    VectorStoreService,
  ],
})
export class AgentModule { }
