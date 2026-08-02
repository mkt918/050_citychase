// Firebase オンライン対戦クライアント。
// Web設定値はプロジェクトの公開クライアントキーで、秘匿情報ではない
// （Realtime Database のセキュリティは database.rules.json 側で担保する）。
import { initializeApp } from 'firebase/app'
import { initializeAuth, inMemoryPersistence, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  runTransaction,
  onDisconnect,
  serverTimestamp
} from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyAU8xZvQPDPViFlyiO9uJ9fD4kkpA97zHA',
  authDomain: 'citychase-online.firebaseapp.com',
  databaseURL: 'https://citychase-online-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'citychase-online',
  storageBucket: 'citychase-online.firebasestorage.app',
  messagingSenderId: '354153627682',
  appId: '1:354153627682:web:d1ab6809a9198eb8e00a7b'
}

let app = null
let auth = null
let db = null
let authReadyPromise = null

function init() {
  if (app) return
  app = initializeApp(firebaseConfig)
  // 部屋コードで都度参加する一時的なセッションのため、IndexedDB/localStorageへの
  // 永続化は不要かつ複数タブ間でのIndexedDB競合(“Database is closing/hidden”)の
  // 原因になり得るため、タブ内メモリのみの永続化にする。
  auth = initializeAuth(app, { persistence: inMemoryPersistence })
  db = getDatabase(app)
}

// 匿名認証でサインインし、uidを返す。オンライン対戦の全操作の前提。
export function ensureSignedIn() {
  init()
  if (authReadyPromise) return authReadyPromise
  authReadyPromise = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsub()
          resolve(user.uid)
        }
      },
      reject
    )
    signInAnonymously(auth).catch(reject)
  })
  return authReadyPromise
}

function randomRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function otherRole(role) {
  return role === 'police' ? 'criminal' : 'police'
}

// 6桁のコードが空いているものを見つけて部屋を作成する。
// hostRole: ホストが担当する役割 ('police' | 'criminal')
// initialState: 新規ゲーム状態(シリアライズ可能なプレーンオブジェクト)
export async function createRoom(hostRole, initialState) {
  const uid = await ensureSignedIn()

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomRoomCode()
    const roomRef = ref(db, `rooms/${code}`)
    const result = await runTransaction(roomRef, (current) => {
      if (current !== null) return // 既存なら衝突、別コードで再試行
      return {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'waiting',
        hostRole,
        players: {
          [hostRole]: { uid, connected: true }
        },
        state: initialState
      }
    })

    if (result.committed) {
      onDisconnect(ref(db, `rooms/${code}/players/${hostRole}/connected`)).set(false)
      return { roomId: code, role: hostRole, uid }
    }
  }

  throw new Error('部屋の作成に失敗しました。もう一度お試しください。')
}

// 部屋コードで参加する。成功すると相手側と反対の役割が割り当てられる。
export async function joinRoom(code) {
  const uid = await ensureSignedIn()
  const roomRef = ref(db, `rooms/${code}`)
  const snap = await get(roomRef)

  if (!snap.exists()) {
    throw new Error('その部屋コードは見つかりませんでした。')
  }

  const room = snap.val()
  if (room.status !== 'waiting') {
    throw new Error('この部屋はすでに開始しているか、利用できません。')
  }

  const joinerRole = otherRole(room.hostRole)
  if (room.players && room.players[joinerRole]) {
    throw new Error('この部屋はすでに満員です。')
  }

  await update(roomRef, {
    [`players/${joinerRole}`]: { uid, connected: true },
    status: 'active',
    updatedAt: serverTimestamp()
  })

  onDisconnect(ref(db, `rooms/${code}/players/${joinerRole}/connected`)).set(false)
  return { roomId: code, role: joinerRole, uid }
}

// 部屋の変化を購読する。callback(roomDataOrNull) が呼ばれる。
// 戻り値は購読解除関数。
export function subscribeRoom(roomId, callback) {
  const roomRef = ref(db, `rooms/${roomId}`)
  return onValue(roomRef, (snap) => {
    callback(snap.exists() ? snap.val() : null)
  })
}

// ゲーム状態全体をFirebaseへ書き込む(行動確定時に呼ぶ)。
export function pushState(roomId, state) {
  return update(ref(db, `rooms/${roomId}`), {
    state,
    updatedAt: serverTimestamp()
  })
}

export function setRoomStatus(roomId, status) {
  return update(ref(db, `rooms/${roomId}`), { status, updatedAt: serverTimestamp() })
}

// 部屋を離脱する際、自分の接続フラグを落とす。
export async function leaveRoom(roomId, role) {
  if (!roomId || !role) return
  try {
    await set(ref(db, `rooms/${roomId}/players/${role}/connected`), false)
  } catch {
    // 回線切断時など失敗しても無視して良い(onDisconnectが後追いで反映する)
  }
}
