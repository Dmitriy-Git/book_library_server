import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRetrievalChain } from '@langchain/classic/chains/retrieval';
import { createStuffDocumentsChain } from '@langchain/classic/chains/combine_documents';
import type { Runnable } from '@langchain/core/runnables';
import type { Document } from '@langchain/core/documents';
import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { GigaChat } from 'langchain-gigachat/chat_models';
import { GigaChatEmbeddings } from 'langchain-gigachat/embeddings';
import { Agent } from 'node:https';
import { VectorStoreService } from './vector-store.service';
import { RAG_CONSTANTS } from '../constants';
import { ChromaDBErrorHandler } from './chromadb-error-handler.service';

const RAG_SYSTEM = `Ты — помощник, отвечающий на вопросы по загруженным документам.
Отвечай строго на основе приведённого контекста. Если в контексте нет ответа — так и скажи.`;

const GENERAL_ASSISTANT_SYSTEM = `Ты — полезный помощник. Отвечай на вопросы пользователя на основе своих знаний. Будь краток и информативен.`;

const ragPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(RAG_SYSTEM),
  HumanMessagePromptTemplate.fromTemplate(
    'Контекст из документов:\n\n{context}\n\nВопрос: {input}',
  ),
]);

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private chain!: Runnable<
    { input: string },
    { context: Document[]; answer: string }
  >;

  private llm!: GigaChat;
  private embeddings!: GigaChatEmbeddings;

  constructor(
    private readonly configService: ConfigService,
    private readonly vectorStore: VectorStoreService,
    private readonly chromaErrorHandler: ChromaDBErrorHandler,
  ) {}

  /**
   * Инициализирует RAG сервис при старте модуля.
   * Создает GigaChat модель, GigaChatEmbeddings, инициализирует векторное хранилище
   * и настраивает RAG цепочку для ответов на вопросы.
   *
   * @throws {Error} Если GIGACHAT_API_KEY не установлен в переменных окружения
   */
  async onModuleInit(): Promise<void> {
    const credentials = this.configService.get<string>('GIGACHAT_API_KEY') ?? '';
    const baseUrl = this.configService.get<string>('GIGACHAT_API_URL') ?? '';

    const httpsAgent = new Agent({
      rejectUnauthorized: false,
    });

    this.llm = new GigaChat({
      credentials,
      baseUrl,
      httpsAgent,
    });

    this.embeddings = new GigaChatEmbeddings({
      credentials,
      baseUrl,
      httpsAgent,
    });

    this.vectorStore.setEmbeddings(this.embeddings);
    const retriever = this.vectorStore.getRetriever(RAG_CONSTANTS.DEFAULT_RETRIEVER_K);

    const combineDocsChain = await createStuffDocumentsChain({
      llm: this.llm,
      prompt: ragPrompt,
    });

    this.chain = await createRetrievalChain({
      retriever,
      combineDocsChain,
    });
  }

  /**
   * Вызов LLM напрямую без RAG (режим общего ассистента).
   * Используется при documentCount === 0 или при недоступности ChromaDB.
   */
  private async askGeneralAssistant(
    question: string,
  ): Promise<{ answer: string; context?: Document[] }> {
    const response = await this.llm.invoke([
      new SystemMessage(GENERAL_ASSISTANT_SYSTEM),
      new HumanMessage(question),
    ]);

    return {
      answer:
        typeof response.content === 'string'
          ? response.content
          : String(response.content),
      context: [],
    };
  }

  /**
   * @param question - Вопрос пользователя (должен соответствовать валидации DTO)
   * @returns Объект с ответом и опциональным контекстом из документов
   * @throws {ChromaDBException} Если произошла ошибка ChromaDB (будет обработана фильтром)
   * @throws {Error} Если произошла другая ошибка при обработке
   */
  async ask(
    question: string,
  ): Promise<{ answer: string; context?: Document[] }> {
    try {
      const status = await this.vectorStore.getStatus();

      if (status.documentCount === 0) {
        this.logger.log('No documents in store, using general assistant mode');
        return this.askGeneralAssistant(question);
      }

      const result = await this.chain.invoke({ input: question });
      return {
        answer: result.answer,
        context: result.context,
      };
    } catch (err) {
      // Если это ошибка ChromaDB, делаем fallback на general assistant
      // Это бизнес-логика специфичная для метода ask
      if (this.chromaErrorHandler.isChromaError(err)) {
        this.logger.warn(
          'ChromaDB unavailable, falling back to general assistant',
        );
        return this.askGeneralAssistant(question);
      }

      // Остальные ошибки логируем и пробрасываем
      this.logger.error(
        `RAG ask failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
