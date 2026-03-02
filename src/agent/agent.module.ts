import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './services/stage-generation/rag.service';
import { DocumentLoaderService } from './services/stage-data-preparation/document-loader.service';
import { TextSplitterService } from './services/stage-data-preparation/text-splitter.service';
import { VectorStoreService } from './services/stage-embedding-store/vector-store.service';
import { ChromaDBErrorHandler } from './services/chromadb-error-handler.service';

@Module({
  controllers: [RagController],
  providers: [
    DocumentLoaderService,
    TextSplitterService,
    VectorStoreService,
    RagService,
    ChromaDBErrorHandler,
  ],
  exports: [
    DocumentLoaderService,
    RagService,
    TextSplitterService,
    VectorStoreService,
    ChromaDBErrorHandler,
  ],
})
export class AgentModule { }
