import {
  Controller,
  Post,
  Body,
  Get,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentLoaderService, type UploadedFileInput } from './services/document-loader.service';
import { TextSplitterService } from './services/text-splitter.service';
import { VectorStoreService } from './services/vector-store.service';
import { RagService } from './services/rag.service';
import { AskQuestionDto } from './dto/ask-question.dto';

@Controller('agent/rag')
export class RagController {
  constructor(
    private readonly documentLoader: DocumentLoaderService,
    private readonly textSplitter: TextSplitterService,
    private readonly vectorStore: VectorStoreService,
    private readonly ragService: RagService,
  ) {}

  /**
   * Загружает документ (PDF или TXT) в векторное хранилище.
   * Документ разбивается на чанки и добавляется в Chroma для последующего поиска.
   *
   * @param file - Загруженный файл через Multer (PDF или TXT)
   * @returns Статистика загрузки: количество документов, чанков и их идентификаторы
   * @throws {BadRequestException} Если файл не предоставлен или имеет неподдерживаемый формат
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: UploadedFileInput | undefined) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const docs = await this.documentLoader.loadFromFile(file);
    const chunks = await this.textSplitter.splitDocuments(docs);
    const ids = await this.vectorStore.addDocuments(chunks);
    return { uploaded: docs.length, chunks: chunks.length, ids };
  }

  /**
   * Задает вопрос по загруженным документам.
   * Использует RAG цепочку для поиска релевантного контекста и генерации ответа.
   *
   * @param dto - DTO с вопросом пользователя (валидируется: строка, не пустая, макс. длина из RAG_CONSTANTS.MAX_QUESTION_LENGTH)
   * @returns Ответ с контекстом из документов
   * @throws {Error} Если RAG сервис не инициализирован или произошла ошибка при обработке
   */
  @Post('ask')
  async ask(@Body() dto: AskQuestionDto) {
    return this.ragService.ask(dto.question);
  }

  /**
   * Возвращает статус векторного хранилища.
   * Показывает количество документов в коллекции Chroma.
   *
   * @returns Статус хранилища с количеством документов
   */
  @Get('status')
  async status() {
    return this.vectorStore.getStatus();
  }
}
