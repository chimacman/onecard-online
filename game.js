import { randomBytes } from 'node:crypto';

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_NAMES = { S: '스페이드', H: '하트', D: '다이아', C: '클로버' };
export const MAX_PLAYERS = 6;
export const TURN_MS = 60_000;

const now = () => Date.now();
const randomToken = () => randomBytes(24).toString('hex');
const randomCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomBytes(1)[0] % 32]).join('');
const cleanName = value => typeof value === 'string' ? [...value.trim().replace(/[\x00-\x1f\x7f]/g, '')].slice(0, 12).join('') : '';
const cleanText = value => typeof value === 'string' ? [...value.trim().replace(/[\x00-\x1f\x7f]/g, ' ')].slice(0, 140).join('') : '';

export function newDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) {
      cards.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  cards.push({ id: 'JK-B', suit: null, rank: 'JK', joker: 'black' });
  cards.push({ id: 'JK-R', suit: null, rank: 'JK', joker: 'red' });
  return cards;
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE() % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function attackValue(card) {
  if (card.rank === '2') return 2;
  if (card.rank === 'A') return 3;
  if (card.rank === 'JK') return card.joker === 'red' ? 7 : 5;
  return 0;
}

export function isPlayable(card, game) {
  if (game.pendingAttack > 0) return attackValue(card) > 0 || card.rank === '3';
  if (card.rank === 'JK') return true;
  return card.suit === game.activeSuit || card.rank === game.discard.at(-1)?.rank;
}

export class GameManager {
  constructor() { this.rooms = new Map(); }

  lookup(code, token) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw Error('방을 찾을 수 없어요. 코드를 확인해 주세요.');
    const player = room.players.find(p => p.token === token);
    if (!player) throw Error('참여 정보가 만료되었어요. 다시 입장해 주세요.');
    room.updatedAt = now();
    return { room, player };
  }

  create(name) {
    name = cleanName(name);
    if (!name) throw Error('닉네임을 입력해 주세요.');
    let code;
    do { code = randomCode(); } while (this.rooms.has(code));
    const player = this.makePlayer(name);
    player.ready = true;
    const room = { code, hostId: player.id, status: 'lobby', players: [player], game: null, logs: [], createdAt: now(), updatedAt: now(), listeners: new Set() };
    this.rooms.set(code, room);
    this.log(room, 'system', `${name}님이 방을 만들었어요.`);
    return { code, token: player.token, id: player.id };
  }

  makePlayer(name) {
    return { id: randomToken().slice(0, 14), token: randomToken(), name, ready: false, hand: [], connected: false, connections: 0, lastChat: 0 };
  }

  join(code, name) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw Error('해당 방이 없어요. 방 코드를 다시 확인해 주세요.');
    if (room.status !== 'lobby') throw Error('게임이 진행 중이라 새로 들어갈 수 없어요. 다음 판에 참여해 주세요.');
    if (room.players.length >= MAX_PLAYERS) throw Error('방이 가득 찼어요. (최대 6명)');
    name = cleanName(name);
    if (!name) throw Error('닉네임을 입력해 주세요.');
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw Error('같은 닉네임이 이미 있어요.');
    const player = this.makePlayer(name);
    room.players.push(player);
    room.updatedAt = now();
    this.log(room, 'system', `${name}님이 입장했어요.`);
    this.emit(room);
    return { code: room.code, token: player.token, id: player.id };
  }

  log(room, type, text, sender = null) {
    room.logs.push({ id: randomToken().slice(0, 12), type, text, sender, at: now() });
    if (room.logs.length > 90) room.logs.splice(0, room.logs.length - 90);
  }

  attach(code, token, callback) {
    const { room, player } = this.lookup(code, token);
    const connection = { playerId: player.id, callback };
    room.listeners.add(connection);
    player.connections++;
    player.connected = true;
    this.emit(room);
    return () => {
      if (!room.listeners.delete(connection)) return;
      player.connections = Math.max(0, player.connections - 1);
      player.connected = player.connections > 0;
      this.emit(room);
    };
  }

  emit(room) {
    for (const connection of room.listeners) {
      const player = room.players.find(p => p.id === connection.playerId);
      if (!player) continue;
      try { connection.callback(this.state(room, player)); } catch { /* disconnected transports close themselves */ }
    }
  }

  state(room, player) {
    const game = room.game;
    return {
      code: room.code, hostId: room.hostId, status: room.status,
      self: { id: player.id, name: player.name, ready: player.ready, hand: player.hand },
      players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, connected: p.connected, count: p.hand.length })),
      game: game ? {
        topCard: game.discard.at(-1), deckCount: game.deck.length, discardCount: game.discard.length,
        currentPlayerId: room.players[game.currentIdx]?.id ?? null,
        direction: game.direction, activeSuit: game.activeSuit,
        pendingAttack: game.pendingAttack, oneCardRiskId: game.oneCardRiskId,
        winnerId: game.winnerId, turnDeadline: game.turnDeadline, turnNumber: game.turnNumber,
        legalCardIds: room.players[game.currentIdx]?.id === player.id ? player.hand.filter(c => isPlayable(c, game)).map(c => c.id) : [],
      } : null,
      logs: room.logs.slice(-65), serverNow: now(),
    };
  }

  draw(game, player, count) {
    for (let i = 0; i < count; i++) {
      if (game.deck.length === 0) {
        if (game.discard.length <= 1) break;
        const top = game.discard.pop();
        game.deck = shuffle(game.discard);
        game.discard = [top];
      }
      const card = game.deck.pop();
      if (card) player.hand.push(card);
    }
  }

  advance(room, steps = 1) {
    const g = room.game;
    if (!room.players.length) return;
    g.currentIdx = (g.currentIdx + g.direction * steps % room.players.length + room.players.length * 2) % room.players.length;
    g.turnDeadline = now() + TURN_MS;
    g.turnNumber++;
  }

  start(room) {
    if (room.status !== 'lobby') throw Error('지금은 시작할 수 없어요.');
    if (room.players.length < 2) throw Error('최소 2명이 있어야 시작할 수 있어요.');
    if (room.players.some(p => !p.ready)) throw Error('모든 플레이어가 준비해야 시작할 수 있어요.');
    const deck = shuffle(newDeck());
    for (const p of room.players) { p.hand = []; for (let i = 0; i < 7; i++) p.hand.push(deck.pop()); }
    const firstIdx = deck.findIndex(c => ['4', '5', '6', '8', '9', '10'].includes(c.rank));
    const first = deck.splice(firstIdx, 1)[0];
    room.game = {
      deck, discard: [first], currentIdx: randomBytes(2).readUInt16BE() % room.players.length,
      activeSuit: first.suit, pendingAttack: 0, direction: 1,
      oneCardRiskId: null, winnerId: null, turnDeadline: now() + TURN_MS, turnNumber: 1,
    };
    room.status = 'playing';
    this.log(room, 'system', '게임 시작! 각자 카드 7장을 받았어요.');
    this.log(room, 'system', `${room.players[room.game.currentIdx].name}님부터 시작해요.`);
  }

  action(code, token, action, payload = {}) {
    const { room, player } = this.lookup(code, token);
    if (action === 'chat') {
      const text = cleanText(payload.message);
      if (!text) throw Error('메시지를 입력해 주세요.');
      if (now() - player.lastChat < 450) throw Error('채팅은 잠깐 간격을 두고 보내 주세요.');
      player.lastChat = now();
      this.log(room, 'chat', text, player.name);
      this.emit(room); return;
    }
    if (action === 'leave') { this.leave(room, player); return; }
    if (action === 'ready') {
      if (room.status !== 'lobby') throw Error('대기실에서만 준비할 수 있어요.');
      if (player.id === room.hostId) throw Error('방장은 항상 준비 상태예요.');
      player.ready = !player.ready;
      this.log(room, 'system', `${player.name}님이 ${player.ready ? '준비 완료' : '준비 취소'}했어요.`);
      this.emit(room); return;
    }
    if (action === 'start') {
      if (room.hostId !== player.id) throw Error('방장만 시작할 수 있어요.');
      this.start(room);
      this.emit(room); return;
    }
    if (action === 'rematch') {
      if (room.hostId !== player.id) throw Error('방장만 새 판을 열 수 있어요.');
      if (room.status !== 'finished') throw Error('게임이 끝난 뒤에 새 판을 열 수 있어요.');
      room.status = 'lobby'; room.game = null;
      room.players.forEach(p => { p.hand = []; p.ready = p.id === room.hostId; });
      this.log(room, 'system', '새 판의 대기실이 열렸어요. 준비 버튼을 눌러 주세요.');
      this.emit(room); return;
    }
    if (room.status !== 'playing') throw Error('게임이 진행 중이 아니에요.');
    const g = room.game;
    if (action === 'onecard') {
      if (g.oneCardRiskId !== player.id || player.hand.length !== 1) throw Error('지금은 원카드를 외칠 수 없어요.');
      g.oneCardRiskId = null;
      this.log(room, 'system', `📣 ${player.name}: 원카드!`);
      this.emit(room); return;
    }
    if (action === 'catch') {
      if (!g.oneCardRiskId || g.oneCardRiskId === player.id) throw Error('잡을 수 있는 플레이어가 없어요.');
      const target = room.players.find(p => p.id === g.oneCardRiskId);
      if (!target) throw Error('대상이 방에 없어요.');
      this.draw(g, target, 2);
      g.oneCardRiskId = null;
      this.log(room, 'system', `🚨 ${player.name}님이 ${target.name}님의 원카드 미신고를 잡았어요! +2장`);
      this.emit(room); return;
    }
    if (room.players[g.currentIdx]?.id !== player.id) throw Error('아직 내 차례가 아니에요.');
    // A pending one-card warning expires only after a VALID new move begins.
    if (action === 'draw') {
      g.oneCardRiskId = null;
      const count = g.pendingAttack || 1;
      const oldCount = player.hand.length;
      this.draw(g, player, count);
      const drawn = player.hand.length - oldCount;
      g.pendingAttack = 0;
      this.log(room, 'system', `${player.name}님이 카드 ${drawn}장을 뽑고 턴을 넘겼어요.`);
      this.advance(room);
      this.emit(room); return;
    }
    if (action === 'play') {
      const cardIdx = player.hand.findIndex(c => c.id === payload.cardId);
      if (cardIdx === -1) throw Error('손에 없는 카드예요.');
      const card = player.hand[cardIdx];
      if (!isPlayable(card, g)) throw Error('지금 낼 수 없는 카드예요. 같은 무늬/숫자 또는 공격 카드를 확인해 주세요.');
      if (['7', 'JK'].includes(card.rank) && !SUITS.includes(payload.suit)) throw Error('바꿀 무늬를 선택해 주세요.');
      g.oneCardRiskId = null;
      player.hand.splice(cardIdx, 1);
      g.discard.push(card);
      if (card.rank === '7' || card.rank === 'JK') g.activeSuit = payload.suit;
      else g.activeSuit = card.suit;
      if (g.pendingAttack && card.rank === '3') g.pendingAttack = 0;
      else g.pendingAttack += attackValue(card);
      const cardName = card.rank === 'JK' ? `${card.joker === 'red' ? '빨간' : '검은'} 조커` : `${SUIT_NAMES[card.suit]} ${card.rank}`;
      this.log(room, 'system', `${player.name}님이 ${cardName} 카드를 냈어요.${attackValue(card) ? ` 공격 +${attackValue(card)}장!` : ''}`);
      if (player.hand.length === 0) {
        room.status = 'finished'; g.winnerId = player.id;
        this.log(room, 'system', `🏆 ${player.name}님이 승리했어요!`);
      } else {
        if (player.hand.length === 1) g.oneCardRiskId = player.id;
        if (card.rank === 'J') g.direction *= -1;
        if (card.rank === 'K') { g.turnDeadline = now() + TURN_MS; g.turnNumber++; }
        else this.advance(room, card.rank === 'Q' ? 2 : 1);
      }
      this.emit(room); return;
    }
    throw Error('알 수 없는 요청이에요.');
  }

  leave(room, player) {
    const idx = room.players.findIndex(p => p.id === player.id);
    if (idx === -1) return;
    const g = room.game;
    if (g && room.status === 'playing') {
      if (g.currentIdx > idx) g.currentIdx--;
      else if (g.currentIdx === idx) {
        // After removal, the same array position becomes the next seat in clockwise order.
        if (g.direction === -1) g.currentIdx--;
        g.turnDeadline = now() + TURN_MS;
      }
      if (g.oneCardRiskId === player.id) g.oneCardRiskId = null;
    }
    room.players.splice(idx, 1);
    if (g && room.players.length) g.currentIdx = (g.currentIdx + room.players.length) % room.players.length;
    if (room.hostId === player.id) room.hostId = room.players[0]?.id ?? null;
    this.log(room, 'system', `${player.name}님이 퇴장했어요.`);
    if (room.status === 'playing' && room.players.length === 1) {
      room.status = 'finished'; g.winnerId = room.players[0].id;
      this.log(room, 'system', `🏆 ${room.players[0].name}님이 승리했어요!`);
    }
    if (room.players.length === 0) this.rooms.delete(room.code);
    else this.emit(room);
  }

  tick() {
    const currentTime = now();
    for (const room of this.rooms.values()) {
      if (room.status === 'playing' && currentTime >= room.game.turnDeadline) {
        const g = room.game;
        const player = room.players[g.currentIdx];
        if (player) {
          g.oneCardRiskId = null;
          const count = g.pendingAttack || 1;
          const before = player.hand.length;
          this.draw(g, player, count);
          const actual = player.hand.length - before;
          g.pendingAttack = 0;
          this.log(room, 'system', `⌛ ${player.name}님의 제한 시간이 지나 카드 ${actual}장을 뽑고 자동으로 턴이 넘어갔어요.`);
          this.advance(room);
          this.emit(room);
        }
      }
      if ((!room.listeners.size && currentTime - room.updatedAt > 15 * 60_000) || currentTime - room.createdAt > 8 * 60 * 60_000) {
        this.rooms.delete(room.code);
      }
    }
  }
}
