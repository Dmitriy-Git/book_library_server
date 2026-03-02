import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>('S3_REGION') ?? 'ru-central1';
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_KEY');

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 configuration is incomplete. Please check S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY environment variables.');
    }

    this.s3Client = new S3Client({
      endpoint: endpoint,
      region: region.trim(),
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });

    this.bucket = this.configService.get<string>('S3_BUCKET') ?? '';
  }

  /**
   * Загружает файл в S3 хранилище
   * @param key - Ключ объекта (путь в бакете, например 'books/test.txt')
   * @param buffer - Буфер с данными файла
   * @param contentType - MIME-тип файла (опционально)
   * @returns Ключ загруженного объекта
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType?: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);
      this.logger.log(`File uploaded successfully: ${key}`);
      return key;
    } catch (error: any) {
      this.logger.error(`Failed to upload file ${key}: ${error.message}`, error.stack);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Получает файл из S3 как поток (stream)
   * Полезно для больших файлов или передачи напрямую в HTTP response
   * @param key - Ключ объекта
   * @returns Объект с потоком и метаданными
   */
  async getFileStream(key: string): Promise<{
    stream: Readable;
    contentType?: string;
    contentLength?: number;
  }> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error(`File not found: ${key}`);
      }

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      };
    } catch (error) {
      this.logger.error(`Failed to get file stream ${key}: ${error.message}`, error.stack);
      throw new Error(`Failed to get file stream: ${error.message}`);
    }
  }

  /**
   * Удаляет файл из S3 хранилища
   * @param key - Ключ объекта
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file ${key}: ${error.message}`, error.stack);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }
}
