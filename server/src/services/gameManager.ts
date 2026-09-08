import { WebSocket } from 'ws';
import type {
  GameStartMessage,
  TurnChangeMessage,
  GameOverMessage,
  ShotMessage,
  GameMessage,
  RematchStatusMessage
} from '../types/messages';
import type {
  PrivateGame,
  CreateGameResponse,
  AcceptInvitationResponse,
  CreateHotSeatResponse,
  GameStatusResponse,
  LobbySlotStatus
} from '../types/private-game';
import { TokenService } from './tokenService';
import { InMemoryGameRepository, type GameRepository } from './gameRepository';
import {
  GameCleanupService,
  SystemTimerScheduler,
  type TimerScheduler
} from './gameCleanupService';
import { GAME_CONFIG } from './gameConfig';
import { GAME_ERROR_CODES, GAME_ERROR_MESSAGES } from './gameErrors';
import { InvitationService } from './invitationService';
import { GameRules } from './gameRules';
import { HTTP_STATUS } from '../httpStatus';
import { getDefaultShotDirection } from '../utils/shotResolver';

// Fallback used only when a request has no Origin/Referer header (e.g. direct API calls/tests)
const DEFAULT_CLIENT_ORIGIN = process.env.CLIENT_URL || 'http://localhost:5173';
const DEFAULT_SERVER_ORIGIN = process.env.SERVER_URL || 'http://localhost:3000';


/**
 * Multi-game manager supporting private, in-memory only games
 * 
 * Architecture:
 * - Map<gameId, PrivateGame> for multi-game support
 * - Session tokens for WebSocket authentication
 * - Token hashes stored in memory (never plain tokens)
 * - Automatic expiration of old games and invitations
 * - Activity-based TTL for active games
 */
export class GameManager {
  static readonly HTTP_STATUS = HTTP_STATUS;

  static readonly ERROR_CODES = GAME_ERROR_CODES;
  static readonly ERROR_MESSAGES = GAME_ERROR_MESSAGES;

  private readonly games: GameRepository;
  private readonly invitationService: InvitationService;
  private readonly cleanupService: GameCleanupService;
  private readonly gameRules: GameRules;
  private readonly timerScheduler: TimerScheduler;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Configuration
  constructor(
    games: GameRepository = new InMemoryGameRepository(),
    timerScheduler: TimerScheduler = new SystemTimerScheduler()
  ) {
    this.games = games;
    this.timerScheduler = timerScheduler;
    this.invitationService = new InvitationService(games, DEFAULT_CLIENT_ORIGIN);
    this.cleanupService = new GameCleanupService(games);
    this.gameRules = new GameRules();
    this.startCleanupTimer();
  }

  /**
   * Start periodic cleanup of expired games and invitations
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = this.timerScheduler.setInterval(() => {
      this.cleanupService.cleanup();
    }, GAME_CONFIG.cleanupIntervalMs);
  }

  /**
   * Stop cleanup timer (for graceful shutdown)
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      this.timerScheduler.clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a new private game
   * @param playerName The initiator's display name
  * @returns Game creation response with an invite code
   */
  public createGame(playerName: string, clientOrigin: string = DEFAULT_CLIENT_ORIGIN, serverOrigin: string = DEFAULT_SERVER_ORIGIN, playerCount: number = 2): CreateGameResponse | { error: string; code: string } {
    const normalizedName = TokenService.normalizeName(playerName);
    if (!normalizedName) {
      return {
        error: GameManager.ERROR_MESSAGES.INVALID_PLAYER_NAME,
        code: GameManager.ERROR_CODES.INVALID_PLAYER_NAME
      };
    }

    // Check if max games reached
    if (this.games.size >= GAME_CONFIG.maxActiveGames) {
      return {
        error: GameManager.ERROR_MESSAGES.MAX_GAMES_REACHED,
        code: GameManager.ERROR_CODES.MAX_GAMES_REACHED
      };
    }

    return this.invitationService.createGame(playerName, clientOrigin, serverOrigin, Date.now(), playerCount);
  }

