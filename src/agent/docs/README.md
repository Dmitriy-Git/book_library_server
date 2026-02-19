# RAG Модуль - Документация

## Описание работы RAG согласно текущей архитектуре

RAG (Retrieval-Augmented Generation) сервис работает в два основных этапа: **загрузка документов** (Ingestion) и **обработка вопросов** (Query).

### Этап 1: Загрузка документов (Ingestion Pipeline)

Процесс начинается с HTTP запроса `POST /agent/rag/upload` с файлом (PDF или TXT):

1. **DocumentLoaderService** (`document-loader.service.ts`)
   - Принимает файл через Multer (buffer, mimetype, originalname)
   - Валидирует формат (только PDF или TXT)
   - Временно сохраняет файл на диск в системную временную директорию
   - Использует LangChain loaders:
     - `PDFLoader` из `@langchain/community/document_loaders/fs/pdf` для PDF файлов
     - `TextLoader` из `@langchain/classic/document_loaders/fs/text` для TXT файлов
   - Извлекает текст и создает массив объектов `Document` LangChain
   - Удаляет временный файл после загрузки
   - Возвращает массив документов

2. **TextSplitterService** (`text-splitter.service.ts`)
   - Принимает массив документов от DocumentLoaderService
   - Использует `RecursiveCharacterTextSplitter` из `@langchain/textsplitters`
   - Разбивает документы на чанки с параметрами:
     - `chunkSize: 1000` символов (из `RAG_CONSTANTS.CHUNK_SIZE`)
     - `chunkOverlap: 200` символов (из `RAG_CONSTANTS.CHUNK_OVERLAP`)
   - Перекрытие между чанками необходимо для сохранения контекста на границах
   - Возвращает массив чанков документов

3. **VectorStoreService** (`vector-store.service.ts`)
   - Принимает чанки документов от TextSplitterService
   - Использует `Chroma` из `@langchain/community/vectorstores/chroma`
   - Для каждого чанка создает векторное представление (embedding) через `GigaChatEmbeddings`
   - Сохраняет чанки с их эмбеддингами в Chroma векторную базу данных
   - Возвращает массив идентификаторов добавленных документов

**Результат этапа загрузки**: Документы разбиты на чанки, преобразованы в векторы и сохранены в Chroma для последующего семантического поиска.

### Этап 2: Обработка вопросов (Query Pipeline)

Процесс начинается с HTTP запроса `POST /agent/rag/ask` с вопросом пользователя:

1. **Инициализация RAG цепочки** (происходит при старте модуля в `RagService.onModuleInit()`)
   - Создается экземпляр `GigaChat` LLM с credentials из переменных окружения
   - Создается экземпляр `GigaChatEmbeddings` для генерации эмбеддингов
   - Инициализируется Chroma векторное хранилище через `VectorStoreService.initializeStore()`
   - Создается retriever через `VectorStoreService.getRetriever(k=4)` для поиска k=4 релевантных документов
   - Создается `StuffDocumentsChain` через `createStuffDocumentsChain()` с:
     - LLM: GigaChat модель
     - Prompt: шаблон с системным сообщением и шаблоном для пользователя
   - Создается финальная `RetrievalChain` через `createRetrievalChain()` объединяющая retriever и combineDocsChain

2. **Обработка вопроса** (`RagService.ask()`)
   - Принимает вопрос пользователя (валидируется через `AskQuestionDto`)
   - Вызывает `chain.invoke({ input: question })`
   - **Retrieval этап**:
     - Вопрос преобразуется в вектор через `GigaChatEmbeddings`
     - Выполняется семантический поиск в Chroma по косинусному сходству
     - Извлекаются k=4 наиболее релевантных чанка документов
   - **Generation этап**:
     - Извлеченные чанки объединяются в контекст
     - Контекст и вопрос передаются в промпт:
       ```
       Системное сообщение: "Ты — помощник, отвечающий на вопросы по загруженным документам.
       Отвечай строго на основе приведённого контекста. Если в контексте нет ответа — так и скажи."
       
       Пользовательский промпт: "Контекст из документов:\n\n{context}\n\nВопрос: {input}"
       ```
     - Промпт отправляется в GigaChat LLM
     - LLM генерирует ответ на основе контекста из документов
   - Возвращает объект с полем `answer` (текст ответа) и опциональным `context` (массив найденных документов)

**Результат этапа обработки**: Ответ на вопрос пользователя, сгенерированный LLM на основе релевантного контекста из загруженных документов.

Для реализации RAG с LangChain и GigaChat используются следующие компоненты:

### 1. Document Loaders (Загрузчики документов)

**Используемые в проекте:**
- `PDFLoader` из `@langchain/community/document_loaders/fs/pdf`
  - Загружает текст из PDF файлов
  - Используется в `DocumentLoaderService` для обработки PDF документов

- `TextLoader` из `@langchain/classic/document_loaders/fs/text`
  - Загружает текст из TXT файлов
  - Используется в `DocumentLoaderService` для обработки текстовых файлов

**Назначение:** Преобразование файлов различных форматов в объекты `Document` LangChain с метаданными.

### 2. Text Splitters (Разделители текста)

