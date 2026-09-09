// Main entry point for SuperArtillery
import '../css/style.css';
import { Game } from './game';
import { Renderer } from './renderer';
import { ProjectileAnimator } from './projectile-animator';
import { UIManager } from './ui-manager';
import { GameClient } from './game-client';
import { CONTRACT_VERSION } from './contract-version';
import clientPackage from '../../package.json';
import type { HistoricalTrajectory, TrajectoryPoint } from './trajectory';
import { createHistoricalTrajectories } from './trajectory';

console.log('SuperArtillery initializing...');

const clientVersion = document.getElementById('clientVersion');
if (clientVersion) {
  clientVersion.textContent = `Client v${clientPackage.version} | Contract v${CONTRACT_VERSION}`;
}

const BUILT_IN_DEFAULT = 'http://localhost:3000';

function getDefaultServerAddress(): string {
  const envUrl = import.meta.env.VITE_SERVER_URL;
  if (envUrl) return envUrl;

  // Runtime detection: local development uses the local server; hosted clients use Railway.
  const host = window.location.hostname || '';

  if (host === 'localhost' || host.startsWith('127.') || host === '') {
    return BUILT_IN_DEFAULT;
  }

  return 'https://superartillery-server-production.up.railway.app';
}

function resolveServerBaseUrls(serverAddress: string): { apiBaseUrl: string; wsBaseUrl: string } {
  const chosen = (serverAddress && serverAddress.trim()) || getDefaultServerAddress();
  const parsedUrl = new URL(chosen);
  const apiBaseUrl = parsedUrl.origin;
  const wsProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsBaseUrl = `${wsProtocol}//${parsedUrl.host}`;
  return { apiBaseUrl, wsBaseUrl };
}

// Initialize canvas and renderer
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
if (!canvas) {
  console.error('Canvas element not found');
  throw new Error('Canvas element not found');
}

const renderer = new Renderer(canvas);
renderer.render({ projectile: null, activeTrajectory: [], historicalTrajectories: [] });
console.log('Renderer initialized');

// Create core components
const game = new Game();
const animator = new ProjectileAnimator(renderer, canvas.width);
const uiManager = new UIManager(getDefaultServerAddress());
let gameClient: GameClient | null = null;
let clientName = '';
let opponentName = '';
let hotSeatNames: [string, string] | null = null;
let historicalTrajectories: HistoricalTrajectory[] = [];
let activeTrajectory: TrajectoryPoint[] = [];
let activeShotIsLocal = false;
let animationActive = false;
let pendingVisualTurn: { playerId: 0 | 1; isMyTurn: boolean } | null = null;
let pendingGameOver: { didIWin: boolean } | null = null;
let pendingDefeatedPlayerIds: number[] = [];
let pendingHitName: string | null = null;
let pendingRipPlayerIds: number[] = [];

function refreshRosterPositions(): void {
  if (!game.getBattlefield()) return;
  uiManager.setRosterNames(
    game.getPlayers().map(player => ({ playerId: player.playerId, name: player.name, active: player.active })),
    new Map(game.getPlayers().map(player => [player.playerId, renderer.getCastleLabelPosition(player.playerId)]))
  );
}

// Browser zoom/viewport changes can change the canvas's displayed CSS size
// without re-triggering game events, so name labels must be recomputed.
window.addEventListener('resize', refreshRosterPositions);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(refreshRosterPositions).observe(canvas);
}

function schedulePendingRip(): void {
  if (pendingRipPlayerIds.length === 0) return;
  const ripPlayerIds = [...pendingRipPlayerIds];
  pendingRipPlayerIds = [];
  window.setTimeout(() => {
    renderer.setRIPPlayers(ripPlayerIds);
    renderer.render({ projectile: null, activeTrajectory, historicalTrajectories });
    uiManager.setRosterNames(
      game.getPlayers().map(player => ({ playerId: player.playerId, name: player.name, active: player.active })),
      new Map(game.getPlayers().map(player => [player.playerId, renderer.getCastleLabelPosition(player.playerId)]))
    );
  }, 1000);
}