  /**
  * Accept an invitation via invite code
  * @param inviteCode 4-char invite code
   * @param playerName The invited player's display name
   * @returns Invitation acceptance response with game ID and session token
   */
  public acceptInvitation(
    inviteCode: string | undefined,
    playerName: string
  ): AcceptInvitationResponse | { error: string; code: string } {
    return this.invitationService.acceptInvitation(inviteCode, playerName);
  }

  public createHotSeatGame(
    firstPlayerName: string,
    secondPlayerName: string
  ): CreateHotSeatResponse | { error: string; code: string } {
    const firstName = TokenService.normalizeName(firstPlayerName);
    const secondName = TokenService.normalizeName(secondPlayerName);
    if (!firstName || !secondName) {
      return {
        error: GameManager.ERROR_MESSAGES.INVALID_PLAYER_NAME,
        code: GameManager.ERROR_CODES.INVALID_PLAYER_NAME
      };
    }

    if (this.games.size >= GAME_CONFIG.maxActiveGames) {
      return {
        error: GameManager.ERROR_MESSAGES.MAX_GAMES_REACHED,
        code: GameManager.ERROR_CODES.MAX_GAMES_REACHED
      };
    }

    const gameId = TokenService.generateGameId();
    const firstToken = TokenService.generateSessionToken();
    const secondToken = TokenService.generateSessionToken();
    const now = Date.now();
    const game: PrivateGame = {
      id: gameId,
      status: 'pending',
      createdAt: now,
      expiresAt: now + GAME_CONFIG.invitationTtlMs,
      lastActivityAt: now,
      hotSeat: true,
      playerCount: 2,
      lobbySlots: [],
      invitation: {
        inviteCode: '',
        inviteCodeHash: '',
        expiresAt: now,
        accepted: true
      },
      initiator: {
        name: firstName,
        sessionTokenHash: TokenService.hashToken(firstToken),
        websocket: null
      },
      invited: {
        name: secondName,
        sessionTokenHash: TokenService.hashToken(secondToken),
        websocket: null
      },
      currentTurn: 0,
      gameStarted: false,
      round: 1,
      rematchReady: [false, false]
    };
    game.lobbySlots = [
      { playerId: 0, session: game.initiator, status: 'waiting', active: true, eliminated: false },
      { playerId: 1, session: game.invited, status: 'waiting', active: true, eliminated: false }
    ];
    this.games.set(game);

    return {
      gameId,
      players: [
        { playerId: 0, playerName: firstName, playerToken: firstToken },
        { playerId: 1, playerName: secondName, playerToken: secondToken }
      ]
    };
  }

  /**
   * Get non-sensitive game status (for polling before WebSocket connection)
   * @param gameId The game ID
   * @param sessionToken The player's session token (for authentication)
   * @returns Game status response
   */
  public getGameStatus(
    gameId: string,
    sessionToken: string
  ): GameStatusResponse | { error: string; code: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return {
        error: GameManager.ERROR_MESSAGES.GAME_NOT_FOUND,
        code: GameManager.ERROR_CODES.GAME_NOT_FOUND
      };
    }

    // Verify session token belongs to this game
    const playerId = this.getLobbyPlayerIdFromToken(gameId, sessionToken);
    if (playerId === null) {
      return {
        error: GameManager.ERROR_MESSAGES.INVALID_SESSION_TOKEN,
        code: GameManager.ERROR_CODES.INVALID_SESSION_TOKEN
      };
    }

    const playersConnected = game.hotSeat
      ? (game.initiator.websocket?.readyState === WebSocket.OPEN ? 2 : 0)
      : game.lobbySlots.filter(slot => slot.session.websocket?.readyState === WebSocket.OPEN).length;

