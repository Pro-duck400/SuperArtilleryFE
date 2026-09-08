import { WebSocket } from 'ws';
import type { Battlefield } from '../types/messages';
import type { GameStatus, PrivateGame } from '../types/private-game';
import { createBattlefield } from '../utils/battlefield';
import { calculateCastleHit } from '../utils/shotResolver';

export type FireTransition =
  | { kind: 'hit'; hitTime: number; targetPlayerId: number; winnerPlayerId?: number }
  | { kind: 'miss'; nextPlayerId: number };

export type RematchTransition =
  | { kind: 'waiting'; playersAnswered: number; playersReady: number; answers: Array<import('../types/private-game').RematchAnswer | null> }
  | { kind: 'started'; playersAnswered: number; playersReady: number; battlefield: Battlefield; round: number; answers: Array<import('../types/private-game').RematchAnswer | null> };

export class GameRules {
  public startIfReady(game: PrivateGame, now: number = Date.now()): { battlefield: Battlefield } | null {
    const slots = this.ensureLobbySlots(game);
    if (
      game.gameStarted ||
      slots.length < 2 ||
      slots.some(slot => slot.status !== 'skipped' &&
        (slot.session.websocket === null || slot.session.websocket.readyState !== WebSocket.OPEN))
    ) {
      return null;
    }

    game.status = 'active';
    game.gameStarted = true;
    game.currentTurn = 0;
    game.lastActivityAt = now;

      slots.forEach(slot => {
        slot.active = slot.status !== 'skipped';
        slot.eliminated = !slot.active;
      });
      game.battlefield = createBattlefield(Date.now(), slots.filter(slot => slot.active).length);
      return { battlefield: game.battlefield };
  }

  public disconnect(
    game: PrivateGame,
    playerId: number,
    now: number = Date.now()
  ): { statusChanged: boolean; status: GameStatus } {
    const slot = this.ensureLobbySlots(game)[playerId];
    if (slot) {
      slot.session.websocket = null;
      game.rematchReady[playerId] = false;
    }

    if (game.status === 'finished') {
      return { statusChanged: false, status: game.status };
    }

    if (game.gameStarted) {
      if (slot) {
        slot.active = false;
        slot.eliminated = true;
      }
      const activePlayers = game.lobbySlots.filter(candidate => candidate.active && !candidate.eliminated);
      if (activePlayers.length <= 1) {
        game.status = 'finished';
        game.gameFinishedAt = now;
        return { statusChanged: true, status: game.status };
      }
      game.currentTurn = this.nextActivePlayer(game, playerId);
      return { statusChanged: false, status: game.status };
    }

    if (game.status === 'pending' && playerId === 0) {
      game.status = 'expired';
      return { statusChanged: true, status: game.status };
    }

    return { statusChanged: false, status: game.status };
  }

