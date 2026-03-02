# RAG Модуль - Документация

## Архитектура по этапам пайплайна

RAG модуль разделён на три этапа пайплайна:

- **Этап 1 — Сбор и подготовка данных:** загрузка документов и разбиение на чанки (`services/stage-data-preparation/`).
- **Этап 2 — Эмбеддинги и векторная БД:** создание эмбеддингов и сохранение в Chroma (`services/stage-embedding-store/`).
- **Этап 3 — Генерация:** запрос к векторному датасету и генерация ответа LLM (`services/stage-generation/`).

---

## Поток загрузки документов (Этап 1 → Этап 2)

Процесс начинается с HTTP запроса `POST /agent/rag/upload` с файлом (PDF или TXT):

### Этап 1: Сбор и подготовка данных

1. **DocumentLoaderService** (`services/stage-data-preparation/document-loader.service.ts`)
   - Принимает файл через Multer (buffer, mimetype, originalname)
   - Валидирует формат (только PDF или TXT)
   - Временно сохраняет файл на диск в системную временную директорию
   - Использует LangChain loaders:
     - `PDFLoader` из `@langchain/community/document_loaders/fs/pdf` для PDF файлов
     - `TextLoader` из `@langchain/classic/document_loaders/fs/text` для TXT файлов
   - Извлекает текст и создает массив объектов `Document` LangChain
   - Удаляет временный файл после загрузки
   - Возвращает массив документов

2. **TextSplitterService** (`services/stage-data-preparation/text-splitter.service.ts`)
   - Принимает массив документов от DocumentLoaderService
   - Использует `RecursiveCharacterTextSplitter` из `@langchain/textsplitters`
   - Разбивает документы на чанки с параметрами:
     - `chunkSize: 1000` символов (из `RAG_CONSTANTS.CHUNK_SIZE`)
     - `chunkOverlap: 200` символов (из `RAG_CONSTANTS.CHUNK_OVERLAP`)
   - Перекрытие между чанками необходимо для сохранения контекста на границах
   - Возвращает массив чанков документов

### Этап 2: Эмбеддинги и векторная БД

3. **VectorStoreService** (`services/stage-embedding-store/vector-store.service.ts`)
   - При старте модуля (`onModuleInit`) создаёт `GigaChatEmbeddings` и инициализирует Chroma (параметры из переменных окружения: GIGACHAT_*, CHROMA_*).
   - Принимает чанки документов от контроллера (после этапа 1).
   - В `addDocuments()` для каждого чанка создаёт векторное представление через внутренний `GigaChatEmbeddings` и сохраняет в Chroma.
   - Возвращает массив идентификаторов добавленных документов.

**Результат загрузки:** Документы разбиты на чанки, преобразованы в векторы и сохранены в Chroma для последующего семантического поиска.

---

## Поток обработки вопросов (Этап 3)

Процесс начинается с HTTP запроса `POST /agent/rag/ask` с вопросом пользователя.

### Инициализация (при старте модуля)

- **VectorStoreService** уже инициализирован в `onModuleInit()` (этап 2); создаёт и хранит GigaChatEmbeddings и Chroma.
- **RagService** (`services/stage-generation/rag.service.ts`) в `onModuleInit()`:
  - Создаёт экземпляр `GigaChat` LLM с credentials из переменных окружения.
  - Получает retriever через `VectorStoreService.getRetriever(k=4)` (поиск k=4 релевантных документов).
  - Создаёт `StuffDocumentsChain` через `createStuffDocumentsChain()` с LLM и промптом.
  - Создаёт финальную `RetrievalChain` через `createRetrievalChain()` (retriever + combineDocsChain).

Эмбеддинги для запросов создаются внутри VectorStoreService/Chroma при вызове retriever; RagService эмбеддинги не создаёт.

### Обработка вопроса (`RagService.ask()`)