**Используемый в проекте:**
- `RecursiveCharacterTextSplitter` из `@langchain/textsplitters`
  - Разбивает документы на чанки рекурсивным способом
  - Сохраняет структуру текста (абзацы, предложения)
  - Параметры: `chunkSize: 1000`, `chunkOverlap: 200`
  - Используется в `TextSplitterService`

**Назначение:** Разделение больших документов на управляемые чанки для векторного хранилища, с перекрытием для сохранения контекста.

### 3. Embeddings (Векторные представления)

**Используемый в проекте:**
- `GigaChatEmbeddings` из `langchain-gigachat/embeddings`
  - Создает векторные представления текста через GigaChat API
  - Используется для преобразования текста в числовые векторы
  - Инициализируется в `RagService.onModuleInit()`
  - Передается в `VectorStoreService.initializeStore()`

**Назначение:** Преобразование текста (вопросов и документов) в векторные представления для семантического поиска по косинусному сходству.

### 4. Vector Store (Векторное хранилище)

**Используемый в проекте:**
- `Chroma` из `@langchain/community/vectorstores/chroma`
  - Векторная база данных для хранения документов и их эмбеддингов
  - Поддерживает семантический поиск по косинусному сходству
  - Используется в `VectorStoreService`
  - Инициализируется с `GigaChatEmbeddings` и параметрами из переменных окружения

**Назначение:** Хранение документов в векторном формате и выполнение быстрого семантического поиска релевантных документов по запросу.

### 5. Retriever (Извлекатель документов)

**Используемый в проекте:**
- `BaseRetriever` из `@langchain/core/dist/retrievers`
  - Базовый интерфейс для извлечения релевантных документов
  - Создается через `Chroma.asRetriever({ k: 4 })`
  - Используется в `RagService` для поиска релевантных чанков

**Назначение:** Извлечение k наиболее релевантных документов из векторного хранилища по запросу пользователя.

### 6. LLM (Large Language Model)

**Используемый в проекте:**
- `GigaChat` из `langchain-gigachat/chat_models`
  - Языковая модель для генерации ответов
  - Инициализируется с credentials и baseUrl из переменных окружения
  - Используется в `RagService` для генерации финального ответа

**Назначение:** Генерация ответов на вопросы пользователя на основе предоставленного контекста из документов.

### 7. Prompts (Шаблоны промптов)

**Используемые в проекте:**
- `ChatPromptTemplate` из `@langchain/core/prompts`
- `SystemMessagePromptTemplate` из `@langchain/core/prompts`
- `HumanMessagePromptTemplate` из `@langchain/core/prompts`
  - Создают структурированные промпты для LLM
  - Системное сообщение задает роль ассистента
  - Пользовательский шаблон включает контекст и вопрос
  - Используются в `RagService` для создания `ragPrompt`

**Назначение:** Формирование структурированных промптов для LLM с инструкциями и контекстом.

### 8. Chains (Цепочки обработки)

**Используемые в проекте:**

- `createStuffDocumentsChain` из `@langchain/classic/chains/combine_documents`
  - Создает цепочку для объединения документов в контекст
  - Принимает LLM и промпт
  - Объединяет все найденные документы в единый контекст
  - Используется в `RagService.onModuleInit()`

- `createRetrievalChain` из `@langchain/classic/chains/retrieval`
  - Создает полную RAG цепочку
  - Объединяет retriever (поиск документов) и combineDocsChain (генерация ответа)
  - Автоматически выполняет поиск релевантных документов и передает их в LLM
  - Используется в `RagService.onModuleInit()` для создания финальной цепочки

**Назначение:** Организация последовательности операций: поиск релевантных документов → объединение в контекст → генерация ответа LLM.

### 9. Core Types (Базовые типы)

**Используемые в проекте:**
- `Document` из `@langchain/core/documents` и `langchain`
  - Базовый тип для представления документа с текстом и метаданными
  - Используется во всех сервисах для передачи документов

- `Runnable` из `@langchain/core/runnables`
  - Базовый интерфейс для исполняемых компонентов LangChain
  - Используется для типизации RAG цепочки в `RagService`

**Назначение:** Типизация и стандартизация данных и компонентов в LangChain экосистеме.

### Зависимости пакетов

Все компоненты LangChain требуют установки следующих пакетов:

```json
{
  "@langchain/community": "^1.1.15",
  "@langchain/core": "^1.1.24",
  "@langchain/textsplitters": "^1.0.1",
  "langchain-gigachat": "^версия"
}
```

### Резюме компонентов

| Компонент | Пакет | Использование в проекте |
|-----------|-------|------------------------|
| Document Loaders | `@langchain/community`, `@langchain/classic` | `DocumentLoaderService` |
| Text Splitter | `@langchain/textsplitters` | `TextSplitterService` |
| Embeddings | `langchain-gigachat/embeddings` | `RagService`, `VectorStoreService` |
| Vector Store | `@langchain/community/vectorstores/chroma` | `VectorStoreService` |
| Retriever | `@langchain/core/dist/retrievers` | `VectorStoreService`, `RagService` |
| LLM | `langchain-gigachat/chat_models` | `RagService` |
| Prompts | `@langchain/core/prompts` | `RagService` |
| Chains | `@langchain/classic/chains` | `RagService` |
| Core Types | `@langchain/core`, `langchain` | Все сервисы |
