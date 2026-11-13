import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { JwtType } from '../dto/jwt-payload';

describe('Session-bound collaboration tokens', () => {
  const jwt = new JwtService({ secret: 'test-only-secret' });
  const tokens = new TokenService(jwt, {
    getAppSecret: () => 'test-only-secret',
  } as any);
  const user = { id: 'user', workspaceId: 'workspace' } as any;

  it('signs the interactive session into the token', async () => {
    const token = await tokens.generateCollabToken(
      user,
      'workspace',
      'session',
    );
    const payload = await tokens.verifyJwt(token, JwtType.COLLAB);
    expect(payload).toMatchObject({
      sub: 'user',
      workspaceId: 'workspace',
      sessionId: 'session',
      type: JwtType.COLLAB,
    });
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  });

  it('refuses to issue an unrevocable token for a legacy login', async () => {
    await expect(
      tokens.generateCollabToken(user, 'workspace', undefined),
    ).rejects.toThrow('Please log in again');
  });
});
