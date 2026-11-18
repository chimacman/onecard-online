const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toastElement = document.querySelector('#toast');
const icon = { S: '♠', H: '♥', D: '♦', C: '♣' };
const suitName = { S: '스페이드', H: '하트', D: '다이아', C: '클로버' };
let session = null;
let state = null;
let stream = null;
let pendingCard = null;
let serverOffset = 0;
let toastTimer = null;
let connected = false;
const invitedCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';

function escapeHtml(input) {
  return String(input ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function initials(name) { return [...String(name || '?')].slice(0, 1).join('').toUpperCase(); }
function timeOf(ms) { return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
function showToast(text) {
  toastElement.textContent = text;
  toastElement.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2800);
}
async function api(endpoint, data) {
  let res;
  try {
    res = await fetch(`/api/${endpoint}`, { method:'POST', headers: { 'Content-Type': 'application/json' }, body:JSON.stringify(data) });
  } catch { throw Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'); }
  const body = await res.json();
  if (!res.ok) throw Error(body.error || '요청을 처리하지 못했어요.');
  return body;
}
function button(label, cls = 'btn-dark', attrs = '') { return `<button class="btn ${cls}" ${attrs}>${label}</button>`; }
function header(inRoom = false) {
  return `<header class="site-header"><div class="brand"><div class="brand-mark">♠</div><div><h1>원카드 클럽</h1><small>ONE CARD CLUB</small></div></div>
  <div class="header-actions">${inRoom ? `<span id="connection" class="connection ${connected ? '' : 'offline'}">${connected ? '● 연결됨' : '○ 연결 중'}</span>` : ''}<button class="small-link" data-action="rules">게임 규칙</button>${inRoom ? `<button class="small-link" data-action="leave">퇴장하기</button>` : ''}</div></header>`;
}
function renderHome() {
  state = null;
  app.innerHTML = `${header(false)}<div class="home-grid">
    <section class="home-copy"><div class="kicker">PLAY TOGETHER, ANYWHERE</div><h2>모이면 바로<br/><em>원카드 한 판!</em></h2>
    <p>어디에 있든, 친구와 함께 카드를 내고 웃어 보세요. 설치할 앱도, 가입할 계정도 필요 없어요. 방을 만들고 링크만 보내면 끝!</p>
    <div class="features"><span>♠ 실시간 멀티플레이</span><span>♣ 2–6명 플레이</span><span>♥ 방 코드 초대</span></div>
    <div class="home-art" aria-hidden="true"><div class="art-patch"></div><div class="art-card one">♠</div><div class="art-card two">♥</div><div class="art-card three">♣</div></div></section>
    <section class="landing-panel"><div class="panel-eyebrow"><span>QUICK MATCH</span><span>🃏</span></div><h3>친구랑 원카드 시작하기</h3><p class="desc">닉네임만 있으면 바로 게임방을 열 수 있어요.</p>
    <form id="createForm"><label class="field-label" for="nickname">내 닉네임</label><input class="text-input" id="nickname" name="name" autocomplete="nickname" maxlength="12" placeholder="어떤 이름으로 플레이할까요?" required value="${escapeHtml(localStorage.getItem('onecard_name') || '')}" />
    <button type="submit" class="btn btn-primary btn-lg">＋ 새 게임방 만들기</button></form>
    <div class="or">또는 친구의 방에 참여하기</div><form id="joinForm"><label class="field-label" for="roomInput">친구에게 받은 방 코드</label><div class="join-row"><input id="roomInput" class="text-input" name="code" maxlength="6" minlength="6" placeholder="ABC123" autocomplete="off" value="${escapeHtml(invitedCode)}" required /><button type="submit" class="btn btn-dark">입장하기 →</button></div></form>
    <p class="intro-bottom">무료 · 회원가입 불필요 · 모바일/PC 지원</p></section></div><footer class="footnote">친구들과 즐기기 위한 비영리 게임 · 같은 방의 카드와 턴이 실시간 동기화됩니다.</footer>`;
}
function playerList() {
  return state.players.map(p => `<div class="player-entry"><div class="avatar">${escapeHtml(initials(p.name))}</div><div style="min-width:0"><div class="name">${escapeHtml(p.name)} ${p.id===state.hostId?'👑':''} ${p.id===state.self.id?'(나)':''}</div><div class="sub">${p.connected?'● 온라인':'○ 접속 대기'}</div></div><span class="ready-tag ${p.ready?'yes':''}">${p.ready?'✓ 준비완료':'준비 전'}</span></div>`).join('');
}
function renderLobby() {
  const host = state.hostId === state.self.id;
  const allReady = state.players.every(p => p.ready);
  const startAllowed = state.players.length >= 2 && allReady;
  return `<main class="main-panel lobby-area"><div class="section-tag">WAITING ROOM · ${state.players.length} / 6 PLAYERS</div>
  <h2 class="section-title">친구들을 기다리고 있어요 <span aria-hidden="true">👋</span></h2>
  <p class="section-subtitle">방 코드나 초대 링크를 공유해 주세요. 모두 준비하면 시작할 수 있어요.</p>
  <div class="player-list">${playerList()}</div>
  <div class="lobby-actions">${host ? button('게임 시작하기 ↗','btn-primary btn-lg',`data-action="start" ${startAllowed?'':'disabled'}`) : button(state.self.ready?'✓ 준비 취소':'✓ 준비 완료',state.self.ready?'btn-dark btn-lg':'btn-primary btn-lg','data-action="ready"')}${button('링크 복사해서 초대하기','btn-outline btn-lg','data-action="invite"')}</div>
  <p class="wait-help">${host ? startAllowed ? '준비 완료! 시작 버튼을 눌러 주세요.' : '최소 2명, 모든 플레이어 준비 완료 시 시작할 수 있어요.' : state.self.ready ? '방장이 게임을 시작할 때까지 기다려 주세요.' : '게임을 시작하려면 준비 완료 버튼을 눌러 주세요.'}</p></main>`;
}
function playingCard(card, options = {}) {
  const { playable = false, disabled = false, pile = false } = options;
  const joker = card.rank === 'JK';
  const symbol = joker ? '✦' : icon[card.suit];
  const suitClass = joker ? `joker ${card.joker === 'red'?'red':''}` : `suit-${card.suit}`;
  const rank = joker ? 'JK' : card.rank;
  const title = joker ? `${card.joker === 'red' ? '빨간' : '검은'} 조커 +${card.joker === 'red' ? 7 : 5}` : `${suitName[card.suit]} ${rank}`;
  const tag = pile ? 'div' : 'button';
  return `<${tag} class="playing-card ${suitClass} ${playable?'playable':''}" ${pile ? '' : `type="button" data-cardid="${card.id}" aria-label="${escapeHtml(title)}" ${disabled ? 'disabled' : ''}`} title="${escapeHtml(title)}"><div class="card-corner"><b>${rank}</b><span>${symbol}</span></div><div class="card-symbol">${symbol}</div>${joker?'<div class="joker-word">JOKER</div>':''}<div class="card-corner bottom"><b>${rank}</b><span>${symbol}</span></div></${tag}>`;
}
function renderGame() {
  const g = state.game;
  const isTurn = g.currentPlayerId === state.self.id && state.status === 'playing';
  const me = state.self;
  const current = state.players.find(p => p.id === g.currentPlayerId);
  const winner = state.players.find(p => p.id === g.winnerId);
  const risk = state.players.find(p => p.id === g.oneCardRiskId);
  const opponents = state.players.map(p => `<div class="opponent ${p.id === g.currentPlayerId && state.status==='playing'?'active':''}"><div class="avatar">${escapeHtml(initials(p.name))}</div><div><span class="name">${escapeHtml(p.name)}${p.id===me.id?' (나)':''}</span><span class="count">${p.count}장 · ${p.connected?'온라인':'<span class="offline-dot">재접속 대기</span>'}</span></div></div>`).join('');
  const activeSuit = `${icon[g.activeSuit]} ${suitName[g.activeSuit]}`;
  return `<main class="main-panel table-panel"><div class="opponents-bar"><div class="bar-title">PLAYERS · ${state.players.length}명</div><div class="opponents-list">${opponents}</div></div>
  ${state.status==='finished'?`<div class="win-banner"><strong>🏆 ${escapeHtml(winner?.name || '플레이어')}님 승리!</strong><span>멋진 한 판이었어요. ${state.hostId===me.id?'새 판을 열어 보세요.':'방장이 다음 게임을 열 수 있어요.'}</span><div style="margin-top:9px">${state.hostId===me.id?button('↻ 다시 한 판!','btn-primary','data-action="rematch"'):''}</div></div>`:''}
  <section class="felt" aria-label="게임 테이블"><div class="turn-label ${isTurn?'yours':''}">${state.status==='finished'?'게임 종료':isTurn?'★ 내 차례입니다!':`${escapeHtml(current?.name||'친구')}님의 차례`}${state.status==='playing'?` · <span id="turnTimer" data-deadline="${g.turnDeadline}">60초</span>`:''}</div>
  <div class="table-cards"><div><button class="deck-stack" data-action="draw" aria-label="카드 뽑기" ${!isTurn?'disabled':''}><div class="deck-face"><b>♠</b><small>ONE CARD</small></div></button><div class="deck-label">남은 카드 ${g.deckCount}장</div></div><div><div class="pile">${playingCard(g.topCard,{pile:true})}</div><div class="deck-label">마지막 카드</div></div></div>
  <div class="center-info"><span class="info-chip">현재 무늬: ${activeSuit}</span>${g.pendingAttack?`<span class="info-chip attack">⚡ 누적 공격 +${g.pendingAttack}장</span>`:''}<span class="info-chip">${g.direction===1?'↻ 정방향':'↺ 역방향'}</span></div>
  <div class="felt-actions">${state.status==='playing' ? `<button class="btn btn-dark" data-action="draw" ${!isTurn?'disabled':''}>${g.pendingAttack?`공격 ${g.pendingAttack}장 받기`:'카드 1장 뽑기'}</button>` : ''}
  ${g.oneCardRiskId===me.id && state.status==='playing'?button('📣 원카드!','btn-primary','data-action="onecard"'):''}
  ${g.oneCardRiskId && g.oneCardRiskId!==me.id && state.status==='playing'?button(`🚨 ${escapeHtml(risk?.name||'상대')} 원카드 잡기!`,'btn-red','data-action="catch"'):''}</div></section>
  <section class="hand-section"><div class="hand-top"><strong>내 카드 <span style="color:var(--accent)">${me.hand.length}장</span></strong><small>${isTurn ? g.pendingAttack?'공격 카드나 3으로 막거나, 누적 공격만큼 뽑으세요.':'무늬 또는 숫자가 같은 카드를 누르세요.':'다른 플레이어의 턴을 기다려 주세요.'}</small></div><div class="hand-cards">${me.hand.length?me.hand.map(c=>playingCard(c,{playable:isTurn && g.legalCardIds.includes(c.id),disabled:!isTurn || !g.legalCardIds.includes(c.id)})).join(''):'<div class="empty-hand">모든 카드를 냈어요. 🎉</div>'}</div></section></main>`;
}
function renderChat() {
  return `<aside class="sidebar"><section class="chat-section"><div class="sidebar-heading">대화 & 게임 알림 <span>LIVE CHAT</span></div>
  <div class="chat-feed" id="chatFeed">${state.logs.map(l => l.type==='system'?`<div class="chat-item system">${escapeHtml(l.text)}</div>`:`<div class="chat-item chat"><div class="chat-meta">${escapeHtml(l.sender)} <time>${timeOf(l.at)}</time></div><p class="chat-message">${escapeHtml(l.text)}</p></div>`).join('')}</div>
  <form id="chatForm" class="chat-form"><input id="chatInput" name="message" class="text-input" maxlength="140" autocomplete="off" placeholder="친구에게 메시지 보내기..." aria-label="채팅 메시지"/><button class="btn btn-primary" type="submit">전송</button></form></section></aside>`;
}
function renderRoom() {
  if (!state) return;
  const oldChat = document.querySelector('#chatInput');
  const oldChatValue = oldChat?.value || '';
  const activeChat = document.activeElement === oldChat;
  const oldFeed = document.querySelector('#chatFeed');
  const autoScroll = !oldFeed || oldFeed.scrollHeight - oldFeed.scrollTop - oldFeed.clientHeight < 75;
  app.innerHTML = `${header(true)}<div class="room-top"><div class="room-breadcrumb">원카드 온라인 / PRIVATE ROOM<strong>${state.status==='lobby'?'게임 대기실':state.status==='finished'?'게임 종료':'즐거운 한 판!'}</strong></div><div class="room-code"><span>ROOM CODE</span><strong>${state.code}</strong><button class="small-link" data-action="invite">🔗 초대</button></div></div>
  <div class="room-grid">${state.status==='lobby'?renderLobby():renderGame()}${renderChat()}</div><footer class="footnote">원카드는 지역마다 규칙이 달라요. 오른쪽 상단의 게임 규칙을 확인해 주세요.</footer>`;
  const input = document.querySelector('#chatInput');
  if (input) { input.value = oldChatValue; if (activeChat) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } }
  const feed = document.querySelector('#chatFeed');
  if (feed && autoScroll) feed.scrollTop = feed.scrollHeight;
  updateTimer();
}
function updateTimer() {
  const timer = document.querySelector('#turnTimer');
  if (!timer) return;
  const seconds = Math.max(0, Math.ceil((Number(timer.dataset.deadline) - (Date.now() + serverOffset)) / 1000));
  timer.textContent = `${seconds}초`;
  timer.style.color = seconds < 11 ? '#ffb3b1' : '';
}
function updateConnection() {
  const badge = document.querySelector('#connection');
  if (!badge) return;
  badge.textContent = connected ? '● 연결됨' : '○ 재연결 중';
  badge.classList.toggle('offline', !connected);
}
async function openRoom(data) {
  if (stream) { stream.close(); stream = null; }
  session = data;
  localStorage.setItem('onecard_session', JSON.stringify(session));
  history.replaceState({}, '', `/?room=${encodeURIComponent(data.code)}`);
  connected = false;
  stream = new EventSource(`/api/events?code=${encodeURIComponent(data.code)}&token=${encodeURIComponent(data.token)}`);
  stream.onopen = () => { connected = true; updateConnection(); };
  stream.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      state = data;
      serverOffset = data.serverNow - Date.now();
      connected = true;
      renderRoom();
    } catch (err) { console.error(err); }
  };
  stream.onerror = () => { connected = false; updateConnection(); };
}
async function request(action, payload = {}) {
  if (!session) return;
  try { await api('action', { code: session.code, token: session.token, action, ...payload }); }
  catch (err) { showToast(err.message); }
}
function closeModal() { modal.replaceChildren(); pendingCard = null; }
function openSuitSelector(cardId) {
  pendingCard = cardId;
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="suitTitle"><div class="modal-head"><h3 id="suitTitle">바꿀 무늬를 선택하세요</h3><button class="icon-btn" data-action="close-modal" aria-label="닫기">×</button></div><p class="modal-copy">7 카드와 조커를 내면 다음에 이어갈 무늬를 지정할 수 있어요.</p><div class="suit-options">${['S','H','D','C'].map(s=>`<button class="suit-button ${['H','D'].includes(s)?'red':''}" data-suit="${s}">${icon[s]}<span>${suitName[s]}</span></button>`).join('')}</div></div>`;
  modal.querySelector('.suit-button')?.focus();
}
function openRules() {
  pendingCard = null;
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="rulesTitle"><div class="modal-head"><h3 id="rulesTitle">🃏 원카드 규칙</h3><button class="icon-btn" data-action="close-modal" aria-label="닫기">×</button></div>
  <p class="modal-copy">이 게임에서 사용하는 하우스 룰이에요. 처음 시작할 때 7장씩 받으며, 손의 카드를 먼저 모두 내는 사람이 승리해요.</p>
  <ol class="rule-list"><li>자기 턴에 <strong>현재 무늬나 숫자(문자)가 같은 카드</strong>를 한 장 낼 수 있어요. 낼 카드가 없거나 원하면 한 장 뽑고 턴이 끝나요.</li>
  <li><strong>2는 +2장, A는 +3장, 검은 조커는 +5장, 빨간 조커는 +7장</strong>의 공격 카드예요. 공격 중엔 다른 공격 카드를 내어 누적하거나, 3을 내어 방어할 수 있어요. 공격을 받으면 누적 수만큼 뽑고 턴을 넘겨요.</li>
  <li><strong>3:</strong> 누적된 공격을 막아요. 평소에는 일반 카드로 사용할 수 있어요.</li><li><strong>7 / 조커:</strong> 원하는 무늬로 변경할 수 있어요. 조커는 어떤 무늬에도 낼 수 있어요.</li>
  <li><strong>J:</strong> 진행 방향 반전. <strong>Q:</strong> 다음 사람 한 명 건너뛰기. <strong>K:</strong> 한 번 더 내기(원하지 않으면 뽑고 종료).</li>
  <li>한 장 남으면 <strong>원카드!</strong> 버튼을 눌러야 해요. 신고 전에 다른 사람이 잡으면 2장을 추가로 뽑아요. 다음 행동이 시작되면 잡을 기회가 끝나요.</li>
  <li>턴 제한은 <strong>60초</strong>예요. 시간 초과 시 카드 1장(공격 중에는 누적 수량)을 자동으로 뽑고 넘어가요.</li></ol>
  <p class="modal-copy">※ 원카드의 지역별 규칙은 다양합니다. 이 버전은 위 하우스 룰로 고정되어 있어요.</p><div class="modal-actions">${button('이해했어요','btn-primary','data-action="close-modal"')}</div></div>`;
}
async function invite() {
  const code = session?.code || state?.code;
  if (!code) return;
  const url = `${location.origin}/?room=${encodeURIComponent(code)}`;
  try { await navigator.clipboard.writeText(url); showToast('초대 링크를 복사했어요. 친구에게 보내세요!'); }
  catch { prompt('친구에게 이 링크를 보내세요.', url); }
}
async function leave() {
  if (!confirm('게임방에서 퇴장할까요?')) return;
  if (session) await request('leave');
  if (stream) stream.close();
  stream = null; session = null; state = null;
  localStorage.removeItem('onecard_session');
  history.replaceState({}, '', '/');
  connected = false; renderHome();
}
app.addEventListener('click', async event => {
  const card = event.target.closest('[data-cardid]');
  if (card && !card.disabled) {
    const id = card.dataset.cardid;
    const item = state?.self.hand.find(c=>c.id===id);
    if (!item) return;
    if (item.rank==='7' || item.rank==='JK') return openSuitSelector(id);
    return request('play', { cardId:id });
  }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action==='rules') return openRules();
  if (action==='invite') return invite();
  if (action==='leave') return leave();
  if (['ready','start','rematch','onecard','catch','draw'].includes(action)) return request(action);
});
app.addEventListener('submit', async event => {
  if (!['createForm','joinForm','chatForm'].includes(event.target.id)) return;
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type=submit]');
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;
  try {
    if (form.id==='chatForm') {
      const text = form.elements.namedItem('message').value.trim();
      if (text) {
        form.elements.namedItem('message').value = '';
        try { await api('action', { ...session, action:'chat', message:text }); }
        catch (err) { const visible = document.querySelector('#chatInput'); if (visible) visible.value = text; throw err; }
      }
    } else {
      const name = document.querySelector('#nickname')?.value.trim() || localStorage.getItem('onecard_name') || '';
      if (!name) throw Error('먼저 닉네임을 입력해 주세요.');
      localStorage.setItem('onecard_name', name);
      const result = form.id==='createForm' ? await api('create',{name}) : await api('join',{code:form.elements.namedItem('code').value.trim().toUpperCase(),name});
      await openRoom(result);
    }
  } catch (err) { showToast(err.message); }
  finally { if (submit?.isConnected) submit.disabled = false; }
});
modal.addEventListener('click', async event => {
  if (event.target === modal) return closeModal();
  const suit = event.target.closest('[data-suit]');
  if (suit && pendingCard) { const id = pendingCard; closeModal(); return request('play',{cardId:id,suit:suit.dataset.suit}); }
  if (event.target.closest('[data-action="close-modal"]')) closeModal();
});
window.addEventListener('keydown', event => { if (event.key==='Escape') closeModal(); });
setInterval(updateTimer, 250);
(async function init() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('onecard_session') || 'null'); } catch { saved = null; }
  if (saved?.code && saved?.token && (!invitedCode || invitedCode===saved.code)) {
    try { const result = await api('reconnect', saved); return await openRoom(result); }
    catch { localStorage.removeItem('onecard_session'); }
  }
  renderHome();
  if (invitedCode) document.querySelector('#nickname')?.focus();
})();
