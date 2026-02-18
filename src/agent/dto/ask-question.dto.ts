import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { RAG_CONSTANTS } from '../constants';

export class AskQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(RAG_CONSTANTS.MAX_QUESTION_LENGTH)
  question: string;
}