  public requestRematch(
    game: PrivateGame,
    playerId: number,
    answerOrNow: import('../types/private-game').RematchAnswer | number = 'play_again',
    now: number = Date.now()
  ): RematchTransition {
    const answer = typeof answerOrNow === 'number' ? 'play_again' : answerOrNow;
    if (typeof answerOrNow === 'number') now = answerOrNow;
    const slots = this.ensureLobbySlots(game);
    game.rematchAnswers ??= slots.map(() => null);
    game.rematchAnswers[playerId] = answer;
    game.rematchReady[playerId] = answer === 'play_again';
    game.lastActivityAt = now;

    const rematchAnswers = game.rematchAnswers ?? slots.map(() => null);
    const playersAnswered = rematchAnswers.filter(value => value !== null).length;
    const playersReady = game.rematchReady.filter(Boolean).length;
    const answerSnapshot = [...rematchAnswers];
    if (playersAnswered < slots.length) {
      return { kind: 'waiting', playersAnswered, playersReady, answers: answerSnapshot };
    }

    const remainingSlots = slots.filter((_, index) => rematchAnswers[index] === 'play_again');
    const playersLeaving = slots.filter((_, index) => rematchAnswers[index] === 'had_enough');

    if (remainingSlots.length < 2) {
      game.rematchReady = slots.map(() => false);
      game.rematchAnswers = slots.map(() => null);
      if (remainingSlots.length === 1) {
        game.status = 'finished';
      }
      return { kind: 'waiting', playersAnswered, playersReady: remainingSlots.length, answers: answerSnapshot };
    }

    if (playersLeaving.length > 0) {
      game.lobbySlots = remainingSlots.map((slot, index) => ({
        ...slot,
        playerId: index,
        status: 'ready' as const,
        active: true,
        eliminated: false,
        session: { ...slot.session }
      }));
      if (game.lobbySlots.length > 0) {
        game.initiator = game.lobbySlots[0].session;
      }
      if (game.lobbySlots.length > 1) {
        game.invited = game.lobbySlots[1].session;
      }
    }

    game.rematchReady = slots.map(() => false);
    game.rematchAnswers = slots.map(() => null);
    game.round += 1;
    game.status = 'active';
    game.gameStarted = true;
    game.currentTurn = 0;
    game.gameFinishedAt = undefined;
    game.lobbySlots.forEach(slot => {
      slot.status = 'ready';
      slot.active = true;
      slot.eliminated = false;
    });
    game.battlefield = createBattlefield(Date.now(), game.lobbySlots.length);

    return {
      kind: 'started',
      playersAnswered,
      playersReady: remainingSlots.length,
      battlefield: game.battlefield,
      round: game.round,
      answers: answerSnapshot
    };
  }

  public fire(
    game: PrivateGame,
    playerId: number,
    angle: number,
    velocity: number,
    directionOrNow?: 'Left' | 'Right' | number,
    now: number = Date.now()
  ): FireTransition {
    const direction = typeof directionOrNow === 'number' ? undefined : directionOrNow;
    if (typeof directionOrNow === 'number') now = directionOrNow;
    game.lastActivityAt = now;
    const slots = this.ensureLobbySlots(game);
    const battlefield = game.battlefield ?? createBattlefield(Date.now(), slots.length);
    game.battlefield = battlefield;
    const hit = calculateCastleHit(battlefield, playerId, angle, velocity, direction);

    if (hit !== null) {
      const target = slots[hit.playerId];
      if (target) {
        target.active = false;
        target.eliminated = true;
      }
      const survivors = slots.filter(slot => slot.active && !slot.eliminated);
      if (survivors.length <= 1) {
        game.status = 'finished';
        game.gameFinishedAt = now;
        return { kind: 'hit', hitTime: hit.hitTime, targetPlayerId: hit.playerId, winnerPlayerId: survivors[0]?.playerId };
      }
      game.currentTurn = this.nextActivePlayer(game, playerId);
      return { kind: 'hit', hitTime: hit.hitTime, targetPlayerId: hit.playerId };
    }

    game.currentTurn = this.nextActivePlayer(game, playerId);
    return { kind: 'miss', nextPlayerId: game.currentTurn };
  }

  private nextActivePlayer(game: PrivateGame, playerId: number): number {
    const slots = this.ensureLobbySlots(game);
    for (let offset = 1; offset <= slots.length; offset += 1) {
      const candidate = slots[(playerId + offset) % slots.length];
      if (candidate?.active && !candidate.eliminated) return candidate.playerId;
    }
    return playerId;
  }

  private ensureLobbySlots(game: PrivateGame): NonNullable<PrivateGame['lobbySlots']> {
    if (game.lobbySlots?.length) return game.lobbySlots;
    game.lobbySlots = [game.initiator, game.invited].map((session, playerId) => ({
      playerId,
      session,
      status: 'ready' as const,
      active: true,
      eliminated: false
    }));
    return game.lobbySlots;
  }
}
