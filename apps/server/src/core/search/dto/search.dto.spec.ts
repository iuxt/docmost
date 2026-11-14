import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  SearchDTO,
  SearchPublicSpaceDTO,
  SearchShareDTO,
  SearchSuggestionDTO,
} from './search.dto';

describe('Search pagination validation', () => {
  it.each([-1, 0, 1.5, 101, Infinity, '25'])(
    'rejects invalid limit %s on all search surfaces',
    (limit) => {
      for (const type of [
        SearchDTO,
        SearchShareDTO,
        SearchPublicSpaceDTO,
        SearchSuggestionDTO,
      ]) {
        const dto = plainToInstance(type as new () => object, {
          query: 'hello',
          shareId: 'key',
          spaceSlug: 'docs',
          limit,
        });
        expect(
          validateSync(dto).some((error) => error.property === 'limit'),
        ).toBe(true);
      }
    },
  );
  it.each([-1, 1.5, 10001, Infinity, '0'])(
    'rejects invalid offset %s',
    (offset) => {
      expect(
        validateSync(
          plainToInstance(SearchDTO, { query: 'hello', offset }),
        ).some((error) => error.property === 'offset'),
      ).toBe(true);
    },
  );
  it.each([{ limit: 1, offset: 0 }, { limit: 100, offset: 10000 }, {}])(
    'accepts bounded pagination %j',
    (pagination) => {
      expect(
        validateSync(
          plainToInstance(SearchDTO, { query: 'hello', ...pagination }),
        ),
      ).toEqual([]);
    },
  );
});
