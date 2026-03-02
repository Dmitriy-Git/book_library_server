import * as https from 'node:https';
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
import { VectorStoreService } from '../stage-embedding-store/vector-store.service';
import { RAG_CONSTANTS } from '../../constants';
import { ChromaDBErrorHandler } from '../chromadb-error-handler.service';

const RAG_SYSTEM = `Ты — помощник, отвечающий на вопросы по загруженным документам.
Отвечай строго на основе приведённого контекста. Если в контексте нет ответа — так и скажи.`;

const GENERAL_ASSISTANT_SYSTEM = `Ты — полезный помощник. Отвечай на вопросы пользователя на основе своих знаний. Будь краток и информативен.`;

const ragPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(RAG_SYSTEM),
  HumanMessagePromptTemplate.fromTemplate(
    'Контекст из документов:\n\n{context}\n\nВопрос: {input}',
  ),
]);

/**
 * Этап 3 пайплайна RAG: запрос к векторному датасету и генерация ответа LLM.
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private chain!: Runnable<
    { input: string },
    { context: Document[]; answer: string }
  >;

  private llm!: GigaChat;

  constructor(
    private readonly configService: ConfigService,
    private readonly vectorStore: VectorStoreService,
    private readonly chromaErrorHandler: ChromaDBErrorHandler,
  ) {}

  /**
   * Инициализирует RAG при старте модуля: создаёт LLM и цепочку retrieval + generation.
   * Векторное хранилище и эмбеддинги инициализируются в VectorStoreService (этап 2).
   */
  async onModuleInit(): Promise<void> {
    const credentials = this.configService.get<string>('GIGACHAT_API_KEY') ?? '';
    const baseUrl = this.configService.get<string>('GIGACHAT_API_URL') ?? '';

    if (!credentials || !baseUrl) {
      throw new Error(
        'GIGACHAT_API_KEY and GIGACHAT_API_URL must be set in environment',
      );
    }

    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    this.llm = new GigaChat({
      credentials,
      baseUrl,
      httpsAgent,
    });

    const retriever = this.vectorStore.getRetriever(
      RAG_CONSTANTS.DEFAULT_RETRIEVER_K,
    );

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
   * Режим общего ассистента без RAG (при пустом хранилище или ошибке ChromaDB).
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
   * Запрос к векторному датасету и генерация ответа на основе дополненного ввода.
   *
   * @param question - Вопрос пользователя (валидация через DTO)
   * @returns Ответ и опциональный контекст из документов
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
      if (this.chromaErrorHandler.isChromaError(err)) {
        return this.askGeneralAssistant(question);
      }

      this.logger.error(
        `RAG ask failed: ${(err as Error).message}`,
        (err as Error).stack,
      );

      throw err;
    }
  }
}
