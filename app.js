// -------------------------------------
// 스크립트 로드 확인
// -------------------------------------
console.log('▶️ A-node app.js loaded');

let userMap = {};
let maxRenderedIndex = -1;
let firstLoad = true;
let mitmEnabled = false;

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
        body: JSON.stringify({ uid, username })
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
      li.innerHTML = `<span>${u.uid} → ${u.username}</span><span class="delete-x" data-uid="${u.uid}">×</span>`;
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
      li.innerHTML = `<span>${uid}</span><span class="delete-x" data-uid="${uid}">×</span>`;
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

  let cid = 'chain-user', cls = 'block', ico = 'fa-cubes', title = '';
  if (b.index === 0) {
    cls += ' block-genesis'; title = 'Genesis';
  } else if (b.data.status === 'open') {
    cid = 'chain-open'; cls += ' block-open'; ico = 'fa-door-open'; title = '문 열림';
  } else if (b.data.status === 'closed') {
    cid = 'chain-closed'; cls += ' block-closed'; ico = 'fa-door-closed'; title = '문 닫힘';
  } else {
    cls += ' block-normal'; ico = 'fa-check-circle'; title = '등록';
  }

  const dt = new Date((b.data.timestamp || b.timestamp) * 1000);
  const ds = dt.toLocaleDateString(), tm = dt.toLocaleTimeString();

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
    </div>`;
  const container = document.getElementById(cid);
  container.appendChild(el);
  container.scrollLeft = container.scrollWidth;
  setTimeout(() => el.classList.remove('new'), 3000);
}

// -------------------------------------
// 화면 초기화
// -------------------------------------
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
  // 1) 전체 빨간 강조 토글
  document.body.classList.toggle('tampered', tampered);

  // 2) 경광등 + 사이렌 제어
  const light = document.getElementById('alarmLight');
  const siren = document.getElementById('sirenAudio');
  if (tampered) {
    light.classList.remove('hidden');
    // ★ siren.src 가 HTML에서 지정되어 있지 않다면 JS에서 지정
    if (siren && !siren.src.includes('/static/siren.mp3')) {
      siren.src = '/static/siren.mp3'; // ★ 수정됨
    }
    siren.currentTime = 0;
    siren.play().catch(() => {});
  } else {
    light.classList.add('hidden');
    siren.pause();
    siren.currentTime = 0;
  }

  // 3) 블록 렌더링
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
    // ★ 명시적으로 A-노드 서버로 연결하도록 변경됨
    const socket = io('http://127.0.0.1:5006', {
      transports: ['websocket'], // 웹소켓 전용
      upgrade: false             // 폴링 방지
    });

    // 초기 체인 로드
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
      const btn = document.getElementById('mitmToggle');
      btn.textContent = `MITM 모드: ${mitmEnabled ? 'ON' : 'OFF'}`;
      console.log(`🔄 MITM 토글 → ${mitmEnabled}`);
    } else {
      console.error('MITM 토글 실패', json);
      alert('MITM 토글에 실패했습니다.');
    }
  } catch (err) {
    console.error('MITM 토글 에러', err);
    alert('통신 에러 발생');
  }
}

// -------------------------------------
// DOMContentLoaded 리스너
// -------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindAddUser();
  loadUsers();
  loadBlocked();
  initSocket();

  // MITM 버튼 초기화
  const mitmBtn = document.getElementById('mitmToggle');
  if (mitmBtn) {
    mitmBtn.textContent = `MITM 모드: OFF`;
    mitmBtn.onclick = toggleMitm;
  }
});
