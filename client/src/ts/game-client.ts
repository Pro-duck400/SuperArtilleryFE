// Coordinates network communication (HTTP + WebSocket)
import { Game } from './game';
import { WebSocketClient } from './network/websocket';
import { ApiClient, type CreateGameResponse, type AcceptInvitationResponse, type CreateHotSeatResponse, type GameStatusResponse } from './network/api';
import type {
  BattlefieldConfig,
  GameMessage,
  GameStartMessage
} from './types/messages';
import { CONTRACT_VERSION } from './contract-version';

export interface ShotEventData {
  playerId: number;
  angle: number;
  velocity: number;
  direction: 'Left' | 'Right';
}

/**
 * Game session data persisted in sessionStorage
 */
interface GameSession {
  gameId: string;
  sessionToken: string;
  playerName: string;
  hotSeat?: boolean;
  players?: [{ playerId: 0; playerName: string; sessionToken: string }, { playerId: 1; playerName: string; sessionToken: string }];
}

export class GameClient {
  private game: Game;
  private apiClient: ApiClient;
  private wsClient: WebSocketClient | null = null;
  private wsBaseUrl: string;
  private lastGameStartMessage: GameStartMessage | null = null;
  private gameSession: GameSession | null = null;
  private pendingConnectResolve: (() => void) | null = null;
  private pendingConnectReject: ((error: Error) => void) | null = null;
  private onShotCallback: ((data: ShotEventData) => void) | null = null;
  private onTurnChangeCallback: ((playerId: number, isMyTurn: boolean) => void) | null = null;
  private onGameStartCallback: ((gameId: string, battlefield: BattlefieldConfig) => void) | null = null;
  private onGameOverCallback: ((winnerId: number, didIWin: boolean) => void) | null = null;
  private onPlayerHitCallback: ((playerId: number, playerName: string) => void) | null = null;
  private onRematchStatusCallback: ((playersAnswered: number, requiredPlayers: number, players: Array<{ playerId: number; playerName: string; answer?: 'play_again' | 'had_enough' | 'not_sure' }>) => void) | null = null;
  private onLobbyStatusCallback: ((status: GameStatusResponse) => void) | null = null;

  constructor(apiBaseUrl: string, wsBaseUrl: string, game: Game) {
    this.game = game;
    this.apiClient = new ApiClient(apiBaseUrl);
    this.wsBaseUrl = wsBaseUrl;

    // Try to restore session from storage
    this.restoreSession();
  }

  /**
   * Create a new private game
   */
  public async createGame(playerName: string, playerCount: number = 2): Promise<CreateGameResponse> {
    try {
      // Wake server with health check
      await this.apiClient.healthCheckWithRetry();
    } catch (error) {
      console.error('Server health check failed:', error);
      throw new Error(
        'Server is not responding. Please check your connection and try again.'
      );
    }

    // Create the game
    const response = playerCount === 2
      ? await this.apiClient.createGame(playerName, window.location.href)
      : await this.apiClient.createGame(playerName, window.location.href, playerCount);
    
    // Store session
    this.gameSession = {
      gameId: response.gameId,
      sessionToken: response.playerToken,
      playerName
    };
    this.saveSession();

    // Set up game state
    this.game.setGameId(response.gameId);
    this.game.setPlayer(0, playerName); // Initiator is always player 0

    console.log(`✅ Game created: ${response.gameId}`);
    return response;
  }

  /**
  * Accept an invitation via invite code
   */
  public async acceptInvitation(
    inviteCode: string,
    playerName: string
  ): Promise<AcceptInvitationResponse> {
    try {
      // Wake server with health check
      await this.apiClient.healthCheckWithRetry();
    } catch (error) {
      console.error('Server health check failed:', error);
      throw new Error(
        'Server is not responding. Please check your connection and try again.'
      );
    }

    // Accept the invitation
    const response = await this.apiClient.acceptInvitation(inviteCode, playerName);

    // Store session
    this.gameSession = {
      gameId: response.gameId,
      sessionToken: response.playerToken,
      playerName
    };
    this.saveSession();

    // Set up game state
    this.game.setGameId(response.gameId);
    this.game.setPlayer(response.playerId, playerName);

    console.log(`✅ Invitation accepted: ${response.gameId}`);
    return response;
  }

