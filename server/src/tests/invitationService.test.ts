import { describe, expect, it } from 'vitest';
import { InMemoryGameRepository } from '../services/gameRepository';
import { InvitationService } from '../services/invitationService';

describe('InvitationService', () => {
  it('creates an invite URL that preserves the deployment path', () => {
    const service = new InvitationService(new InMemoryGameRepository(), 'http://localhost:5173');

    const result = service.createGame('Alice', 'https://example.com/SuperArtillery');

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.inviteUrl).toMatch(/^https:\/\/example\.com\/SuperArtillery\/\?invite=/);
      expect(result.playerToken).toBeTruthy();
      expect(result.inviteCode).toHaveLength(4);
    }
  });

  it('accepts an invite once and rejects reuse', () => {
    const service = new InvitationService(new InMemoryGameRepository(), 'http://localhost:5173');
    const created = service.createGame('Alice', 'http://localhost:5173');

    expect('error' in created).toBe(false);
    if ('error' in created) return;

    const accepted = service.acceptInvitation(created.inviteCode.toLowerCase(), 'Bob');
    expect('error' in accepted).toBe(false);
    if (!('error' in accepted)) {
      expect(accepted.playerId).toBe(1);
    }

    const reused = service.acceptInvitation(created.inviteCode, 'Carol');
    expect(reused).toEqual({
      error: 'This invitation has already been accepted',
      code: 'INVITATION_ALREADY_ACCEPTED'
    });
  });
});
