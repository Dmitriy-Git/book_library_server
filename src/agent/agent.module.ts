import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { DocumentLoaderService } from './services/document-loader.service';
import { RagService } from './services/rag.service';
import { TextSplitterService } from './services/text-splitter.service';
import { VectorStoreService } from './services/vector-store.service';
import { ChromaDBErrorHandler } from './services/chromadb-error-handler.service';

@Module({
  controllers: [RagController],
  providers: [
    DocumentLoaderService,
    RagService,
    TextSplitterService,
    VectorStoreService,
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
