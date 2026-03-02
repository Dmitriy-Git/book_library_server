import { IsString, IsNotEmpty } from 'class-validator';

export class StorageKeyQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Key parameter is required' })
  key: string;
}
