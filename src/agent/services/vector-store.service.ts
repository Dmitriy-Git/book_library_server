import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Document } from 'langchain';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { BaseRetriever } from '@langchain/core/dist/retrievers';
import { GigaChatEmbeddings } from 'langchain-gigachat/embeddings';
import { RAG_CONSTANTS } from '../constants';
import { ChromaDBErrorHandler } from './chromadb-error-handler.service';

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);

  private store!: Chroma;
  private embeddings!: GigaChatEmbeddings;

  constructor(
    private readonly configService: ConfigService,
    private readonly chromaErrorHandler: ChromaDBErrorHandler,
  ) {}

  /**
   * Устанавливает embeddings, переданные из RagService, и инициализирует Chroma store.
   * Должен быть вызван при инициализации модуля перед использованием других методов.
   *
   * @param embeddings - Экземпляр GigaChatEmbeddings для создания векторных представлений
   * @throws {Error} Если CHROMA_DB_PATH или CHROMA_COLLECTION_NAME не установлены
   */
  setEmbeddings(embeddings: GigaChatEmbeddings): void {
    this.embeddings = embeddings;
    this.initializeStore();
  }

  /**
   * Инициализирует Chroma векторное хранилище.
   */
  private initializeStore(): void {
    if (this.store) return;

    const dbPath = this.configService.get<string>('CHROMA_DB_PATH') ?? '';
    const collectionName = this.configService.get<string>('CHROMA_COLLECTION_NAME') ?? '';

    if (!dbPath || !collectionName) {
      throw new Error(
        'CHROMA_DB_PATH and CHROMA_COLLECTION_NAME must be set in environment',
      );
    }

    this.store = new Chroma(this.embeddings, {
      url: dbPath,
      collectionName,
    });
  }

  private getStore(): Chroma {
    return this.store;
  }

  /**
   * Добавляет документы в векторное хранилище Chroma.
   * Документы будут разбиты на чанки и преобразованы в эмбеддинги для поиска.
   *
   * @param documents - Массив документов LangChain для добавления в хранилище
   * @returns Массив идентификаторов добавленных документов в Chroma
   * @throws {Error} Если хранилище не инициализировано или произошла ошибка при добавлении
   */
  async addDocuments(documents: Document[]): Promise<string[]> {
    if (!documents?.length) return [];

    try {
      const store = this.getStore();
      const ids = await store.addDocuments(documents);

      return ids;
    } catch (err) {
      this.logger.error(
        `Chroma addDocuments failed: ${(err as Error).message}`,
      );

      // Используем хелпер для обработки ошибок ChromaDB
      this.chromaErrorHandler.handleError(err, 'addDocuments');
    }
  }

  /**
   * Возвращает retriever с настройкой k для RAG цепочки.
   * Retriever используется для поиска релевантных документов по запросу.
   *
   * @param k - Количество документов для извлечения (по умолчанию из RAG_CONSTANTS.DEFAULT_RETRIEVER_K)
   * @returns BaseRetriever для использования в RAG цепочке
   * @throws {ChromaDBException} Если хранилище не инициализировано или недоступно
   */
  getRetriever(k: number = RAG_CONSTANTS.DEFAULT_RETRIEVER_K): BaseRetriever {
    try {
      const store = this.getStore();
      if (!store) {
        throw new Error('Векторное хранилище не инициализировано');
      }
      return store.asRetriever({ k });
    } catch (err) {
      // Используем хелпер для обработки ошибок ChromaDB
      this.chromaErrorHandler.handleError(err, 'getRetriever');
    }
  }

  /**
   * Возвращает статус векторного хранилища.
   * Показывает количество документов в коллекции Chroma.
   *
   * @returns Объект с количеством документов в хранилище
   */
  async getStatus(): Promise<{ documentCount: number }> {
    try {
      const store = this.getStore();
      const collection = await store.ensureCollection();
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
