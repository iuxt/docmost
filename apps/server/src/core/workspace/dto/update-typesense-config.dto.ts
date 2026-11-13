import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { IsISO6391 } from '../../../common/validators/is-iso6391';

export class UpdateTypesenseConfigDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsISO6391()
  locale: string;
}
