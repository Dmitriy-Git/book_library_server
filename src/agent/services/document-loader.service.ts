import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { TextLoader } from '@langchain/classic/document_loaders/fs/text';
import type { Document } from 'langchain';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/** Файл, загруженный через Multer (минимальный контракт для лоадеров). */
export interface UploadedFileInput {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
}

@Injectable()
export class DocumentLoaderService {
  private readonly logger = new Logger(DocumentLoaderService.name);

  /**
   * Загружает документ из файла, загруженного через Multer.
   * Поддерживает форматы PDF и TXT. Файл временно сохраняется на диск,
   * загружается через LangChain loader и затем удаляется.
   *
   * @param file - Файл, загруженный через Multer (должен содержать buffer)
   * @returns Массив документов LangChain, извлеченных из файла
   * @throws {BadRequestException} Если файл не предоставлен, имеет неподдерживаемый формат или произошла ошибка при загрузке
   */
  async loadFromFile(file: UploadedFileInput): Promise<Document[]> {
    if (!file?.buffer) {
      throw new BadRequestException('File buffer is required');
    }

    const mimetype = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isPdf = mimetype === 'application/pdf' || ext === '.pdf';
    const isTxt = mimetype === 'text/plain' || ext === '.txt';

    if (!isPdf && !isTxt) {
      throw new BadRequestException(
        'Only PDF and TXT are allowed (mimetype or extension .pdf / .txt)',
      );
    }

    const tmpDir = os.tmpdir();
    const safeName = (file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tmpDir, `rag-upload-${Date.now()}-${safeName}`);

    try {
      await fs.writeFile(tmpPath, file.buffer);
      const loader = isPdf ? new PDFLoader(tmpPath) : new TextLoader(tmpPath);
      const docs = await loader.load();
      
      this.logger.log(`Loaded ${docs.length} document(s) from ${file.originalname}`);

      return docs;
    } catch (err) {
      this.logger.error(`Document load failed: ${(err as Error).message}`, (err as Error).stack);
      throw new BadRequestException(`Failed to load document: ${(err as Error).message}`);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }
}
