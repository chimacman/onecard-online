import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager, newDeck, attackValue, isPlayable } from '../game.js';

const card = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank });
function gameWithPlayers(count = 2) {
  const m = new GameManager();
  const tokens = [m.create('나')];
  for (let i = 1; i < count; i++) tokens.push(m.join(tokens[0].code, `친구${i}`));
  for (let i = 1; i < count; i++) m.action(tokens[i].code, tokens[i].token, 'ready');
  m.action(tokens[0].code, tokens[0].token, 'start');
  const room = m.rooms.get(tokens[0].code);
  room.game.currentIdx = 0;
  room.game.direction = 1;
  return { m, tokens, room, g: room.game };
}

test('54 distinct cards: 52 standard + two jokers', () => {
  const deck = newDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map(c => c.id)).size, 54);
  assert.equal(attackValue(card('H', '2')), 2);
  assert.equal(attackValue(card('C', 'A')), 3);
  assert.equal(attackValue(deck.find(c => c.id === 'JK-B')), 5);
  assert.equal(attackValue(deck.find(c => c.id === 'JK-R')), 7);
});

test('join, hidden hands, ready/start, no joining active game', () => {
  const m = new GameManager();
  const a = m.create('방장');
  const b = m.join(a.code, '둘째');
  assert.throws(() => m.action(a.code, a.token, 'start'), /준비/);
  m.action(b.code, b.token, 'ready');
  m.action(a.code, a.token, 'start');
  const room = m.rooms.get(a.code);
  assert.equal(room.status, 'playing');
  assert.deepEqual(room.players.map(p => p.hand.length), [7, 7]);
  const state = m.state(room, room.players[0]);
  assert.equal(state.self.hand.length, 7);
  assert.ok(!('hand' in state.players[1]));
  assert.throws(() => m.join(a.code, '셋째'), /진행 중/);
  assert.throws(() => m.lookup(a.code, 'wrong'), /만료/);
});

test('matching suits and ranks, wild joker, attack-only options', () => {
  const g = { discard: [card('H','8')], activeSuit:'H', pendingAttack:0 };
  assert.equal(isPlayable(card('D','8'), g), true);
  assert.equal(isPlayable(card('H','K'), g), true);
  assert.equal(isPlayable(card('S','5'), g), false);
  assert.equal(isPlayable({ id:'JK-B',rank:'JK',suit:null,joker:'black' }, g), true);
  g.pendingAttack = 3;
  assert.equal(isPlayable(card('S','2'), g), true);
  assert.equal(isPlayable(card('C','3'), g), true);
  assert.equal(isPlayable(card('H','8'), g), false);
});

test('play attack chain, defense by 3, and draw turn', () => {
  const { m, room, tokens, g } = gameWithPlayers(3);
  g.discard = [card('H','8')]; g.activeSuit = 'H';
  room.players[0].hand = [card('H','2'),card('D','5')];
  room.players[1].hand = [card('C','A'),card('D','4')];
  room.players[2].hand = [card('S','3'),card('C','9')];
  m.action(tokens[0].code, tokens[0].token, 'play', { cardId:'H-2' });
  assert.equal(g.pendingAttack, 2); assert.equal(g.currentIdx, 1);
  m.action(tokens[1].code, tokens[1].token, 'play', { cardId:'C-A' });
  assert.equal(g.pendingAttack, 5); assert.equal(g.currentIdx, 2);
  m.action(tokens[2].code, tokens[2].token, 'play', { cardId:'S-3' });
  assert.equal(g.pendingAttack, 0); assert.equal(g.activeSuit, 'S'); assert.equal(g.currentIdx, 0);
  m.action(tokens[0].code, tokens[0].token, 'draw');
  assert.equal(g.currentIdx, 1);
});

test('wild suit choice required; Q skips, J reverses, K repeats', () => {
  const { m, tokens, room, g } = gameWithPlayers(3);
  g.discard = [card('S','9')]; g.activeSuit = 'S';
  room.players[0].hand = [card('S','7'),card('D','Q'),card('H','K'),card('C','J'),card('S','5')];
  assert.throws(() => m.action(tokens[0].code,tokens[0].token,'play',{cardId:'S-7'}), /무늬/);
  m.action(tokens[0].code,tokens[0].token,'play',{cardId:'S-7',suit:'D'});
  assert.equal(g.activeSuit, 'D'); assert.equal(g.currentIdx,1);
  room.players[1].hand=[card('D','Q'),card('D','5')];
  m.action(tokens[1].code,tokens[1].token,'play',{cardId:'D-Q'});
  assert.equal(g.currentIdx,0); // skips third player
  g.activeSuit='H'; g.discard=[card('H','9')];
  m.action(tokens[0].code,tokens[0].token,'play',{cardId:'H-K'});
  assert.equal(g.currentIdx,0); // repeats
  g.activeSuit='C'; g.discard=[card('C','9')];
  m.action(tokens[0].code,tokens[0].token,'play',{cardId:'C-J'});
  assert.equal(g.direction,-1); assert.equal(g.currentIdx,2);
});

test('one-card call and catch penalty', () => {
  const {m,tokens,room,g} = gameWithPlayers();
  g.discard=[card('H','8')]; g.activeSuit='H';
  room.players[0].hand=[card('H','9'),card('D','5')];
  m.action(tokens[0].code,tokens[0].token,'play',{cardId:'H-9'});
  assert.equal(g.oneCardRiskId,room.players[0].id);
  m.action(tokens[0].code,tokens[0].token,'onecard');
  assert.equal(g.oneCardRiskId,null);
  assert.throws(()=>m.action(tokens[1].code,tokens[1].token,'catch'), /잡을 수/);
  g.discard=[card('H','8')];g.activeSuit='H';g.currentIdx=0;
  room.players[0].hand=[card('H','7'),card('D','5')];
  m.action(tokens[0].code,tokens[0].token,'play',{cardId:'H-7',suit:'D'});
  m.action(tokens[1].code,tokens[1].token,'catch');
  assert.equal(room.players[0].hand.length,3);
  assert.equal(g.oneCardRiskId,null);
});

test('playing the final card wins, host can rematch', () => {
  const {m,tokens,room,g}=gameWithPlayers();
  g.discard=[card('H','8')];g.activeSuit='H';
  room.players[0].hand=[card('H','5')];
  m.action(tokens[0].code,tokens[0].token,'play',{cardId:'H-5'});
  assert.equal(room.status,'finished'); assert.equal(g.winnerId,room.players[0].id);
  m.action(tokens[0].code,tokens[0].token,'rematch');
  assert.equal(room.status,'lobby'); assert.deepEqual(room.players.map(p=>p.ready),[true,false]);
});

test('timeout automatically advances and consumes attack', () => {
  const {m,room,g}=gameWithPlayers();
  g.pendingAttack=3;g.turnDeadline=Date.now()-1;
  const oldCards=room.players[0].hand.length;
  m.tick();
  assert.equal(room.players[0].hand.length,oldCards+3);
  assert.equal(g.currentIdx,1);assert.equal(g.pendingAttack,0);
});

test('leaving current player keeps next seat and host migrates', () => {
  const {m,room,tokens,g}=gameWithPlayers(3);
  m.action(tokens[0].code,tokens[0].token,'leave');
  assert.equal(room.hostId,room.players[0].id);
  assert.equal(room.players[0].name,'친구1');
  assert.equal(g.currentIdx,0);
  assert.equal(room.status,'playing');
});
