import { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { CollaborationGateway } from './collaboration.gateway';

function makeGateway() {
  const environmentService = {
    getRedisUrl: () => 'redis://localhost:6379',
    isCollabDisableRedis: () => true,
  };
  const gateway = new CollaborationGateway(
    {} as any,
    {} as any,
    {} as any,
    environmentService as any,
    {} as any,
  );
  const redisSync = {
    onSocketOpen: jest.fn(),
    onSocketMessage: jest.fn(),
    onSocketClose: jest.fn(),
  };
  (gateway as any).redisSync = redisSync;
  return { gateway, redisSync };
}

describe('CollaborationGateway.handleConnection', () => {
  it('passes the resolved client ip with the connection', () => {
    const { gateway, redisSync } = makeGateway();
    const request = {
      method: 'GET',
      url: '/collab',
      headers: {
        'sec-websocket-key': 'key',
        'x-forwarded-for': '162.158.1.1',
        'cf-connecting-ip': '198.51.100.20',
      },
      socket: { remoteAddress: '10.42.0.66' },
    } as unknown as IncomingMessage;

    gateway.handleConnection(
      { on: jest.fn() } as unknown as WebSocket,
      request,
    );

    expect(redisSync.onSocketOpen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ socket: { remoteAddress: '198.51.100.20' } }),
    );
  });
});

import { CollaborationHandler } from './collaboration.handler';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { tiptapExtensions } from './collaboration.util';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('CollaborationGateway without Redis sync', () => {
  it('persists server-side replace, append and prepend through local Hocuspocus', async () => {
    let stored: any;
    const gateway = new CollaborationGateway(
      {} as any,
      {
        onLoadDocument: async () =>
          stored
            ? TiptapTransformer.toYdoc(stored, 'default', tiptapExtensions)
            : undefined,
        onStoreDocument: async ({ document }: any) => {
          stored = TiptapTransformer.fromYdoc(document, 'default');
        },
      } as any,
      {} as any,
      {
        getRedisUrl: () => 'redis://localhost:6379',
        isCollabDisableRedis: () => true,
      } as any,
      new CollaborationHandler(),
    );
    try {
      for (const [operation, text] of [
        ['replace', 'middle'],
        ['append', 'last'],
        ['prepend', 'first'],
      ]) {
        await gateway.handleYjsEvent('updatePageContent', 'page.test', {
          operation,
          prosemirrorJson: doc(text),
          user: { id: 'user' } as any,
        });
      }
      expect(stored.content.map((p: any) => p.content[0].text)).toEqual([
        'first',
        'middle',
        'last',
      ]);
    } finally {
      const instance = (gateway as any).hocuspocus;
      await instance.hooks('onDestroy', { instance });
    }
  });

  it('does not open a document for an onlyIfOpen event', async () => {
    const gateway = Object.create(CollaborationGateway.prototype);
    gateway.redisSync = null;
    gateway.hocuspocus = { documents: new Map() };
    gateway.collabEventsService = { getHandlers: jest.fn() };
    expect(
      await gateway.handleYjsEvent(
        'getConnectedUserIds',
        'page.closed',
        undefined,
        true,
      ),
    ).toBeUndefined();
    expect(gateway.collabEventsService.getHandlers).not.toHaveBeenCalled();
  });
});
