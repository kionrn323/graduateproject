#!/usr/bin/env python3
import os
import json
import shutil
import threading
import time
import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
from blockchain import Blockchain, Block
from transaction import Transaction

# ─── 경로 설정 ────────────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR   = os.path.join(BASE_DIR, 'static')

CHAIN_FILE   = os.path.join(STATIC_DIR, 'chain_data.json')
BACKUP_FILE  = os.path.join(STATIC_DIR, 'backup_chain.json')
USERS_FILE   = os.path.join(BASE_DIR, 'users_data.json')

# ─── Flask 앱 초기화 ───────────────────────────────────────────────────────
app = Flask(
    __name__,
    template_folder=TEMPLATE_DIR,
    static_folder=STATIC_DIR,
    static_url_path='/static'
)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# ─── 블록체인, P2P, 메모리풀, 차단 UID 저장 ───────────────────────────────
blockchain   = Blockchain(difficulty=2)
NODES        = set()
mempool      = []
blocked_uids = set()

# ─── 체인 저장/로드 ────────────────────────────────────────────────────────
def save_chain_to_disk():
    os.makedirs(STATIC_DIR, exist_ok=True)
    with open(CHAIN_FILE, 'w', encoding='utf-8') as f:
        json.dump([b.__dict__ for b in blockchain.chain], f, ensure_ascii=False, indent=2)
    shutil.copy2(CHAIN_FILE, BACKUP_FILE)

