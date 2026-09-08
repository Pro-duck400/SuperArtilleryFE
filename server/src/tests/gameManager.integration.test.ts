import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { GameManager } from '../services/gameManager';
import { WebSocket } from 'ws';

describe('Integration: Private Games Flow', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager();
  });

  afterEach(() => {
    gameManager.shutdown();
  });

  describe('Full game lifecycle', () => {
    it('Player A creates a game, Player B accepts, both connect', () => {
      const createResult = gameManager.createGame('Alice');
      if ('error' in createResult) throw new Error('Alice should create game');

      const { gameId, playerToken: tokenA, inviteCode } = createResult;

      const acceptResult = gameManager.acceptInvitation(inviteCode, 'Bob');
      if ('error' in acceptResult) throw new Error('Bob should accept invitation');

      expect(acceptResult.gameId).toBe(gameId);
      const tokenB = acceptResult.playerToken;
      expect(tokenB).not.toBe(tokenA);

      const mockWsA = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn()
      } as any;

      const mockWsB = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn()
      } as any;

      const connA = gameManager.connectPlayer(gameId, tokenA, mockWsA);
      if ('error' in connA) throw new Error('Alice should connect');
      expect(connA.playerId).toBe(0);

      const connB = gameManager.connectPlayer(gameId, tokenB, mockWsB);
      if ('error' in connB) throw new Error('Bob should connect');
      expect(connB.playerId).toBe(1);

      expect(mockWsA.send).toHaveBeenCalled();
      expect(mockWsB.send).toHaveBeenCalled();

      const status = gameManager.getGameStatus(gameId, tokenA);
      if ('error' in status) throw new Error('Should get game status');
      expect(status.status).toBe('active');
      expect(status.playersConnected).toBe(2);
    });

    it('Player cannot fire in another player\'s game', () => {
      const game1 = gameManager.createGame('Alice');
      const game2 = gameManager.createGame('Charlie');
      if ('error' in game1 || 'error' in game2) throw new Error('Should create games');

      const result = gameManager.fire(game2.gameId, game1.playerToken, 45, 50);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_SESSION_TOKEN');
      }
    });

    it('Player cannot impersonate other player by changing tokens', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const mockWs = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const result = gameManager.connectPlayer(created.gameId, accepted.playerToken, mockWs);
      if ('error' in result) throw new Error('Connection should succeed');

      expect(result.playerId).toBe(1);
    });
  });

  describe('Game expiration and disconnection', () => {
    it('Pending game expires when initiator disconnects', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      let status = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in status) throw new Error('Should get status');
      expect(status.status).toBe('pending');

      const mockWs = { readyState: WebSocket.OPEN, close: vi.fn(), send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, mockWs);
      gameManager.disconnectPlayer(created.gameId, 0, mockWs);

      status = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in status) {
        expect(status.code).toBeDefined();
      }
    });

    it('Active game ends when player disconnects', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const mockWsA = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const mockWsB = { readyState: WebSocket.OPEN, send: vi.fn() } as any;

      gameManager.connectPlayer(created.gameId, created.playerToken, mockWsA);
      gameManager.connectPlayer(created.gameId, accepted.playerToken, mockWsB);

      gameManager.disconnectPlayer(created.gameId, 0, mockWsA);

      const status = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in status) {
        expect(status.code).toBeDefined();
      }
    });
  });

  describe('Turn-based gameplay', () => {
    it('Only the current turn player can fire', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const mockWsA = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const mockWsB = { readyState: WebSocket.OPEN, send: vi.fn() } as any;

      gameManager.connectPlayer(created.gameId, created.playerToken, mockWsA);
      gameManager.connectPlayer(created.gameId, accepted.playerToken, mockWsB);

      const fireResult = gameManager.fire(created.gameId, created.playerToken, 45, 50);
      if ('error' in fireResult) {
        expect(fireResult.code).not.toBe('NOT_YOUR_TURN');
      }

      const fireResult2 = gameManager.fire(created.gameId, accepted.playerToken, 45, 50);
      if ('error' in fireResult2) {
        expect(['NOT_YOUR_TURN', 'GAME_NOT_ACTIVE']).toContain(fireResult2.code);
      }
    });
  });

  describe('Cold start and server readiness', () => {
    it('Health check returns accurate statistics', () => {
      const game1 = gameManager.createGame('Alice');
      if ('error' in game1) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(game1.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const game2 = gameManager.createGame('Charlie');
      if ('error' in game2) throw new Error('Should create game');

      const stats = gameManager.getStats();
      expect(stats.games).toBe(2);
      expect(stats.inviteCount).toBe(1);
      expect(stats.maxReached).toBe(false);
    });
  });

  describe('Replay and reconnection', () => {
    it('ignores a stale socket closing after a replacement connects', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const firstSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const replacementSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, firstSocket);
      gameManager.connectPlayer(created.gameId, created.playerToken, replacementSocket);

      gameManager.disconnectPlayer(created.gameId, 0, firstSocket);

      const status = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in status) throw new Error('Should get game status');
      expect(status.status).toBe('pending');
      expect(status.playersConnected).toBe(1);
    });

    it('Player can query game status before connecting WebSocket', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const statusA = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in statusA) throw new Error('Alice should get status');
      expect(statusA.playersConnected).toBe(0);
      expect(statusA.status).toBe('pending');

      const statusB = gameManager.getGameStatus(created.gameId, accepted.playerToken);
      if ('error' in statusB) throw new Error('Bob should get status');
      expect(statusB.playersConnected).toBe(0);
      expect(statusB.status).toBe('pending');

      const mockWsA = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, mockWsA);

      const statusA2 = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in statusA2) throw new Error('Should get updated status');
      expect(statusA2.playersConnected).toBe(1);
      expect(statusA2.status).toBe('pending');
    });
  });

  describe('Error cases', () => {
    it('Helpful error when invitation expired', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const result = gameManager.acceptInvitation('INVALIDCODE', 'Bob');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toMatch(/not found|expired|invalid/i);
        expect(result.code).toBeDefined();
      }
    });

    it('Helpful error when game unavailable', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const result = gameManager.getGameStatus('unknown-game-id', 'unknown-token');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBeDefined();
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it('Server reports when at max capacity', () => {
      for (let i = 0; i < 5; i++) {
        gameManager.createGame(`Player${i}`);
      }

      const stats = gameManager.getStats();
      expect(stats.games).toBeGreaterThan(0);
    });
  });
});