function applyPendingPresentation(): void {
  if (animationActive) return;

  if (pendingGameOver) {
    pendingGameOver = null;
    pendingVisualTurn = null;
    if (pendingDefeatedPlayerIds.length > 0) {
      renderer.setDefeatedPlayers(pendingDefeatedPlayerIds);
      pendingDefeatedPlayerIds = [];
      renderer.render({ projectile: null, activeTrajectory, historicalTrajectories });
    }
    schedulePendingRip();
    const winnerName = game.getPlayers().find(player => player.active)?.name ?? 'Unknown player';
    uiManager.showGameOver(winnerName);
    return;
  }

  if (pendingDefeatedPlayerIds.length > 0) {
    renderer.setDefeatedPlayers(pendingDefeatedPlayerIds);
    pendingDefeatedPlayerIds = [];
    renderer.render({ projectile: null, activeTrajectory, historicalTrajectories });
  }

  if (pendingHitName && !pendingVisualTurn) {
    uiManager.setMessage(`${pendingHitName} hit`);
    pendingHitName = null;
  }

  if (pendingRipPlayerIds.length > 0) {
    schedulePendingRip();
  }

  if (pendingVisualTurn) {
    const turn = pendingVisualTurn;
    pendingVisualTurn = null;
    renderer.setActiveTurn(turn.playerId);
    renderer.render({ projectile: null, activeTrajectory, historicalTrajectories });
    const localNames = game.isHotSeat() ? hotSeatNames : null;
    const rosterPlayerName = game.getPlayers().find(player => player.playerId === turn.playerId)?.name;
    const turnPlayerName = localNames
      ? localNames[turn.playerId]
      : (rosterPlayerName ?? (turn.isMyTurn ? clientName : opponentName));
    const hitName = pendingHitName;
    uiManager.setMessage(hitName
      ? `${hitName} hit. ${turnPlayerName} turn`
      : `${turnPlayerName} turn`);
    pendingHitName = null;
  }
}

animator.onFrame(({ projectile, trajectory }) => {
  activeTrajectory = trajectory;
  renderer.render({ projectile, activeTrajectory, historicalTrajectories });
});

animator.onComplete(() => {
  const localPlayerId = gameClient?.getPlayerId();
  const battlefield = game.getBattlefield();
  if (activeShotIsLocal && localPlayerId !== null && localPlayerId !== undefined && battlefield) {
    historicalTrajectories = createHistoricalTrajectories(
      battlefield,
      game.getShotHistory(),
      localPlayerId as 0 | 1
    );
  }
  activeShotIsLocal = false;
  activeTrajectory = [];
  animationActive = false;
  renderer.render({ projectile: null, activeTrajectory, historicalTrajectories });
  applyPendingPresentation();
});

