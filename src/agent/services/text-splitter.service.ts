import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Document } from 'langchain';
import { RAG_CONSTANTS } from '../constants';

@Injectable()
export class TextSplitterService {
    private readonly logger = new Logger(TextSplitterService.name);

    private readonly splitter = new RecursiveCharacterTextSplitter({
        chunkSize: RAG_CONSTANTS.CHUNK_SIZE,
        chunkOverlap: RAG_CONSTANTS.CHUNK_OVERLAP,
    });

    /**
     * Разбивает документы на чанки для векторного хранилища.
     * Использует RecursiveCharacterTextSplitter с настройками из RAG_CONSTANTS.
     *
     * @param documents - Массив документов LangChain для разбиения
     * @returns Массив чанков документов, готовых для добавления в векторное хранилище
     */
    async splitDocuments(documents: Document[]): Promise<Document[]> {
        if (!documents?.length) {
            this.logger.warn('splitDocuments called with empty array');
            return [];
        }
        const chunks = await this.splitter.splitDocuments(documents);
        this.logger.log(
            `Split ${documents.length} document(s) into ${chunks.length} chunk(s)`,
        );
        return chunks;
    }
}
