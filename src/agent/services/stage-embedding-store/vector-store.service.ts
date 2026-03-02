import * as https from 'node:https';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Document } from 'langchain';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { BaseRetriever } from '@langchain/core/dist/retrievers';
import { GigaChatEmbeddings } from 'langchain-gigachat/embeddings';
import { RAG_CONSTANTS } from '../../constants';
import { ChromaDBErrorHandler } from '../chromadb-error-handler.service';

/**
 * Этап 2 пайплайна RAG: создание эмбеддингов (GigaChatEmbeddings) и сохранение в векторной БД (Chroma).
 * Также предоставляет retriever и статус для этапа 3 (генерация).
 */
@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);

  private embeddings!: GigaChatEmbeddings;
  private store!: Chroma;

  constructor(
    private readonly configService: ConfigService,
    private readonly chromaErrorHandler: ChromaDBErrorHandler,
  ) {}

  /**
   * Инициализирует GigaChatEmbeddings и Chroma при старте модуля.
   * @throws {Error} Если не заданы GIGACHAT_API_KEY, GIGACHAT_API_URL, CHROMA_DB_PATH или CHROMA_COLLECTION_NAME
   */
  onModuleInit(): void {
    const credentials = this.configService.get<string>('GIGACHAT_API_KEY') ?? '';
    const baseUrl = this.configService.get<string>('GIGACHAT_API_URL') ?? '';
    const dbPath = this.configService.get<string>('CHROMA_DB_PATH') ?? '';
    const collectionName =
      this.configService.get<string>('CHROMA_COLLECTION_NAME') ?? '';

    if (!credentials || !baseUrl) {
      throw new Error(
        'GIGACHAT_API_KEY and GIGACHAT_API_URL must be set in environment',
      );
    }
    if (!dbPath || !collectionName) {
      throw new Error(
        'CHROMA_DB_PATH and CHROMA_COLLECTION_NAME must be set in environment',
      );
    }

    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    this.embeddings = new GigaChatEmbeddings({
      credentials,
      baseUrl,
      httpsAgent,
    });

    this.store = new Chroma(this.embeddings, {
      url: dbPath,
      collectionName,
    });
  }

  /**
   * Добавляет документы в векторное хранилище Chroma.
   * Документы преобразуются в эмбеддинги (GigaChatEmbeddings) и сохраняются в Chroma.
   *
   * @param documents - Массив документов LangChain для добавления в хранилище
   * @returns Массив идентификаторов добавленных документов в Chroma
   * @throws {ChromaDBException} При ошибке ChromaDB
   */
  async addDocuments(documents: Document[]): Promise<string[]> {
    if (!documents?.length) return [];

    try {
      const ids = await this.store.addDocuments(documents);
      return ids;
    } catch (err) {
      this.chromaErrorHandler.handleError(err, 'addDocuments');
    }
  }

  /**
   * Возвращает retriever для поиска релевантных документов по запросу (этап 3).
   *
   * @param k - Количество документов для извлечения
   * @returns BaseRetriever для RAG цепочки
   * @throws {ChromaDBException} При ошибке ChromaDB
   */
  getRetriever(k: number = RAG_CONSTANTS.DEFAULT_RETRIEVER_K): BaseRetriever {
    try {
      return this.store.asRetriever({ k });
    } catch (err) {
      this.chromaErrorHandler.handleError(err, 'getRetriever');
    }
  }

  /**
   * Возвращает статус векторного хранилища (количество документов в коллекции).
   */
  async getStatus(): Promise<{ documentCount: number }> {
    try {
      const collection = await this.store.ensureCollection();
      const count =
        typeof (collection as { count?: () => Promise<number> }).count ===
        'function'
          ? await (collection as { count: () => Promise<number> }).count()
          : 0;
      return { documentCount: count };
    } catch (err) {
      this.logger.error(
        `Chroma getStatus failed: ${(err as Error).message}`,
      );
      return { documentCount: 0 };
    }
  }
}