function wireGameClientEvents(client: GameClient): void {
  client.onLobbyStatus((status) => {
    if (status.status === 'pending') {
      uiManager.showLobbyStatus(status.slots, status.canSkipWaiting);
      uiManager.setMessage(`${status.playersConnected}/${status.required} players connected`);
    }
  });

  client.onGameStart((_gameId: string, battlefield) => {
    uiManager.hideLobbyStatus();
    renderer.setDefeatedPlayer(null);
    uiManager.prepareForNewRound();
    renderer.applyBattlefield(battlefield);
    uiManager.setRosterNames(
      game.getPlayers().map(player => ({ playerId: player.playerId, name: player.name, active: player.active })),
      new Map(game.getPlayers().map(player => [player.playerId, renderer.getCastleLabelPosition(player.playerId)]))
    );
    historicalTrajectories = [];
    activeTrajectory = [];
    activeShotIsLocal = false;
    animationActive = false;
    pendingVisualTurn = null;
    pendingGameOver = null;
    pendingDefeatedPlayerIds = [];
    pendingHitName = null;
    pendingRipPlayerIds = [];
    uiManager.setWindLabel(battlefield.wind);
    animator.configureScene(
      renderer.getCanvasWidth(),
      renderer.getGroundY(),
      renderer.getCastleTopY(),
      battlefield.gravity,
      battlefield.wind
    );

    const playerId = client.getPlayerId();
    const castleIds = battlefield.castles.map(castle => castle.playerId);
    uiManager.setDirectionVisible(
      playerId !== null && castleIds.length > 2 && playerId !== Math.min(...castleIds) && playerId !== Math.max(...castleIds)
    );
    uiManager.setDirectionDefault(
      playerId === Math.min(...castleIds) ? 'Right' : 'Left'
    );
    // Get opponent name from GameStartMessage if available
    opponentName = '';
    const localNames = client.getLocalPlayerNames();
    if (localNames) {
      clientName = localNames[0];
      opponentName = localNames[1];
    }
    const lastGameStartMessage = client.getLastGameStartMessage();
    if (lastGameStartMessage) {
      const localPlayerId = client.getPlayerId();
      const opponent = lastGameStartMessage.players.find(player => player.playerId !== localPlayerId);
      opponentName = opponent?.name ?? opponentName;
    }

    // Switch from the registration/lobby panel (invite info) to the battlefield now that the opponent has joined.
    if (playerId !== null) {
      uiManager.showGamePanel();
      uiManager.setPlayerNames(playerId, clientName, opponentName, {
        left: renderer.getCastleLabelPosition(0),
        right: renderer.getCastleLabelPosition(1)
      });
    }

    uiManager.renderShotHistory(game.getShotHistory());
    renderer.render({ projectile: null, activeTrajectory, historicalTrajectories });
    uiManager.setMessage('Game starting! Waiting for first turn...');
  });

  client.onShot((data) => {
    animationActive = true;
    const playerId = client.getPlayerId();
    const isMyShot = client.isHotSeat() || (playerId !== null && data.playerId === playerId);
    if (isMyShot) {
      activeShotIsLocal = true;
      uiManager.renderShotHistory(
        client.isHotSeat() ? game.getShotHistoryForPlayer(data.playerId as 0 | 1) : game.getShotHistory()
      );
      const battlefield = game.getBattlefield();
      if (battlefield) {
        historicalTrajectories = createHistoricalTrajectories(
          battlefield,
          client.isHotSeat()
            ? game.getShotHistoryForPlayer(data.playerId as 0 | 1).slice(1)
            : game.getShotHistory().slice(1),
          data.playerId as 0 | 1
        );
      }
    } else {
      activeShotIsLocal = false;
    }

    const shooterId = data.playerId;
    const startX = renderer.getCastleMuzzleX(shooterId);
    animator.fire(data.angle, data.velocity, startX, shooterId, data.direction);
  });

  client.onTurnChange((playerId: number, isMyTurn: boolean) => {
    const activePlayerId = playerId;
    const inputHistory = game.isHotSeat()
      ? game.getShotHistoryForPlayer(activePlayerId)
      : game.getShotHistory();
    uiManager.renderShotHistory(inputHistory);
    uiManager.setShotInputs(inputHistory[0]);
    uiManager.setRosterNames(
      game.getPlayers().map(player => ({ playerId: player.playerId, name: player.name, active: player.active || pendingDefeatedPlayerIds.includes(player.playerId) })),
      new Map(game.getPlayers().map(player => [player.playerId, renderer.getCastleLabelPosition(player.playerId)]))
    );
    uiManager.updateTurnUI(activePlayerId, isMyTurn);
    pendingVisualTurn = { playerId: playerId as 0 | 1, isMyTurn };
    const localPlayerId = client.getPlayerId();
    const battlefield = game.getBattlefield();
    if (isMyTurn && localPlayerId !== null && battlefield && !activeShotIsLocal) {
        historicalTrajectories = createHistoricalTrajectories(
        battlefield,
          game.isHotSeat() ? game.getShotHistoryForPlayer(activePlayerId) : game.getShotHistory(),
        activePlayerId
      );
    }
    applyPendingPresentation();
  });

  client.onPlayerHit((playerId, playerName) => {
    pendingHitName = playerName;
    pendingDefeatedPlayerIds.push(playerId);
    pendingRipPlayerIds.push(playerId);
  });

  client.onGameOver((winnerId: number, didIWin: boolean) => {
    uiManager.disableFireButton();
    pendingDefeatedPlayerIds = game.getPlayers()
      .filter(player => !player.active)
      .map(player => player.playerId);
    if (client.isHotSeat()) {
      const localNames = client.getLocalPlayerNames();
      if (localNames) {
        pendingGameOver = { didIWin: true };
        clientName = localNames[winnerId as 0 | 1];
        opponentName = localNames[(winnerId === 0 ? 1 : 0) as 0 | 1];
        applyPendingPresentation();
        return;
      }
    }
    pendingGameOver = { didIWin };
    applyPendingPresentation();
  });

  client.onRematchStatus((playersAnswered, requiredPlayers, players) => {
    uiManager.renderRematchStatus(players);
    uiManager.setRematchWaiting(playersAnswered);
    uiManager.setMessage(`Rematch responses (${playersAnswered}/${requiredPlayers})`);
  });
}

// Wire up UI events
const lobbyState = {
  lastInviteUrl: '',
  lastInviteCode: ''
};

function parseInviteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const match = trimmed.match(/[?&]invite=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : trimmed;
}

function getServerFromInviteUrl(): string | null {
  const server = new URLSearchParams(window.location.search).get('server');
  return server ? server : null;
}

