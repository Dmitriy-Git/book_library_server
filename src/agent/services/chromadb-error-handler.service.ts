import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

export class ChromaDBException extends HttpException {
  constructor(message: string, cause?: Error) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Векторное хранилище временно недоступно. Попробуйте позже.',
        error: 'Service Unavailable',
        details: message,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    
    this.name = 'ChromaDBException';

    if (cause) {
      this.cause = cause;
    }
  }
}

@Injectable()
export class ChromaDBErrorHandler {
  private readonly logger = new Logger(ChromaDBErrorHandler.name);

  /**
   * Проверяет, является ли ошибка связанной с ChromaDB (недоступность).
   */
  private isChromaConnectionError(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }

    const error = err as Error;
    const msg = error.message ?? '';
    const name = error.name ?? '';

    return (
      name === 'ChromaConnectionError' ||
      msg.includes('Failed to connect to chromadb')
    );
  }

  /**
   * Обрабатывает ошибку: если это ошибка ChromaDB, выбрасывает ChromaDBException,
   * иначе пробрасывает исходную ошибку.
   *
   * @param err - Ошибка для обработки
   * @param context - Контекст операции (например, "addDocuments", "getRetriever")
   * @throws {ChromaDBException} Если это ошибка ChromaDB
   * @throws {Error} Исходная ошибка, если это не ошибка ChromaDB
   */
  handleError(err: unknown, context?: string): never {
    if (this.isChromaConnectionError(err)) {
      const error = err as Error;
      const message = context
        ? `Не удалось выполнить операцию "${context}": ${error.message}`
        : error.message;

      this.logger.error(
        `ChromaDB error in ${context || 'operation'}: ${error.message}`,
        error.stack,
      );

      throw new ChromaDBException(message, error);
    }

    // Остальные ошибки пробрасываем как есть
    throw err;
  }

  /**
   * Проверяет, является ли ошибка связанной с ChromaDB.
   * Используется для условной логики (например, fallback в RagService).
   *
   * @param err - Ошибка для проверки
   * @returns true если это ошибка ChromaDB
   */
  isChromaError(err: unknown): boolean {
    return this.isChromaConnectionError(err) || err instanceof ChromaDBException;
  }
}