- Принимает вопрос пользователя (валидируется через `AskQuestionDto`).
- Вызывает `chain.invoke({ input: question })`.
- **Retrieval этап:**
  - Вопрос преобразуется в вектор (внутри retriever используется тот же GigaChatEmbeddings, что и в VectorStoreService).
  - Семантический поиск в Chroma по косинусному сходству.
  - Извлекаются k=4 наиболее релевантных чанка документов.
- **Generation этап:**
  - Извлеченные чанки объединяются в контекст.
  - Контекст и вопрос передаются в промпт и отправляются в GigaChat LLM.
  - LLM генерирует ответ на основе контекста из документов.
- Возвращает объект с полем `answer` (текст ответа) и опциональным `context` (массив найденных документов).
- При пустом хранилище или ошибке Chroma выполняется fallback на режим «общего ассистента» (ответ без контекста документов).

**Результат:** Ответ на вопрос пользователя, сгенерированный LLM на основе релевантного контекста из загруженных документов.

---

## Компоненты LangChain в проекте

### 1. Document Loaders (Загрузчики документов)

- `PDFLoader` из `@langchain/community/document_loaders/fs/pdf` — загрузка текста из PDF.
- `TextLoader` из `@langchain/classic/document_loaders/fs/text` — загрузка TXT файлов.
- Используются в **DocumentLoaderService** (`services/stage-data-preparation/document-loader.service.ts`).

### 2. Text Splitters (Разделители текста)

- `RecursiveCharacterTextSplitter` из `@langchain/textsplitters` — разбиение на чанки (chunkSize: 1000, chunkOverlap: 200).
- Используется в **TextSplitterService** (`services/stage-data-preparation/text-splitter.service.ts`).

### 3. Embeddings (Векторные представления)

- `GigaChatEmbeddings` из `langchain-gigachat/embeddings`.
- Создаётся и хранится в **VectorStoreService** в `onModuleInit()`; используется для индексации документов и для поиска по запросу (внутри retriever).
- **RagService** эмбеддинги не создаёт и не хранит.

### 4. Vector Store (Векторное хранилище)

- `Chroma` из `@langchain/community/vectorstores/chroma`.
- Инициализируется в **VectorStoreService** в `onModuleInit()` вместе с GigaChatEmbeddings и параметрами CHROMA_DB_PATH, CHROMA_COLLECTION_NAME.

### 5. Retriever (Извлекатель документов)

- `BaseRetriever` из `@langchain/core/dist/retrievers`; создаётся через `Chroma.asRetriever({ k: 4 })`.
- Предоставляется **VectorStoreService.getRetriever()**, используется в **RagService** для этапа 3.

### 6. LLM (Large Language Model)

- `GigaChat` из `langchain-gigachat/chat_models`.
- Создаётся в **RagService** в `onModuleInit()`; используется для генерации ответа по контексту и вопросу.

### 7. Prompts и Chains

- Промпты и цепочки (`ChatPromptTemplate`, `createStuffDocumentsChain`, `createRetrievalChain`) настраиваются в **RagService**.

### Резюме компонентов

| Компонент      | Пакет / класс           | Сервис (путь) |
|----------------|-------------------------|----------------------------------------|
| Document Loaders | `@langchain/community`, `@langchain/classic` | DocumentLoaderService (`stage-data-preparation/`) |
| Text Splitter  | `@langchain/textsplitters` | TextSplitterService (`stage-data-preparation/`) |
| Embeddings     | `langchain-gigachat/embeddings` | VectorStoreService (`stage-embedding-store/`) |
| Vector Store   | `@langchain/community/vectorstores/chroma` | VectorStoreService (`stage-embedding-store/`) |
| Retriever      | `@langchain/core/dist/retrievers` | VectorStoreService, RagService (`stage-generation/`) |
| LLM            | `langchain-gigachat/chat_models` | RagService (`stage-generation/`) |
| Prompts, Chains | `@langchain/core/prompts`, `@langchain/classic/chains` | RagService (`stage-generation/`) |

### Зависимости пакетов

```json
{
  "@langchain/community": "^1.1.15",
  "@langchain/core": "^1.1.24",
  "@langchain/textsplitters": "^1.0.1",
  "langchain-gigachat": "^версия"
}
```