// If the page was opened via an invite link, only the name + Join controls are relevant.
const inviteFromUrl = new URLSearchParams(window.location.search).get('invite');
if (inviteFromUrl) {
  const inviteServer = getServerFromInviteUrl();
  if (inviteServer) {
    uiManager.setServerAddress(inviteServer);
  }
  uiManager.enterJoinOnlyMode(inviteFromUrl);
}

uiManager.onCreateGame(async (playerName: string, serverAddress: string) => {
  try {
    const { apiBaseUrl, wsBaseUrl } = resolveServerBaseUrls(serverAddress);
    gameClient = new GameClient(apiBaseUrl, wsBaseUrl, game);
    wireGameClientEvents(gameClient);

    clientName = playerName;
    hotSeatNames = null;
    uiManager.showRegistering();
    const playerCount = uiManager.getPlayerCount();
    if (playerCount === null) return;
    const createResult = await gameClient.createGame(playerName, playerCount);
    lobbyState.lastInviteUrl = createResult.inviteUrl;
    lobbyState.lastInviteCode = createResult.inviteCode;
    uiManager.showInviteInfo(createResult.inviteCode, createResult.inviteUrl);

    uiManager.setMessage(`Share this code: ${createResult.inviteCode}`);

    await gameClient.connectToGame();
  } catch (error) {
    console.error('Create game failed:', error);
    if (error instanceof Error && error.message === 'Game connection timeout') {
      uiManager.hideInviteInfo();
    }
    const errorMessage = error instanceof Error ? error.message : 'Game creation failed. Please try again.';
    uiManager.showRegistrationError(errorMessage);
  }
});

uiManager.onSkipWaiting(async () => {
  try {
    if (!gameClient) throw new Error('Not connected yet');
    await gameClient.skipWaiting();
  } catch (error) {
    uiManager.setMessage(error instanceof Error ? error.message : 'Unable to skip waiting players');
  }
});

uiManager.onJoinGame(async (inviteCode: string, playerName: string, serverAddress: string) => {
  try {
    const { apiBaseUrl, wsBaseUrl } = resolveServerBaseUrls(serverAddress);
    gameClient = new GameClient(apiBaseUrl, wsBaseUrl, game);
    wireGameClientEvents(gameClient);

    clientName = playerName;
    hotSeatNames = null;
    uiManager.showRegistering();
    const inviteValue = parseInviteInput(inviteCode);
    const accepted = await gameClient.acceptInvitation(inviteValue, playerName);

    lobbyState.lastInviteCode = accepted.gameId;
    uiManager.setMessage('Connected to private game');

    await gameClient.connectToGame();
  } catch (error) {
    console.error('Join game failed:', error);
    if (error instanceof Error && error.message === 'Game connection timeout') {
      uiManager.hideInviteInfo();
    }
    const errorMessage = error instanceof Error ? error.message : 'Unable to join game. Please try again.';
    uiManager.showRegistrationError(errorMessage);
  }
});

uiManager.onHotSeat(async (firstName: string, secondName: string, serverAddress: string) => {
  try {
    const { apiBaseUrl, wsBaseUrl } = resolveServerBaseUrls(serverAddress);
    gameClient = new GameClient(apiBaseUrl, wsBaseUrl, game);
    wireGameClientEvents(gameClient);
    clientName = firstName;
    opponentName = secondName;
    hotSeatNames = [firstName, secondName];
    uiManager.showRegistering();
    await gameClient.createHotSeatGame(firstName, secondName);
    await gameClient.connectToGame();
  } catch (error) {
    console.error('Hot-seat game creation failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Hot-seat game creation failed. Please try again.';
    uiManager.showRegistrationError(errorMessage);
  }
});

uiManager.onFire(async (angle: number, velocity: number, direction?: 'Left' | 'Right') => {
  try {
    if (!gameClient) {
      throw new Error('Not connected yet');
    }

    uiManager.disableFireButton();
    uiManager.setMessage('Firing...');
    await gameClient.fire(angle, velocity, direction);
    // Server will send WebSocket messages (shot + turn_change) to update state
  } catch (error) {
    console.error('Fire failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Fire action failed';
    uiManager.setMessage(errorMessage);
    uiManager.updateTurnUI(game.getState().currentTurn, game.getState().isMyTurn);
  }
});

uiManager.onRematchAnswer(async (answer) => {
  try {
    if (!gameClient) throw new Error('Not connected yet');
    uiManager.setRematchAnswerSubmitted();
    await gameClient.requestRematch(answer);
  } catch (error) {
    uiManager.showRematchAvailable();
    uiManager.setMessage(error instanceof Error ? error.message : 'Rematch response failed');
  }
});

