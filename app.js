console.log('▶️ app.js loaded');

let userMap = {};

document.addEventListener('DOMContentLoaded', () => {
  bindAddUser();
  loadUsers();
  loadBlocked();
  loadChain().then(initSocket).catch(console.error);
});

function bindAddUser() {
  document.getElementById('addUser').onclick = async () => {
    const uid = document.getElementById('uid').value.trim();
    const username = document.getElementById('username').value.trim();
    if (!uid || !username) return alert('UID와 이름을 모두 입력하세요.');
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ uid, username })
    });
    if (res.ok) {
      document.getElementById('uid').value = '';
      document.getElementById('username').value = '';
      loadUsers();
    } else {
      const err = await res.json();
      alert(err.error || '등록 실패');
    }
  };
}

async function loadUsers() {
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
      const res = await fetch(`/api/users/${uid}`, { method: 'DELETE' });
      if (res.ok) loadUsers();
      else alert('삭제 실패');
    };
  });
}

async function loadBlocked() {
  const ul = document.getElementById('blockedList');
  const arr = await fetch('/api/blocked').then(r => r.json());
  if (arr.length === 0) {
    ul.innerHTML = '<li>차단된 UID가 없습니다.</li>';
    return;
  }
  ul.innerHTML = '';
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
      await fetch(`/api/blocked/${uid}`, { method: 'DELETE' });
      loadBlocked();
    };
  });
}

async function loadChain() {
  ['chain-user','chain-open','chain-closed'].forEach(id =>
    document.getElementById(id).innerHTML = ''
  );
  const data = await fetch('/chain').then(r => r.json());
  data.chain.forEach(createBlock);
}

function initSocket() {
  const socket = io();
  socket.on('new_block', b => {
    createBlock(b);
    if (b.data.status === 'blocked' || b.data.status === '차단됨') {
      loadBlocked();
    }
  });
}

function createBlock(b) {
  let st = b.data.status;
  const statusMap = { registered:'정상', unregistered:'미등록', blocked:'차단됨' };
  if (statusMap[st]) st = statusMap[st];

  // 블록에 저장된 username 우선, 없으면 userMap
  const uname = b.data.username ?? (userMap[b.data.uid] || '-');

  let cid, cls, ico, title;
  if (b.index === 0) {
    cid='chain-user'; cls='block block-genesis'; ico='fa-cubes'; title='Genesis';
  } else if (Array.isArray(b.data)) {
    b.data.forEach(tx => createBlock({ index:b.index, data:tx, timestamp:tx.timestamp }));
    return;
  } else if (st==='open') {
    cid='chain-open'; cls='block block-open'; ico='fa-door-open'; title='문 열림';
  } else if (st==='closed') {
    cid='chain-closed'; cls='block block-closed'; ico='fa-door-closed'; title='문 닫힘';
  } else {
    cid='chain-user';
    if (st==='정상')      { cls='block block-normal'; ico='fa-check-circle'; title='정상'; }
    else if (st==='미등록'){ cls='block block-unreg'; ico='fa-exclamation-triangle'; title='미등록'; }
    else                  { cls='block block-blocked'; ico='fa-ban'; title='차단됨'; }
  }

  const ts = b.data.timestamp || b.timestamp;
  const dt = new Date(ts*1000), ds = dt.toLocaleDateString(), tm = dt.toLocaleTimeString();

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
  document.getElementById(cid).appendChild(el);
  document.getElementById(cid).scrollLeft = document.getElementById(cid).scrollWidth;
  setTimeout(() => el.classList.remove('new'), 3000);
}