def load_chain_from_disk():
    if os.path.exists(CHAIN_FILE) and os.path.getsize(CHAIN_FILE) > 0:
        with open(CHAIN_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        blockchain.chain.clear()
        for blk in data:
            b = Block(blk['index'], blk['timestamp'], blk['data'], blk['previous_hash'])
            b.nonce, b.hash = blk['nonce'], blk['hash']
            blockchain.chain.append(b)
    else:
        blockchain.create_genesis_block()
        save_chain_to_disk()

# ─── P2P 노드 관리 ────────────────────────────────────────────────────────
@app.route('/register_node', methods=['POST'])
def register_node():
    peers = request.json.get('nodes', [])
    for p in peers:
        NODES.add(p)
    return jsonify({'all_nodes': list(NODES)}), 201

# ─── 체인 조회 ─────────────────────────────────────────────────────────────
@app.route('/chain', methods=['GET'])
def get_chain():
    return jsonify({
        'length': len(blockchain.chain),
        'chain':  [b.__dict__ for b in blockchain.chain]
    }), 200

# ─── 사용자 관리 ───────────────────────────────────────────────────────────
@app.route('/api/users', methods=['GET', 'POST'])
def users():
    if request.method == 'GET':
        try:
            with open(USERS_FILE, 'r', encoding='utf-8') as f:
                users = json.load(f)
        except FileNotFoundError:
            users = {}
        return jsonify([{'uid': u, 'username': n} for u, n in users.items()])
    # POST
    body = request.json or {}
    uid, name = body.get('uid'), body.get('username')
    if not uid or not name:
        return jsonify({'error': 'uid와 username 필요'}), 400
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            users = json.load(f)
    except FileNotFoundError:
        users = {}
    if uid in users:
        return jsonify({'error': '이미 등록된 UID'}), 409
    users[uid] = name
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    return jsonify([{'uid': u, 'username': n} for u, n in users.items()]), 201

@app.route('/api/users/<uid>', methods=['DELETE'])
def del_user(uid):
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            users = json.load(f)
    except FileNotFoundError:
        users = {}
    users.pop(uid, None)
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    return jsonify([{'uid': u, 'username': n} for u, n in users.items()]), 200

# ─── 차단 목록 조회/해제 ────────────────────────────────────────────────────
@app.route('/api/blocked', methods=['GET'])
def get_blocked():
    return jsonify(sorted(blocked_uids)), 200

@app.route('/api/blocked/<uid>', methods=['DELETE'])
def unblock_uid(uid):
    blocked_uids.discard(uid)
    return jsonify(sorted(blocked_uids)), 200

# ─── 트랜잭션 수신 → 즉시 블록 생성 및 전파 ────────────────────────────────
@app.route('/api/new_transaction', methods=['POST'])
def new_transaction():
    data = request.json or {}
    if not all(k in data for k in ('uid', 'status', 'timestamp')):
        return jsonify({'error': 'uid, status, timestamp 필요'}), 400

    # 차단 상태라면 서버에도 기록
    if data['status'] in ('blocked', '차단됨'):
        blocked_uids.add(data['uid'])

    # 현재 등록된 사용자 이름 가져오기
    try:
        users = json.load(open(USERS_FILE, 'r', encoding='utf-8'))
        username = users.get(data['uid'])
    except:
        username = None

    # 트랜잭션 데이터에 username 필드 추가
    tx_dict = {
        'uid':       data['uid'],
        'status':    data['status'],
        'timestamp': data['timestamp'],
        'username':  username
    }

    last = blockchain.last_block()
    new_blk = Block(last.index + 1, data['timestamp'], tx_dict, last.hash)
    proof = blockchain.proof_of_work(new_blk)
    blockchain.add_block(new_blk, proof)
    save_chain_to_disk()

    # P2P 전파
    for peer in NODES:
        try:
            requests.post(
                f'http://{peer}/api/add_block',
                json={'block': new_blk.__dict__, 'proof': proof},
                timeout=2
            )
        except:
            pass

    socketio.emit('new_block', {
        'index':     new_blk.index,
        'data':      new_blk.data,
        'timestamp': new_blk.timestamp
    })
    return jsonify({'message': '블록 생성 완료'}), 201

# ─── 피어로부터 블록 수신 ─────────────────────────────────────────────────
@app.route('/api/add_block', methods=['POST'])
def p2p_add_block():
    data = request.json or {}
    blk, proof = data.get('block'), data.get('proof')
    if not blk or proof is None:
        return jsonify({'error': 'block 및 proof 필요'}), 400
    b = Block(blk['index'], blk['timestamp'], blk['data'], blk['previous_hash'])
    b.nonce, b.hash = blk['nonce'], blk['hash']
    if not blockchain.add_block(b, proof):
        return jsonify({'message': 'rejected'}), 400
    save_chain_to_disk()
    socketio.emit('new_block', {
        'index':     b.index,
        'data':      b.data,
        'timestamp': b.timestamp
    })
    return jsonify({'message': 'added'}), 201

# ─── 합의: 더 긴 체인으로 교체 ─────────────────────────────────────────────
@app.route('/api/nodes/resolve', methods=['GET'])
def consensus():
    replaced, max_len, new_chain = False, len(blockchain.chain), None
    for peer in NODES:
        try:
            r = requests.get(f'http://{peer}/chain', timeout=2).json()
            length, chain_data = r['length'], r['chain']
            if length > max_len and blockchain.is_chain_valid():
                replaced, max_len, new_chain = True, length, chain_data
        except:
            pass
    if replaced:
        blockchain.chain.clear()
        for blk in new_chain:
            b = Block(blk['index'], blk['timestamp'], blk['data'], blk['previous_hash'])
            b.nonce, b.hash = blk['nonce'], blk['hash']
            blockchain.chain.append(b)
        save_chain_to_disk()
    return jsonify({
        'replaced': replaced,
        'chain':    [b.__dict__ for b in blockchain.chain]
    }), 200

# ─── 루트: templates/index.html 제공 ───────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(TEMPLATE_DIR, 'index.html')

# ─── 백그라운드 루프: 마이닝 & 합의 ───────────────────────────────────────
def mine_loop():
    while True:
        if mempool:
            txs = [tx for tx in mempool]
            mempool.clear()
            last = blockchain.last_block()
            new_blk = Block(last.index + 1, time.time(), txs, last.hash)
            proof = blockchain.proof_of_work(new_blk)
            blockchain.add_block(new_blk, proof)
            save_chain_to_disk()
            for peer in NODES:
                try:
                    requests.post(
                        f'http://{peer}/api/add_block',
                        json={'block': new_blk.__dict__, 'proof': proof},
                        timeout=2
                    )
                except:
                    pass
            socketio.emit('new_block', {
                'index':     new_blk.index,
                'data':      new_blk.data,
                'timestamp': new_blk.timestamp
            })
        time.sleep(10)

def consensus_loop(port):
    while True:
        try:
            requests.get(f'http://localhost:{port}/api/nodes/resolve', timeout=2)
        except:
            pass
        time.sleep(10)

if __name__ == '__main__':
    load_chain_from_disk()
    threading.Thread(target=mine_loop, daemon=True).start()
    threading.Thread(target=consensus_loop, args=(5000,), daemon=True).start()
    print("🌐 Server listening on 0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
