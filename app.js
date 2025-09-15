// static/app.js

// -------------------------------------
// 스크립트 로드 확인
// -------------------------------------
console.log('▶️ A-node app.js loaded');

let userMap = {};
let maxRenderedIndex = -1;
let firstLoad = true;
let mitmEnabled = false;

// -------------------------------------
// Audio 요소 & 재생 함수 추가
// -------------------------------------
// HTML에 아래와 같이 선언된 <audio> 태그를 가정:
// <audio id="sirenAudio" src="/static/siren.mp3" preload="auto"></audio>
// <audio id="accessAudio" src="/static/access.mp3" preload="auto"></audio>
// <audio id="deniedAudio" src="/static/denied.mp3" preload="auto"></audio>
// <audio id="blockedAudio" src="/static/blocked.mp3" preload="auto"></audio>
const sirenAudio  = document.getElementById('sirenAudio');
const accessAudio = document.getElementById('accessAudio');
const deniedAudio = document.getElementById('deniedAudio');
const blockedAudio= document.getElementById('blockedAudio');

function playStatusVoice(status) {
  const map = {
    '정상':    accessAudio,
    '미등록':  deniedAudio,
    '차단됨': blockedAudio
  };
  // 모든 음성 일단 정지 & 리셋
  [accessAudio, deniedAudio, blockedAudio].forEach(a => {
    if (a) { a.pause(); a.currentTime = 0; }
  });
  const audio = map[status];
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// -------------------------------------
// 사용자 추가/삭제 바인딩
// -------------------------------------
async function bindAddUser() {
  const btn = document.getElementById('addUser');
  if (!btn) return;
  btn.onclick = async () => {
    const uid = document.getElementById('uid').value.trim();
    const username = document.getElementById('username').value.trim();
    if (!uid || !username) {
      alert('UID와 이름을 모두 입력하세요.');
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, username }),
      });
      if (res.ok) {
        document.getElementById('uid').value = '';
        document.getElementById('username').value = '';
        await loadUsers();
      } else {
        const err = await res.json();
        alert(err.error || '등록 실패');
      }
    } catch (e) {
      console.error('사용자 등록 실패', e);
    }
  };
}

// -------------------------------------
// 사용자 목록 로드
// -------------------------------------
async function loadUsers() {
  try {
    const list = await fetch('/api/users').then(r => r.json());
    userMap = {};
    const ul = document.getElementById('userList');
    ul.innerHTML = '';
    list.forEach(u => {
      userMap[u.uid] = u.username;
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${u.uid} → ${u.username}</span>
        <span class="delete-x" data-uid="${u.uid}">×</span>
      `;
      ul.appendChild(li);
    });
    document.querySelectorAll('.delete-x').forEach(x => {
      x.onclick = async () => {
        const uid = x.dataset.uid;
        if (!confirm(`${uid} 사용자 삭제하시겠습니까?`)) return;
        try {
          await fetch(`/api/users/${uid}`, { method: 'DELETE' });
          await loadUsers();
        } catch (e) {
          console.error('사용자 삭제 실패', e);
        }
      };
    });
  } catch (e) {
    console.error('사용자 로드 실패', e);
  }
}

// -------------------------------------
// 차단 목록 로드
// -------------------------------------
async function loadBlocked() {
  try {
    const arr = await fetch('/api/blocked').then(r => r.json());
    const ul = document.getElementById('blockedList');
    ul.innerHTML = '';
    if (!arr.length) {
      ul.innerHTML = '<li>차단된 UID가 없습니다.</li>';
      return;
    }
    arr.forEach(uid => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${uid}</span>
        <span class="delete-x" data-uid="${uid}">×</span>
      `;
      ul.appendChild(li);
    });
    document.querySelectorAll('#blockedList .delete-x').forEach(x => {
      x.onclick = async () => {
        const uid = x.dataset.uid;
        if (!confirm(`${uid} 차단 해제하시겠습니까?`)) return;
        try {
          await fetch(`/api/blocked/${uid}`, { method: 'DELETE' });
          await loadBlocked();
        } catch (e) {
          console.error('차단 해제 실패', e);
        }
      };
    });
  } catch (e) {
    console.error('차단 목록 로드 실패', e);
  }
}