    return {
      status: game.status,
      playersConnected,
      requiredPlayers: this.getRequiredPlayers(game),
      rematchReady: playerId < 2 ? game.rematchReady[playerId] : false,
      rematchPlayersReady: game.rematchReady.filter(Boolean).length,
      slots: (game.lobbySlots.length ? game.lobbySlots : [game.initiator, game.invited].map((session, playerId) => ({ playerId, session, status: 'waiting' as const, active: true, eliminated: false }))).map(slot => ({
        playerId: slot.playerId,
        ...(slot.session.name ? { playerName: slot.session.name } : {}),
        status: this.getLobbySlotStatus(game, slot.playerId)
      })),
      canSkipWaiting: playerId === 0 && game.status === 'pending' && playersConnected >= 2
    };
  }

  private getLobbySlotStatus(game: PrivateGame, playerId: number): LobbySlotStatus {
    const slot = (game.lobbySlots.length ? game.lobbySlots : [game.initiator, game.invited].map((session, index) => ({ playerId: index, session, status: 'waiting' as const, active: true, eliminated: false })))[playerId];
    if (!slot) return 'skipped';
    if (slot.status === 'skipped') return 'skipped';
    return slot.session.websocket?.readyState === WebSocket.OPEN && slot.session.name
      ? 'ready'
      : 'waiting';
  }

  private getRequiredPlayers(game: PrivateGame): number {
    return game.waitingSkipped
      ? game.lobbySlots.filter(slot => slot.status !== 'skipped').length
      : game.playerCount ?? 2;
  }

  /**
   * Connect a player via WebSocket using session token
   * @param gameId The game ID
   * @param sessionToken The player's session token
   * @param ws The WebSocket connection
   * @returns Player ID (0 or 1) if successful, error otherwise
   */
  public connectPlayer(
    gameId: string,
    sessionToken: string,
    ws: WebSocket
  ): { playerId: number } | { error: string; code: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return {
        error: GameManager.ERROR_MESSAGES.GAME_NOT_FOUND,
        code: GameManager.ERROR_CODES.GAME_NOT_FOUND
      };
    }

    // Determine which player this is by validating session token
    const playerId = this.getLobbyPlayerIdFromToken(game.id, sessionToken);

    if (playerId == null) {
      return {
        error: GameManager.ERROR_MESSAGES.INVALID_SESSION_TOKEN,
        code: GameManager.ERROR_CODES.INVALID_SESSION_TOKEN
      };
    }

    // Store WebSocket connection
    const slot = game.lobbySlots[playerId];
    if (!slot) {
      return { error: GameManager.ERROR_MESSAGES.INVALID_SESSION_TOKEN, code: GameManager.ERROR_CODES.INVALID_SESSION_TOKEN };
    }
    slot.session.websocket = ws;
    slot.status = 'ready';
    if (playerId === 0) game.initiator.websocket = ws;
    if (playerId === 1) game.invited.websocket = ws;

    if (game.hotSeat && playerId < 2) {
      game.initiator.websocket = ws;
      game.invited.websocket = ws;
    }

    console.log(`✅ Player ${playerId} (${slot.session.name ?? `Player ${playerId + 1}`}) connected to game ${gameId}`);

    // Try to start game if both players are connected
    if (!game.gameStarted) {
      this.tryStartGame(game);
    }

    return { playerId };
  }

  /**
   * Get player ID from session token
   * @param gameId The game ID
   * @param sessionToken The player's session token
   * @returns Player ID (0 or 1) or null if invalid
   */
  public getPlayerIdFromToken(gameId: string, sessionToken: string): 0 | 1 | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const isInitiator = TokenService.verifyToken(sessionToken, game.initiator.sessionTokenHash);
    if (isInitiator) return 0;

    const isInvited = TokenService.verifyToken(sessionToken, game.invited.sessionTokenHash);
    if (isInvited) return 1;

    return null;
  }

  public getPlayerNameFromToken(sessionToken: string, gameId?: string): string | null {
    if (gameId) {
      const game = this.games.get(gameId);
      if (!game) return null;
      const slot = game.lobbySlots.find(candidate => TokenService.verifyToken(sessionToken, candidate.session.sessionTokenHash));
      return slot?.session.name ?? null;
    }

    for (const game of this.games.values()) {
      const slot = game.lobbySlots.find(candidate => TokenService.verifyToken(sessionToken, candidate.session.sessionTokenHash));
      if (slot?.session.name) return slot.session.name;
    }
    return null;
  }

  public getPlayerName(gameId: string, playerId: number): string | null {
    const game = this.games.get(gameId);
    return game?.lobbySlots[playerId]?.session.name ?? null;
  }

  private getLobbyPlayerIdFromToken(gameId: string, sessionToken: string): number | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const slots = game.lobbySlots.length
      ? game.lobbySlots
      : [game.initiator, game.invited].map((session, playerId) => ({ playerId, session, status: 'waiting' as const }));
    const slot = slots.find(candidate => TokenService.verifyToken(sessionToken, candidate.session.sessionTokenHash));
    return slot?.playerId ?? null;
  }

  public skipWaiting(
    gameId: string,
    sessionToken: string
  ): import('../types/private-game').SkipWaitingResponse | { error: string; code: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return { error: GameManager.ERROR_MESSAGES.GAME_NOT_FOUND, code: GameManager.ERROR_CODES.GAME_NOT_FOUND };
    }

    const playerId = this.getLobbyPlayerIdFromToken(gameId, sessionToken);
    if (playerId === null) {
      return { error: GameManager.ERROR_MESSAGES.INVALID_SESSION_TOKEN, code: GameManager.ERROR_CODES.INVALID_SESSION_TOKEN };
    }
    if (playerId !== 0) {
      return { error: GameManager.ERROR_MESSAGES.NOT_CREATOR, code: GameManager.ERROR_CODES.NOT_CREATOR };
    }
    if (game.status !== 'pending' || game.waitingSkipped) {
      return { error: GameManager.ERROR_MESSAGES.LOBBY_CLOSED, code: GameManager.ERROR_CODES.LOBBY_CLOSED };
    }

    const connectedSlots = game.lobbySlots.filter(slot =>
      slot.session.name && slot.session.websocket?.readyState === WebSocket.OPEN
    );
    if (connectedSlots.length < 2) {
      return { error: GameManager.ERROR_MESSAGES.NOT_ENOUGH_PLAYERS, code: GameManager.ERROR_CODES.NOT_ENOUGH_PLAYERS };
    }

    game.waitingSkipped = true;
    game.lobbySlots.forEach(slot => {
      if (!connectedSlots.includes(slot)) slot.status = 'skipped';
    });

    this.tryStartGame(game);

    return {
      started: game.gameStarted,
      playersConnected: connectedSlots.length,
      requiredPlayers: this.getRequiredPlayers(game),
      slots: game.lobbySlots.map(slot => ({
        playerId: slot.playerId,
        ...(slot.session.name ? { playerName: slot.session.name } : {}),
        status: slot.status
      }))
    };
  }

  /**
   * Handle player disconnect
   */
  public disconnectPlayer(gameId: string, playerId: number, ws: WebSocket): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const currentSocket = game.lobbySlots[playerId]?.session.websocket;
    if (currentSocket !== ws) return;

    if (game.hotSeat) {
      game.initiator.websocket = null;
      game.invited.websocket = null;
      if (playerId < 2) this.gameRules.disconnect(game, playerId as 0 | 1);
      return;
    }

    game.lobbySlots[playerId].session.websocket = null;
    if (game.status === 'pending') game.lobbySlots[playerId].status = 'waiting';
    if (playerId < 2) this.gameRules.disconnect(game, playerId as 0 | 1);
  }

  /**
   * Try to start a game when both players are connected
   */
  private tryStartGame(game: PrivateGame): void {
    const start = this.gameRules.startIfReady(game);
    if (!start) {
      return;
    }

    console.log(
      `🎮 Game ${game.id} started: ${game.lobbySlots.filter(slot => slot.active).map(slot => slot.session.name).join(' vs ')}`
    );

    this.broadcastGameStart(game, start.battlefield);

    // Send initial turn change
    const turnMessage: TurnChangeMessage = {
      type: 'turn_change',
      playerId_turn: game.currentTurn,
      players: this.getPlayerStates(game)
    };
    this.broadcastToGame(game, turnMessage);
  }

  private broadcastGameStart(game: PrivateGame, battlefield: NonNullable<PrivateGame['battlefield']>): void {
    const players = this.getPlayerStates(game);
    const startMessage: GameStartMessage = {
      type: 'game_start',
      gameId: game.id,
      players,
      battlefield,
      round: game.round
    };
    this.broadcastToGame(game, startMessage);
  }

  private getPlayerStates(game: PrivateGame): Array<{
    playerId: number;
    playerName: string;
    active: boolean;
    connected: boolean;
  }> {
    return game.lobbySlots.map(slot => ({
      playerId: slot.playerId,
      playerName: slot.session.name ?? `Player ${slot.playerId + 1}`,
      active: slot.active && !slot.eliminated && slot.status !== 'skipped',
      connected: slot.session.websocket?.readyState === WebSocket.OPEN
    }));
  }

  public requestRematch(
    gameId: string,
    sessionToken: string,
    answer: import('../types/private-game').RematchAnswer = 'play_again'
  ): {
    success: true;
    answer: import('../types/private-game').RematchAnswer;
    playersAnswered: number;
    playersReady: number;
    requiredPlayers: number;
    players: Array<{ playerId: number; playerName: string; answer?: import('../types/private-game').RematchAnswer }>;
    roundStarted: boolean;
  } | { success: false; error: string; code: string; statusCode: number } {
    const game = this.games.get(gameId);
    if (!game) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.GAME_NOT_FOUND,
        code: GameManager.ERROR_CODES.GAME_NOT_FOUND,
        statusCode: HTTP_STATUS.NOT_FOUND
      };
    }

    const playerId = this.getLobbyPlayerIdFromToken(gameId, sessionToken);
    if (playerId === null) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.INVALID_SESSION_TOKEN,
        code: GameManager.ERROR_CODES.INVALID_SESSION_TOKEN,
        statusCode: HTTP_STATUS.UNAUTHORIZED
      };
    }

    if (game.status !== 'finished') {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.REMATCH_NOT_AVAILABLE,
        code: GameManager.ERROR_CODES.REMATCH_NOT_AVAILABLE,
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    if (answer !== 'play_again' && answer !== 'had_enough') {
      return {
        success: false,
        error: 'Answer must be play_again or had_enough',
        code: 'INVALID_REMATCH_ANSWER',
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    const transition = this.gameRules.requestRematch(game, playerId, answer);
    const answers = transition.answers ?? game.rematchAnswers ?? [];
    const statusMessage: RematchStatusMessage = {
      type: 'rematch_status',
      playersAnswered: transition.playersAnswered,
      requiredPlayers: game.lobbySlots.length,
      players: game.lobbySlots.map(slot => ({
        playerId: slot.playerId,
        playerName: slot.session.name ?? `Player ${slot.playerId + 1}`,
        ...(answers[slot.playerId] ? { answer: answers[slot.playerId]! } : {})
      }))
    };
    this.broadcastToGame(game, statusMessage);

    if (transition.kind === 'started') {
      this.broadcastGameStart(game, transition.battlefield);
      this.broadcastToGame(game, {
        type: 'turn_change',
        playerId_turn: game.currentTurn,
        players: this.getPlayerStates(game)
      });
    }

    return {
      success: true,
      answer,
      playersAnswered: transition.playersAnswered,
      playersReady: transition.playersReady,
      requiredPlayers: game.lobbySlots.length,
      players: statusMessage.players,
      roundStarted: transition.kind === 'started'
    };
  }

  /**
   * Handle fire action (from HTTP endpoint with session token)
   * @param gameId The game ID
   * @param sessionToken The player's session token
   * @param angle Projectile angle
   * @param velocity Projectile velocity
   * @returns Success or error
   */
  public fire(
    gameId: string,
    sessionToken: string,
    angle: number,
    velocity: number,
    direction?: 'Left' | 'Right'
  ): { success: true } | { success: false; error: string; code: string; statusCode: number } {
    const game = this.games.get(gameId);
    if (!game) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.GAME_NOT_FOUND,
        code: GameManager.ERROR_CODES.GAME_NOT_FOUND,
        statusCode: HTTP_STATUS.NOT_FOUND
      };
    }

    // Derive player ID from session token
    const playerId = this.getLobbyPlayerIdFromToken(gameId, sessionToken);
    if (playerId === null) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.INVALID_SESSION_TOKEN,
        code: GameManager.ERROR_CODES.INVALID_SESSION_TOKEN,
        statusCode: HTTP_STATUS.UNAUTHORIZED
      };
    }

    if (!game.gameStarted || game.status !== 'active') {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.GAME_NOT_ACTIVE,
        code: GameManager.ERROR_CODES.GAME_NOT_ACTIVE,
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    if (playerId !== game.currentTurn) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.NOT_YOUR_TURN,
        code: GameManager.ERROR_CODES.NOT_YOUR_TURN,
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    // Validate angle
    if (typeof angle !== 'number' || !Number.isInteger(angle) || angle < 0 || angle > 99) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.INVALID_ANGLE,
        code: GameManager.ERROR_CODES.INVALID_ANGLE,
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    // Validate velocity
    if (typeof velocity !== 'number' || !Number.isInteger(velocity) || velocity < 30 || velocity > 999) {
      return {
        success: false,
        error: GameManager.ERROR_MESSAGES.INVALID_VELOCITY,
        code: GameManager.ERROR_CODES.INVALID_VELOCITY,
        statusCode: HTTP_STATUS.BAD_REQUEST
      };
    }

    const transition = this.gameRules.fire(game, playerId, angle, velocity, direction);

    // Broadcast shot
    const shotMessage: ShotMessage = {
      type: 'shot',
      playerId,
      angle,
      velocity,
      direction: direction ?? getDefaultShotDirection(game.battlefield!, playerId)
    };
    this.broadcastToGame(game, shotMessage);

    if (transition.kind === 'hit') {
      if (transition.winnerPlayerId !== undefined) {
        const gameOverMessage: GameOverMessage = {
          type: 'game_over',
          playerId_winner: transition.winnerPlayerId,
          players: this.getPlayerStates(game)
        };
        this.broadcastToGame(game, gameOverMessage);
      } else {
        this.broadcastToGame(game, {
          type: 'turn_change',
          playerId_turn: game.currentTurn,
          players: this.getPlayerStates(game)
        });
      }
      return { success: true };
    }

    // Miss - switch turns
    const turnMessage: TurnChangeMessage = {
      type: 'turn_change',
      playerId_turn: transition.nextPlayerId,
      players: this.getPlayerStates(game)
    };
    this.broadcastToGame(game, turnMessage);

    return { success: true };
  }

  /**
   * Broadcast a message to both players in a game
   */
  private broadcastToGame(game: PrivateGame, message: GameMessage): void {
    const messageStr = JSON.stringify(message);

    const sockets = new Set<WebSocket>();
    game.lobbySlots.forEach((slot) => {
      if (slot.session.websocket && slot.session.websocket.readyState === WebSocket.OPEN) {
        sockets.add(slot.session.websocket);
      }
    });
    sockets.forEach((socket) => {
      const recipientNames = game.lobbySlots
        .filter(slot => slot.session.websocket === socket)
        .map(slot => slot.session.name ?? `Player ${slot.playerId + 1}`)
        .join(', ');
      console.log(`📤 WebSocket message type=${message.type} game=${game.id} to=${recipientNames || 'unknown'} payload=${messageStr}`);
      socket.send(messageStr);
    });
  }

  /**
   * Get game statistics for health check
   */
  public getStats(): {
    gameCount: number;
    invitationCount: number;
    maxGamesReached: boolean;
  } {
    let invitationCount = 0;
    for (const game of this.games.values()) {
      if (game.status === 'pending' && !game.waitingSkipped && (!game.invitation.accepted || game.playerCount > 2)) {
        invitationCount++;
      }
    }

    return {
      gameCount: this.games.size,
      invitationCount,
      maxGamesReached: this.games.size >= GAME_CONFIG.maxActiveGames
    };
  }
}
