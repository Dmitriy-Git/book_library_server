import {
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Body,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { S3StorageService } from './s3-storage.service';
import { StorageKeyQueryDto } from './dto/storage-key-query.dto';
import { UploadFileDto } from './dto/upload-file.dto';

// Тип для загруженного файла (совместим с multer)
type UploadedFileType = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
};

@Controller('storage')
export class StorageController {
  constructor(private readonly s3Storage: S3StorageService) {}

  /**
   * POST /storage/upload
   * Загружает файл в S3
   * Body: multipart/form-data с полем 'file' и опциональным полем 'key'
   * (если key не указан - используется имя файла)
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() body: UploadFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileKey = body.key || `test/${file.originalname}`;

    await this.s3Storage.uploadFile(
      fileKey,
      file.buffer,
      file.mimetype,
    );

    return {
      success: true,
      key: fileKey,
      size: file.size,
      contentType: file.mimetype,
    };
  }

  /**
   * GET /storage/file?key=books/test.txt
   * Скачивает файл из S3
   * Query параметр key должен быть URL-encoded
   */
  @Get('file')
  async getFile(@Query() query: StorageKeyQueryDto, @Res() res: Response) {
    try {
      const { stream, contentType, contentLength } = await this.s3Storage.getFileStream(query.key);
      
      if (contentType) {
        // Для текстовых файлов добавляем charset=utf-8 для корректного отображения кириллицы
        let finalContentType = contentType;

        if (contentType.startsWith('text/')) {
          if (!contentType.includes('charset=')) {
            finalContentType = `${contentType}; charset=utf-8`;
          }
        }
        res.setHeader('Content-Type', finalContentType);
      }
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      
      stream.pipe(res);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  /**
   * DELETE /storage/file?key=books/test.txt
   * Удаляет файл из S3
   * Query параметр key должен быть URL-encoded
   */
  @Delete('file')
  async deleteFile(@Query() query: StorageKeyQueryDto) {
    await this.s3Storage.deleteFile(query.key);
    return { success: true, message: `File ${query.key} deleted` };
  }
}