  public async createHotSeatGame(firstPlayerName: string, secondPlayerName: string): Promise<CreateHotSeatResponse> {
    await this.apiClient.healthCheckWithRetry();
    const response = await this.apiClient.createHotSeatGame(firstPlayerName, secondPlayerName);
    this.gameSession = {
      gameId: response.gameId,
      sessionToken: response.players[0].playerToken,
      playerName: response.players[0].name,
      hotSeat: true,
      players: [
        { playerId: 0, playerName: response.players[0].name, sessionToken: response.players[0].playerToken },
        { playerId: 1, playerName: response.players[1].name, sessionToken: response.players[1].playerToken }
      ]
    };
    this.saveSession();
    this.game.setGameId(response.gameId);
    this.game.setPlayer(0, response.players[0].name);
    this.game.setOpponentName(response.players[1].name);
    this.game.setHotSeat(true);
    return response;
  }

  /**
   * Connect to a game and wait for the WebSocket roster/start updates
   */
  public async connectToGame(): Promise<void> {
    if (!this.gameSession) {
      throw new Error('No game session found');
    }

    // Connect WebSocket with gameId and sessionToken first - the server only counts
    // a player as "connected" once its socket is open, so waiting on status beforehand
    // would deadlock (both clients waiting for a count that never increments).
    const wsUrl = `${this.wsBaseUrl}?gameId=${encodeURIComponent(
      this.gameSession.gameId
    )}&sessionToken=${encodeURIComponent(this.gameSession.sessionToken)}&contractVersion=${encodeURIComponent(CONTRACT_VERSION)}`;

    this.wsClient = new WebSocketClient(wsUrl);
    this.wsClient.onMessage((message) => this.handleMessage(message));
    let rejectProtocolError: ((error: Error) => void) | null = null;
    const protocolError = new Promise<never>((_, reject) => {
      rejectProtocolError = reject;
    });
    this.wsClient.onError((error) => {
      rejectProtocolError?.(new Error(error.message));
    });

    try {
      await this.wsClient.connect();
    } catch (error) {
      throw new Error(
        `Failed to connect to game: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Now wait until the server pushes a game_start (roster updates arrive via lobby_status)
    await Promise.race([this.waitForGameStart(), protocolError]);
  }

  /**
   * Wait for the server to push game_start over the already-open WebSocket. The server
   * broadcasts a lobby_status message on every roster change while pending, so the client
   * no longer needs to poll GET /games/{gameId}/status - it only fetches one snapshot up
   * front to render the lobby immediately, in case it joins after other players are ready.
   */
  private async waitForGameStart(): Promise<void> {
    if (!this.gameSession) {
      throw new Error('No game session found');
    }

    try {
      const status = await this.apiClient.getGameStatus(
        this.gameSession.gameId,
        this.gameSession.sessionToken
      );
      this.onLobbyStatusCallback?.(status);

      if (status.status === 'expired') {
        throw new Error('Game expired. The server may have restarted.');
      }
      if (status.playersConnected === status.required) {
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Game expired')) throw error;
      console.error('Initial lobby status fetch failed:', error);
    }

    const maxWaitTime = 5 * 60 * 1000; // 5 minutes

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        this.pendingConnectResolve = null;
        this.pendingConnectReject = null;
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('Game connection timeout'));
      }, maxWaitTime);

      this.pendingConnectResolve = () => {
        cleanup();
        resolve();
      };
      this.pendingConnectReject = (error: Error) => {
        cleanup();
        reject(error);
      };
    });
  }

  /**
   * Fire a shot
   */
  public async fire(angle: number, velocity: number, direction?: 'Left' | 'Right'): Promise<void> {
    if (!this.gameSession) {
      throw new Error('No active game session');
    }

    const gameId = this.game.getGameId();
    if (!gameId || gameId !== this.gameSession.gameId) {
      throw new Error('Game ID mismatch');
    }

    const sessionToken = this.getTokenForPlayer(this.game.getState().currentTurn);
    await this.apiClient.fire(
      this.gameSession.gameId,
      sessionToken,
      angle,
      velocity,
      direction
    );
    // Server will send WebSocket messages (shot + turn_change) to update state
  }

  public async requestRematch(answer: 'play_again' | 'had_enough'): Promise<void> {
    if (!this.gameSession) {
      throw new Error('No active game session');
    }

    if (this.gameSession.hotSeat && this.gameSession.players) {
      await this.apiClient.requestRematch(this.gameSession.gameId, this.gameSession.players[0].sessionToken, answer);
      await this.apiClient.requestRematch(this.gameSession.gameId, this.gameSession.players[1].sessionToken, answer);
      return;
    }
    await this.apiClient.requestRematch(this.gameSession.gameId, this.gameSession.sessionToken, answer);
  }

  public async skipWaiting(): Promise<void> {
    if (!this.gameSession) throw new Error('No active game session');
    await this.apiClient.skipWaiting(this.gameSession.gameId, this.gameSession.sessionToken);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: GameMessage): void {
    switch (message.type) {
      case 'game_start':
        this.game.resetShotHistory();
        this.game.setPlayers(message.players);
        const localPlayerId = this.game.getPlayerId();
        const opponent = message.players.find(player => player.playerId !== localPlayerId);
        this.game.setOpponentName(opponent?.name ?? 'Opponent');
        const gameId = message.gameId;
        this.game.setGameId(gameId);
        this.game.setBattlefield(message.battlefield);
        this.lastGameStartMessage = message;
        if (this.onGameStartCallback) {
          this.onGameStartCallback(gameId, message.battlefield);
        }
        this.pendingConnectResolve?.();
        break;

      case 'shot':
        if (this.game.isHotSeat() || message.playerId === this.game.getPlayerId()) {
          this.game.addShotToHistory(message.angle, message.velocity, this.game.isHotSeat() ? message.playerId : undefined, message.direction);
        }
        if (this.onShotCallback) {
          this.onShotCallback({
            playerId: message.playerId,
            angle: message.angle,
            velocity: message.velocity,
            direction: message.direction
          });
        }
        break;

      case 'turn_change':
        const previousPlayers = this.game.getPlayers();
        const previousById = new Map(previousPlayers.map(player => [player.playerId, player]));
        this.game.setPlayers(message.players);
        message.players
          .filter(player => !player.active && previousById.get(player.playerId)?.active)
          .forEach(player => this.onPlayerHitCallback?.(player.playerId, player.name));
        this.game.setCurrentTurn(message.turnId);
        const state = this.game.getState();
        if (this.onTurnChangeCallback) {
          this.onTurnChangeCallback(message.turnId, state.isMyTurn);
        }
        console.log(`Turn changed to Player ${message.turnId}`);
        break;

      case 'game_over':
        const previousGameOverPlayers = this.game.getPlayers();
        const previousGameOverById = new Map(previousGameOverPlayers.map(player => [player.playerId, player]));
        this.game.setPlayers(message.players);
        message.players
          .filter(player => !player.active && previousGameOverById.get(player.playerId)?.active)
          .forEach(player => this.onPlayerHitCallback?.(player.playerId, player.name));
        const gameOverState = this.game.getState();
        const myPlayerId = gameOverState.playerId;
        const didIWin = this.game.isHotSeat()
          ? true
          : myPlayerId !== null && myPlayerId === message.winnerId;
        if (this.onGameOverCallback) {
          this.onGameOverCallback(message.winnerId, didIWin);
        }
        break;

      case 'rematch_status':
        if (this.onRematchStatusCallback) {
          const legacyStatus = message as typeof message & { playersReady?: number };
          const playersAnswered = message.playersAnswered ?? legacyStatus.playersReady ?? 0;
          const players = (message.players ?? []).map(player => ({ playerId: player.playerId, playerName: player.name, answer: player.answer }));
          this.onRematchStatusCallback.length <= 1
            ? (this.onRematchStatusCallback as unknown as (playersAnswered: number) => void)(playersAnswered)
            : this.onRematchStatusCallback(playersAnswered, message.required, players);
        }
        break;

      case 'lobby_status':
        this.onLobbyStatusCallback?.({
          status: message.status,
          playersConnected: message.playersConnected,
          required: message.required,
          slots: message.slots,
          ready: false,
          readyCount: 0,
          canSkipWaiting: this.game.getPlayerId() === 0 && message.status === 'pending' && message.playersConnected >= 2
        });
        if (message.status === 'expired') {
          this.pendingConnectReject?.(new Error('Game expired. The server may have restarted.'));
        }
        break;
    }
  }

  /**
   * Event callback registrations
   */
  public onGameStart(
    callback: (gameId: string, battlefield: BattlefieldConfig) => void
  ): void {
    this.onGameStartCallback = callback;
  }

  public onShot(callback: (data: ShotEventData) => void): void {
    this.onShotCallback = callback;
  }

  public onTurnChange(callback: (playerId: number, isMyTurn: boolean) => void): void {
    this.onTurnChangeCallback = callback;
  }

  public onGameOver(callback: (winnerId: number, didIWin: boolean) => void): void {
    this.onGameOverCallback = callback;
  }

  public onPlayerHit(callback: (playerId: number, playerName: string) => void): void {
    this.onPlayerHitCallback = callback;
  }

  public onRematchStatus(callback: (playersAnswered: number, requiredPlayers: number, players: Array<{ playerId: number; playerName: string; answer?: 'play_again' | 'had_enough' | 'not_sure' }>) => void): void {
    this.onRematchStatusCallback = callback;
  }

  public onLobbyStatus(callback: (status: GameStatusResponse) => void): void {
    this.onLobbyStatusCallback = callback;
  }

  /**
   * Get current player ID
   */
  public getPlayerId(): number | null {
    return this.game.getPlayerId();
  }

  public isHotSeat(): boolean {
    return this.game.isHotSeat();
  }

  public getLocalPlayerNames(): [string, string] | null {
    if (!this.gameSession?.players) return null;
    return [this.gameSession.players[0].playerName, this.gameSession.players[1].playerName];
  }

  private getTokenForPlayer(playerId: number): string {
    if (this.gameSession?.hotSeat && this.gameSession.players) {
      const player = this.gameSession.players[playerId as 0 | 1];
      return player?.sessionToken ?? '';
    }
    return this.gameSession?.sessionToken ?? '';
  }

  public getLastGameStartMessage(): GameStartMessage | null {
    return this.lastGameStartMessage;
  }

  /**
   * Session storage management
   */
  private saveSession(): void {
    if (this.gameSession) {
      sessionStorage.setItem('gameSession', JSON.stringify(this.gameSession));
    }
  }

  private restoreSession(): void {
    const stored = sessionStorage.getItem('gameSession');
    if (stored) {
      try {
        this.gameSession = JSON.parse(stored) as GameSession;
        console.log(`Restored game session: ${this.gameSession.gameId}`);
      } catch (error) {
        console.error('Failed to restore session:', error);
        sessionStorage.removeItem('gameSession');
      }
    }
  }

  public clearSession(): void {
    this.gameSession = null;
    sessionStorage.removeItem('gameSession');
  }

  public hasActiveSession(): boolean {
    return this.gameSession !== null;
  }

  public getGameSession(): GameSession | null {
    return this.gameSession;
  }
}
