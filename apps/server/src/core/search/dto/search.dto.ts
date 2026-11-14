import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_LIMIT_MAX = 100;
export const SEARCH_OFFSET_MAX = 10000;

export class SearchDTO {
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query?: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsString()
  shareId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  labelIds?: string[];

  @IsOptional()
  @IsBoolean()
  titleOnly?: boolean;

  // searches without a spaceId leave archived spaces out unless this is set
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SEARCH_LIMIT_MAX)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SEARCH_OFFSET_MAX)
  offset?: number;
}

export class SearchShareDTO extends SearchDTO {
  @IsNotEmpty()
  @IsString()
  shareId: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;
}

export class SearchPublicSpaceDTO extends SearchDTO {
  @IsNotEmpty()
  @IsString()
  spaceSlug: string;
}

export class SearchSuggestionDTO {
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query: string;

  @IsOptional()
  @IsBoolean()
  includeUsers?: boolean;

  @IsOptional()
  @IsBoolean()
  includeGroups?: boolean;

  @IsOptional()
  @IsBoolean()
  includePages?: boolean;

  @IsOptional()
  @IsString()
  spaceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SEARCH_LIMIT_MAX)
  limit?: number;
}