// -------------------------------------
// 블록 카드 렌더링
// -------------------------------------
function createBlock(b) {
  let st = b.data.status;
  const statusMap = { registered: '정상', unregistered: '미등록', blocked: '차단됨' };
  if (statusMap[st]) st = statusMap[st];
  const uname = b.data.username ?? (userMap[b.data.uid] || '-');

  // 사용자 태그 부분 분기
  let cid, cls, ico, title;
  if (b.index === 0) {
    cid = 'chain-user'; cls = 'block block-genesis'; ico = 'fa-cubes'; title = 'Genesis';
  } else if (Array.isArray(b.data)) {
    b.data.forEach(tx => createBlock({ index: b.index, data: tx, timestamp: tx.timestamp }));
    return;
  } else if (st === 'open' || b.data.status === 'open') {
    cid = 'chain-open'; cls = 'block block-open'; ico = 'fa-door-open'; title = '문 열림';
  } else if (st === 'closed' || b.data.status === 'closed') {
    cid = 'chain-closed'; cls = 'block block-closed'; ico = 'fa-door-closed'; title = '문 닫힘';
  } else {
    cid = 'chain-user';
    if (st === '정상')      { cls = 'block block-normal';  ico = 'fa-check-circle';       title = '등록'; }
    else if (st === '미등록') { cls = 'block block-unreg';   ico = 'fa-exclamation-triangle'; title = '미등록'; }
    else                      { cls = 'block block-blocked'; ico = 'fa-ban';                title = '차단됨'; }
  }

  // 사용자 태그 상태일 때 음성 재생
  if (cid === 'chain-user' && ['정상','미등록','차단됨'].includes(st)) {
    playStatusVoice(st);
  }

  // 날짜/시간 변환
  const dt = new Date((b.data.timestamp || b.timestamp) * 1000);
  const ds = dt.toLocaleDateString();
  const tm = dt.toLocaleTimeString();

  // 카드 엘리먼트 생성
  const el = document.createElement('div');
  el.className = `${cls} new`;
  el.innerHTML = `
    <div class="block-header"><i class="fa-solid ${ico}"></i>${title} #${b.index}</div>
    <div class="block-content">
      <div class="label">UID:</div><div>${b.data.uid}</div>
      <div class="label">이름:</div><div>${uname}</div>
      <div class="label">상태:</div><div>${st}</div>
      <div class="label">날짜:</div><div>${ds}</div>
      <div class="label">시간:</div><div>${tm}</div>
    </div>
  `;
  const container = document.getElementById(cid);
  container.appendChild(el);
  container.scrollLeft = container.scrollWidth;
  setTimeout(() => el.classList.remove('new'), 3000);
}

function clearAllBlocks() {
  ['chain-user','chain-open','chain-closed'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.innerHTML = '';
  });
}

// -------------------------------------
// 체인 업데이트 핸들러
// -------------------------------------
async function handleChainUpdate(chain, tampered) {
  document.body.classList.toggle('tampered', tampered);

  const light = document.getElementById('alarmLight');
  if (tampered) {
    light.classList.remove('hidden');
    sirenAudio.currentTime = 0;
    sirenAudio.play().catch(() => {});
  } else {
    light.classList.add('hidden');
    sirenAudio.pause();
    sirenAudio.currentTime = 0;
  }

  if (firstLoad) {
    clearAllBlocks();
    chain.forEach(createBlock);
    maxRenderedIndex = Math.max(...chain.map(b => b.index));
    firstLoad = false;
  } else {
    chain.forEach(b => {
      if (b.index > maxRenderedIndex) {
        createBlock(b);
        maxRenderedIndex = b.index;
        if (['blocked','차단됨'].includes(b.data.status)) loadBlocked();
      }
    });
  }
}

// -------------------------------------
// Socket.IO 실시간 처리
// -------------------------------------
function initSocket() {
  try {
    const socket = io();

    fetch('/api/chain')
      .then(r => r.json())
      .then(data => handleChainUpdate(data.chain, data.tampered))
      .catch(e => console.error('초기 체인 로드 실패', e));

    socket.on('connect', () => console.log('🔗 Socket.IO 연결 완료'));
    socket.on('chain_update', ({ chain, tampered }) =>
      handleChainUpdate(chain, tampered)
    );
    socket.on('new_block', b => {
      if (b.index > maxRenderedIndex) {
        createBlock(b);
        maxRenderedIndex = b.index;
        if (['blocked','차단됨'].includes(b.data.status)) loadBlocked();
      }
    });
  } catch (e) {
    console.warn('Socket.IO 연결 실패', e);
  }
}

// -------------------------------------
// MITM 토글 버튼 핸들러
// -------------------------------------
async function toggleMitm() {
  try {
    const url = mitmEnabled ? '/api/mitm/pause' : '/api/mitm/resume';
    const resp = await fetch(url, { method: 'POST' });
    const json = await resp.json();
    if (resp.ok) {
      mitmEnabled = json.mitm_enabled;
      document.getElementById('mitmToggle').textContent = `MITM 모드: ${mitmEnabled ? 'ON' : 'OFF'}`;
    } else {
      alert('MITM 토글에 실패했습니다.');
    }
  } catch {
    alert('통신 에러 발생');
  }
}

// -------------------------------------
// 복구 버튼 핸들러
// -------------------------------------
function bindRecover() {
  const btn = document.getElementById('btnRecover');
  if (!btn) return;
  btn.onclick = () => {
    fetch('/api/mitm/pause', { method: 'POST' })
      .finally(() => {
        mitmEnabled = false;
        document.getElementById('mitmToggle').textContent = `MITM 모드: OFF`;
      });

    fetch('/api/recover', { method: 'POST' })
      .then(async r => {
        if (!r.ok) throw new Error('복구 실패');
        await r.json();
      })
      .then(() => {
        console.log('복구 완료');
        firstLoad = true;
        return fetch('/api/chain');
      })
      .then(r => r.json())
      .then(data => handleChainUpdate(data.chain, data.tampered))
      .catch(e => {
        console.error('복구 실패', e);
        alert('복구 중 오류가 발생했습니다.');
      });
  };
}

// -------------------------------------
// DOMContentLoaded 리스너
// -------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindAddUser();
  loadUsers();
  loadBlocked();
  initSocket();

  const mitmBtn = document.getElementById('mitmToggle');
  if (mitmBtn) {
    mitmBtn.textContent = `MITM 모드: OFF`;
    mitmBtn.onclick = toggleMitm;
  }

  bindRecover();
});
