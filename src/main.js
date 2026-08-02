import './style.css'
import * as fb from './firebase.js'

// ---------------------------------------------------------------------------
// 確認ダイアログ (<dialog> ベース)
// ---------------------------------------------------------------------------
function showConfirm({ icon = '❓', title = '確認', message = 'よろしいですか？', okLabel = '✅ 確認', cancelLabel = '❌ キャンセル' } = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog')
    document.getElementById('confirm-icon').textContent = icon
    document.getElementById('confirm-title').textContent = title
    document.getElementById('confirm-message').textContent = message
    const okBtn = document.getElementById('confirm-ok-btn')
    const cancelBtn = document.getElementById('confirm-cancel-btn')
    okBtn.textContent = okLabel
    cancelBtn.textContent = cancelLabel

    dialog.showModal()

    let settled = false
    const cleanup = () => {
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      dialog.removeEventListener('close', onNativeClose)
      observer.disconnect()
    }
    const onOk = () => {
      if (settled) return
      settled = true
      cleanup()
      dialog.close()
      resolve(true)
    }
    const onCancel = () => {
      if (settled) return
      settled = true
      cleanup()
      dialog.close()
      resolve(false)
    }
    // Escキーなどネイティブな閉じ方をした場合もPromiseを確実に解決する(キャンセル扱い)。
    // ブラウザによっては 'close' イベントが発火しないことがあるため、
    // open属性の変化をMutationObserverでも監視して確実にフォールバックする。
    const onNativeClose = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(false)
    }
    dialog.addEventListener('close', onNativeClose)
    const observer = new MutationObserver(() => {
      if (!dialog.open) onNativeClose()
    })
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] })

    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
  })
}

// ---------------------------------------------------------------------------
// 盤面定数
// ---------------------------------------------------------------------------
const GRID_SIZE = 9
const BUILDING_POSITIONS = []
for (let y = 0; y < GRID_SIZE; y++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    if (x % 2 === 0 && y % 2 === 0) BUILDING_POSITIONS.push({ x, y })
  }
}

function isBuilding(x, y) { return x % 2 === 0 && y % 2 === 0 }
function isRoad(x, y) { return !isBuilding(x, y) }
function isIntersection(x, y) { return x % 2 === 1 && y % 2 === 1 }

// ---------------------------------------------------------------------------
// アプリ状態
// ---------------------------------------------------------------------------
function freshGameState(mode) {
  return {
    round: 1,
    turn: 'police',
    gameMode: mode, // 'human' | 'ai' | 'online'
    isGameStarted: true,
    criminalPosition: null,
    criminalTraces: [],
    helicopters: [
      { id: 0, x: null, y: null },
      { id: 1, x: null, y: null },
      { id: 2, x: null, y: null }
    ],
    selectedHelicopter: null,
    discoveredTraces: [],
    gameOver: false,
    winner: null,
    resultMessage: '',
    xrayMode: false,
    showPrediction: false,
    phase: 'setup',
    helicoptersPlaced: 0,
    helicoptersActioned: []
  }
}

let gameState = freshGameState('human')
gameState.isGameStarted = false

const online = {
  roomId: null,
  myRole: null,
  hostRole: null,
  unsubscribe: null
}

let currentScreen = 'title'

function toArray(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return Object.values(v)
  return []
}

function normalizeState(raw) {
  const base = freshGameState(raw.gameMode ?? 'online')
  return {
    ...base,
    ...raw,
    criminalTraces: toArray(raw.criminalTraces),
    discoveredTraces: toArray(raw.discoveredTraces),
    helicoptersActioned: toArray(raw.helicoptersActioned),
    helicopters: (Array.isArray(raw.helicopters) ? raw.helicopters : base.helicopters).map((h, i) => ({
      id: h?.id ?? i,
      x: h?.x ?? null,
      y: h?.y ?? null
    })),
    criminalPosition: raw.criminalPosition ?? null,
    selectedHelicopter: raw.selectedHelicopter ?? null
  }
}

// ---------------------------------------------------------------------------
// 画面切り替え
// ---------------------------------------------------------------------------
function showScreen(name) {
  currentScreen = name
  document.getElementById('screen-title').hidden = name !== 'title'
  document.getElementById('screen-lobby').hidden = name !== 'lobby'
  document.getElementById('screen-game').hidden = name !== 'game'

  document.getElementById('quit-game-btn').hidden = name !== 'game'
  document.getElementById('hud-readout').hidden = !(name === 'game' && gameState.gameMode === 'online')
}

// ---------------------------------------------------------------------------
// オンライン同期
// ---------------------------------------------------------------------------
function isOnline() {
  return gameState.gameMode === 'online'
}

function activeRole() {
  return gameState.phase === 'setup' ? 'police' : gameState.turn
}

function canAct() {
  if (!isOnline()) return true
  if (gameState.gameOver) return false
  return online.myRole === activeRole()
}

function serializeForSync() {
  const { xrayMode, showPrediction, ...rest } = gameState
  return rest
}

function syncIfOnline() {
  if (!isOnline() || !online.roomId) return
  fb.pushState(online.roomId, serializeForSync()).catch((err) => {
    addLog(`❌ 同期に失敗しました: ${err.message}`, 'error')
  })
}

function applyRemoteState(remote) {
  if (!remote) return
  const normalized = normalizeState(remote)
  const { xrayMode, showPrediction } = gameState // 個人的な表示切替はローカル専用、同期しない
  gameState = { ...normalized, xrayMode, showPrediction }
}

function handleRoomUpdate(room) {
  if (!room) return

  if (room.status === 'waiting') {
    return
  }

  applyRemoteState(room.state)

  if (currentScreen !== 'game') {
    showScreen('game')
    initBoard()
    document.getElementById('online-role-banner').hidden = false
    document.getElementById('online-role-label').textContent =
      online.myRole === 'police' ? 'あなたは警察です 🚁' : 'あなたは犯人です 🚗'
  }

  updateUI()

  const modal = document.getElementById('game-over-modal')
  if (gameState.gameOver && !modal.open) {
    showGameOverModal(gameState.winner, gameState.resultMessage)
  }
}

// ---------------------------------------------------------------------------
// ルール系ヘルパー
// ---------------------------------------------------------------------------
function getValidCriminalMoves() {
  if (!gameState.criminalPosition) return BUILDING_POSITIONS

  return [
    { x: gameState.criminalPosition.x - 2, y: gameState.criminalPosition.y },
    { x: gameState.criminalPosition.x + 2, y: gameState.criminalPosition.y },
    { x: gameState.criminalPosition.x, y: gameState.criminalPosition.y - 2 },
    { x: gameState.criminalPosition.x, y: gameState.criminalPosition.y + 2 }
  ].filter(pos =>
    pos.x >= 0 && pos.x < GRID_SIZE &&
    pos.y >= 0 && pos.y < GRID_SIZE &&
    isBuilding(pos.x, pos.y) &&
    !gameState.criminalTraces.some(t => t.x === pos.x && t.y === pos.y)
  )
}

function getValidHelicopterMoves(heliId) {
  const heli = gameState.helicopters[heliId]
  const directions = [{ dx: 2, dy: 0 }, { dx: -2, dy: 0 }, { dx: 0, dy: 2 }, { dx: 0, dy: -2 }]
  return directions
    .map(dir => ({ x: heli.x + dir.dx, y: heli.y + dir.dy }))
    .filter(pos =>
      pos.x >= 0 && pos.x < GRID_SIZE && pos.y >= 0 && pos.y < GRID_SIZE &&
      isRoad(pos.x, pos.y) &&
      !gameState.helicopters.some(h => h.x === pos.x && h.y === pos.y)
    )
}

function getSearchableBuildings(heliId) {
  const heli = gameState.helicopters[heliId]
  return [
    { x: heli.x - 1, y: heli.y - 1 },
    { x: heli.x + 1, y: heli.y - 1 },
    { x: heli.x - 1, y: heli.y + 1 },
    { x: heli.x + 1, y: heli.y + 1 }
  ].filter(pos => pos.x >= 0 && pos.x < GRID_SIZE && pos.y >= 0 && pos.y < GRID_SIZE && isBuilding(pos.x, pos.y))
}

// ---------------------------------------------------------------------------
// 盤面描画
// ---------------------------------------------------------------------------
function initBoard() {
  const board = document.getElementById('game-board')
  board.innerHTML = ''
  board.className = 'board'
  board.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`
  board.style.gridTemplateRows = `repeat(${GRID_SIZE}, 1fr)`

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (isBuilding(x, y)) {
        // ビルは他の要素を重ねないので実 <button> にできる。
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.dataset.x = x
        cell.dataset.y = y
        cell.className = 'cell cell--building'
        cell.setAttribute('aria-label', `ビル (${x}, ${y})`)
        cell.innerHTML = '<span class="cell__icon">🏢</span>'
        cell.addEventListener('click', () => handleBuildingClick(x, y))
        board.appendChild(cell)
      } else {
        // 道路はヘリコプター(実<button>)を重ねて描画するため、
        // 入れ子<button>を避けて role="button" の<div>にする。
        const cell = document.createElement('div')
        cell.dataset.x = x
        cell.dataset.y = y
        cell.className = 'cell cell--road'
        cell.setAttribute('role', 'button')
        cell.setAttribute('tabindex', '0')
        cell.setAttribute('aria-label', `道路 (${x}, ${y})`)
        cell.addEventListener('click', () => handleRoadClick(x, y))
        cell.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          handleRoadClick(x, y)
        })
        board.appendChild(cell)
      }
    }
  }

  renderHelicopters()
  renderTraces()
  updateVisualFeedback()
}

function updateVisualFeedback() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('is-move', 'is-search', 'is-xray', 'is-trace-ghost', 'is-heli-move', 'is-heli-slot')
  })

  if (!gameState.isGameStarted || gameState.gameOver) return

  const myCriminalView = isOnline() ? online.myRole === 'criminal' : gameState.gameMode !== 'ai'

  if (gameState.turn === 'criminal' && myCriminalView) {
    if (gameState.showPrediction) {
      getValidCriminalMoves().forEach(pos => {
        document.querySelector(`[data-x="${pos.x}"][data-y="${pos.y}"]`)?.classList.add('is-move')
      })
    }

    if (gameState.xrayMode) {
      gameState.criminalTraces.forEach(trace => {
        const cell = document.querySelector(`[data-x="${trace.x}"][data-y="${trace.y}"]`)
        if (!cell) return
        const isCurrent = gameState.criminalPosition &&
          trace.x === gameState.criminalPosition.x && trace.y === gameState.criminalPosition.y
        cell.classList.add(isCurrent ? 'is-xray' : 'is-trace-ghost')
      })
      getValidCriminalMoves().forEach(pos => {
        document.querySelector(`[data-x="${pos.x}"][data-y="${pos.y}"]`)?.classList.add('is-move')
      })
    }
  }

  if (gameState.turn === 'police' && gameState.selectedHelicopter !== null) {
    getSearchableBuildings(gameState.selectedHelicopter).forEach(pos => {
      document.querySelector(`[data-x="${pos.x}"][data-y="${pos.y}"]`)?.classList.add('is-search')
    })
    getValidHelicopterMoves(gameState.selectedHelicopter).forEach(pos => {
      document.querySelector(`[data-x="${pos.x}"][data-y="${pos.y}"]`)?.classList.add('is-heli-move')
    })
  }

  if (gameState.phase === 'setup' && gameState.turn === 'police') {
    for (let y = 1; y < GRID_SIZE; y += 2) {
      for (let x = 1; x < GRID_SIZE; x += 2) {
        if (!gameState.helicopters.some(h => h.x === x && h.y === y)) {
          document.querySelector(`[data-x="${x}"][data-y="${y}"]`)?.classList.add('is-heli-slot')
        }
      }
    }
  }
}

function renderHelicopters() {
  document.querySelectorAll('.heli').forEach(el => el.remove())

  gameState.helicopters.forEach(heli => {
    if (heli.x === null || heli.y === null) return
    const cell = document.querySelector(`[data-x="${heli.x}"][data-y="${heli.y}"]`)
    if (!cell) return

    const isSelected = gameState.selectedHelicopter === heli.id
    const isActioned = gameState.helicoptersActioned.includes(heli.id)

    const heliEl = document.createElement('button')
    heliEl.type = 'button'
    heliEl.className = `heli${isSelected ? ' is-selected' : ''}${isActioned ? ' is-done' : ''}`
    heliEl.setAttribute('aria-label', `ヘリコプター${heli.id + 1}${isSelected ? '(選択中)' : ''}${isActioned ? '(行動済み)' : ''}`)
    heliEl.textContent = '🚁'
    heliEl.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!canAct()) return
      if (gameState.turn === 'police' && !gameState.gameOver && !isActioned) {
        gameState.selectedHelicopter = heli.id
        renderHelicopters()
        updateVisualFeedback()
        addLog(`🚁 ヘリ${heli.id + 1}を選択`, 'police')
        syncIfOnline()
      } else if (isActioned) {
        addLog(`❌ ヘリ${heli.id + 1}は今ターン既に行動済みです`, 'error')
      }
    })
    cell.appendChild(heliEl)
  })
}

function selectNextHelicopter() {
  const nextHeli = gameState.helicopters.find(h => !gameState.helicoptersActioned.includes(h.id))
  if (nextHeli) {
    gameState.selectedHelicopter = nextHeli.id
    renderHelicopters()
    updateVisualFeedback()
    addLog(`🚁 ヘリ${nextHeli.id + 1}を操作してください（移動または調査）`, 'police')
    syncIfOnline()
  }
}

function onHelicopterActioned(heliId) {
  if (!gameState.helicoptersActioned.includes(heliId)) {
    gameState.helicoptersActioned.push(heliId)
  }

  if (gameState.helicoptersActioned.length >= 3) {
    endTurn()
  } else {
    gameState.selectedHelicopter = null
    updateUI()
    syncIfOnline()
    setTimeout(() => selectNextHelicopter(), 300)
  }
}

function renderTraces() {
  document.querySelectorAll('.trace-chip').forEach(el => el.remove())
  gameState.discoveredTraces.forEach(trace => {
    const cell = document.querySelector(`[data-x="${trace.x}"][data-y="${trace.y}"]`)
    if (!cell) return
    const chip = document.createElement('div')
    chip.className = 'trace-chip'
    chip.textContent = String(trace.round)
    cell.appendChild(chip)
  })
}

// ---------------------------------------------------------------------------
// クリック処理
// ---------------------------------------------------------------------------
function handleBuildingClick(x, y) {
  if (!gameState.isGameStarted || gameState.gameOver || !canAct()) return

  const criminalIsHumanControlled = isOnline() ? online.myRole === 'criminal' : gameState.gameMode === 'human'
  if (gameState.turn === 'criminal' && criminalIsHumanControlled) {
    moveCriminalToBuilding(x, y)
  } else if (gameState.turn === 'police') {
    searchBuilding(x, y)
  }
}

function handleRoadClick(x, y) {
  if (!gameState.isGameStarted || gameState.gameOver || !canAct()) return

  if (gameState.phase === 'setup' && gameState.turn === 'police') {
    if (gameState.helicoptersPlaced < 3) {
      if (!isIntersection(x, y)) {
        addLog('❌ ヘリコプターは交差点にのみ配置できます', 'error')
        return
      }
      if (gameState.helicopters.some(h => h.x === x && h.y === y)) {
        addLog('❌ すでにヘリコプターが配置されています', 'error')
        return
      }

      const heli = gameState.helicopters[gameState.helicoptersPlaced]
      heli.x = x
      heli.y = y
      gameState.helicoptersPlaced++

      addLog(`🚁 ヘリ${gameState.helicoptersPlaced}を配置しました`, 'police')
      renderHelicopters()
      syncIfOnline()

      if (gameState.helicoptersPlaced === 3) {
        addLog('❓ 3機配置完了。この配置でよいか確認してください', 'police')
        showConfirm({
          icon: '🚁',
          title: 'ヘリ配置の確認',
          message: 'この配置でゲームを開始しますか？\n「キャンセル」で配置をやり直せます。',
          okLabel: '✅ これで開始',
          cancelLabel: '🔄 やり直す'
        }).then(confirmed => {
          if (confirmed) {
            gameState.phase = 'play'
            addLog('✅ 配置完了。犯人のターンから開始します', 'success')
            syncIfOnline()
            setTimeout(() => {
              gameState.turn = 'criminal'
              updateUI()
              syncIfOnline()
              if (gameState.gameMode === 'ai') aiCriminalMove()
            }, 500)
          } else {
            gameState.helicoptersPlaced = 0
            gameState.helicopters.forEach(h => { h.x = null; h.y = null })
            addLog('🔄 配置をリセットしました。再度配置してください', 'police')
            renderHelicopters()
            updateUI()
            updateVisualFeedback()
            syncIfOnline()
          }
        })
      } else {
        updateUI()
        updateVisualFeedback()
      }
    }
    return
  }

  if (gameState.turn === 'police' && gameState.selectedHelicopter === null) {
    addLog('❌ ヘリコプターを選択してください', 'error')
    return
  }

  if (gameState.turn === 'police' && gameState.selectedHelicopter !== null) {
    const heli = gameState.helicopters[gameState.selectedHelicopter]
    const dx = Math.abs(x - heli.x)
    const dy = Math.abs(y - heli.y)

    if ((dx === 2 && dy === 0) || (dx === 0 && dy === 2)) {
      if (gameState.helicopters.some(h => h.x === x && h.y === y)) {
        addLog('❌ 他のヘリコプターがいます', 'error')
        return
      }
      heli.x = x
      heli.y = y
      renderHelicopters()
      addLog(`🚁 ヘリ${heli.id + 1}が移動しました`, 'police')
      syncIfOnline()
      setTimeout(() => onHelicopterActioned(heli.id), 500)
    } else {
      addLog('❌ 1マス飛ばして移動する必要があります', 'error')
    }
  }
}

function moveCriminalToBuilding(x, y) {
  if (!isBuilding(x, y)) {
    addLog('❌ ビルにのみ移動できます', 'error')
    return
  }

  if (!gameState.criminalPosition) {
    const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`)
    cell?.classList.add('is-xray')
    showConfirm({
      icon: '🚗',
      title: '犯人の初期配置',
      message: 'このビルに隠れますか？',
      okLabel: '✅ ここに隠れる',
      cancelLabel: '❌ やり直す'
    }).then(confirmed => {
      cell?.classList.remove('is-xray')
      if (confirmed) {
        gameState.criminalPosition = { x, y }
        gameState.criminalTraces.push({ x, y, round: gameState.round })
        addLog(`🚗 犯人が配置されました (ラウンド${gameState.round})`, 'criminal')
        endTurn()
      }
    })
    return
  }

  const validMoves = getValidCriminalMoves()
  if (validMoves.length === 0) {
    endGame('police', '犯人が包囲されました!')
    return
  }

  const dx = Math.abs(x - gameState.criminalPosition.x)
  const dy = Math.abs(y - gameState.criminalPosition.y)

  if ((dx === 2 && dy === 0) || (dx === 0 && dy === 2)) {
    if (gameState.criminalTraces.some(t => t.x === x && t.y === y)) {
      addLog('❌ 移動できません(痕跡あり)', 'error')
      return
    }

    const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`)
    cell?.classList.add('is-xray')
    showConfirm({
      icon: '🚗',
      title: '移動の確認',
      message: 'このビルに移動しますか？',
      okLabel: '✅ ここに移動',
      cancelLabel: '❌ キャンセル'
    }).then(confirmed => {
      cell?.classList.remove('is-xray')
      if (confirmed) {
        gameState.criminalPosition = { x, y }
        gameState.criminalTraces.push({ x, y, round: gameState.round })
        addLog(`🚗 犯人が移動しました (ラウンド${gameState.round})`, 'criminal')
        endTurn()
      }
    })
  } else {
    addLog('❌ 隣接するビルにのみ移動できます', 'error')
  }
}

function aiCriminalMove() {
  if (!gameState.criminalPosition) {
    const randomBuilding = BUILDING_POSITIONS[Math.floor(Math.random() * BUILDING_POSITIONS.length)]
    gameState.criminalPosition = { x: randomBuilding.x, y: randomBuilding.y }
    gameState.criminalTraces.push({ ...gameState.criminalPosition, round: gameState.round })
    addLog(`🚗 犯人が配置されました (ラウンド${gameState.round})`, 'criminal')
    endTurn()
    return
  }

  const adjacentBuildings = getValidCriminalMoves()
  if (adjacentBuildings.length === 0) {
    endGame('police', '犯人が包囲されました!')
    return
  }

  const newPos = adjacentBuildings[Math.floor(Math.random() * adjacentBuildings.length)]
  gameState.criminalPosition = newPos
  gameState.criminalTraces.push({ ...newPos, round: gameState.round })
  addLog(`🚗 犯人が移動しました (ラウンド${gameState.round})`, 'criminal')
  endTurn()
}

function searchBuilding(x, y) {
  if (!isBuilding(x, y)) {
    addLog('❌ ビルのみ調査できます', 'error')
    return
  }
  if (gameState.selectedHelicopter === null) {
    addLog('❌ ヘリコプターを選択してください', 'error')
    return
  }

  const heli = gameState.helicopters[gameState.selectedHelicopter]
  const adjacentBuildings = [
    { x: heli.x - 1, y: heli.y - 1 }, { x: heli.x + 1, y: heli.y - 1 },
    { x: heli.x - 1, y: heli.y + 1 }, { x: heli.x + 1, y: heli.y + 1 }
  ]
  if (!adjacentBuildings.some(b => b.x === x && b.y === y)) {
    addLog('❌ 隣接するビルのみ調査できます', 'error')
    return
  }

  const searchCell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`)
  searchCell?.classList.add('is-search')
  showConfirm({
    icon: '🔍',
    title: 'ビル調査の確認',
    message: `ヘリ${heli.id + 1}でこのビルを調査しますか？`,
    okLabel: '✅ 調査する',
    cancelLabel: '❌ キャンセル'
  }).then(confirmed => {
    searchCell?.classList.remove('is-search')
    if (!confirmed) return

    if (gameState.criminalPosition && gameState.criminalPosition.x === x && gameState.criminalPosition.y === y) {
      endGame('police', '犯人の車を発見しました!')
      return
    }

    const trace = gameState.criminalTraces.find(t => t.x === x && t.y === y)
    if (trace && !gameState.discoveredTraces.some(d => d.x === x && d.y === y)) {
      gameState.discoveredTraces.push(trace)
      renderTraces()
      addLog(`🔍 痕跡を発見! (ラウンド${trace.round})`, 'success')
      document.getElementById('traces-found').textContent = gameState.discoveredTraces.length
    } else {
      addLog('🔍 何も見つかりませんでした', 'info')
    }

    const heliId = gameState.selectedHelicopter
    syncIfOnline()
    setTimeout(() => onHelicopterActioned(heliId), 500)
  })
}

function endTurn() {
  if (gameState.turn === 'criminal') {
    gameState.xrayMode = false
    const xrayBtn = document.getElementById('xray-btn')
    xrayBtn?.setAttribute('aria-pressed', 'false')
    gameState.turn = 'police'
    gameState.selectedHelicopter = null
    gameState.helicoptersActioned = []
    updateUI()
    addLog('🚁 警察のターンです。ヘリ1から順番に操作してください', 'police')
    syncIfOnline()
    setTimeout(() => selectNextHelicopter(), 300)
  } else {
    gameState.turn = 'criminal'
    gameState.round++
    gameState.helicoptersActioned = []

    if (gameState.round > 11) {
      endGame('criminal', '犯人が逃げ切りました!')
      return
    }

    updateUI()
    addLog(`--- ラウンド ${gameState.round} ---`, 'info')
    syncIfOnline()

    if (gameState.gameMode === 'ai') {
      setTimeout(() => aiCriminalMove(), 1000)
    }
  }
}

// ---------------------------------------------------------------------------
// UI更新
// ---------------------------------------------------------------------------
function updateUI() {
  document.getElementById('round-display').textContent = `${gameState.round}/11`

  const turnDisplay = document.getElementById('turn-display')
  turnDisplay.textContent = gameState.turn === 'criminal' ? '犯人' : '警察'
  turnDisplay.classList.toggle('is-criminal', gameState.turn === 'criminal')
  turnDisplay.classList.toggle('is-police', gameState.turn === 'police')

  let statusText = ''
  if (gameState.phase === 'setup') {
    statusText = `ヘリコプターを配置中 (${gameState.helicoptersPlaced}/3)`
  } else {
    statusText = gameState.turn === 'criminal' ? 'ビルをクリック' : '道路をクリック'
  }
  document.getElementById('turn-status').textContent = statusText

  const criminalPanel = document.getElementById('criminal-panel')
  const policePanel = document.getElementById('police-panel')
  const xrayBtn = document.getElementById('xray-btn')
  const predictBtn = document.getElementById('predict-btn')

  if (isOnline()) {
    const iAmActive = online.myRole === activeRole()
    criminalPanel.hidden = !(iAmActive && gameState.turn === 'criminal')
    policePanel.hidden = !(iAmActive && gameState.turn === 'police')
    xrayBtn.hidden = criminalPanel.hidden
    predictBtn.hidden = criminalPanel.hidden

    const turnLabel = document.getElementById('online-turn-label')
    if (turnLabel) turnLabel.textContent = iAmActive ? 'あなたの番です' : '相手の番です（待機中）'
  } else if (gameState.turn === 'criminal' && gameState.gameMode === 'human') {
    criminalPanel.hidden = false
    policePanel.hidden = true
    xrayBtn.hidden = false
    predictBtn.hidden = false
  } else if (gameState.turn === 'police') {
    criminalPanel.hidden = true
    policePanel.hidden = false
    xrayBtn.hidden = true
    predictBtn.hidden = true
  } else {
    criminalPanel.hidden = true
    policePanel.hidden = true
    xrayBtn.hidden = true
    predictBtn.hidden = true
  }

  document.getElementById('traces-found').textContent = gameState.discoveredTraces.length

  renderHelicopters()
  renderTraces()
  updateVisualFeedback()
}

function showGameOverModal(winner, message) {
  document.getElementById('winner-text').textContent = winner === 'police' ? '🚁 警察の勝利!' : '🚗 犯人の勝利!'
  document.getElementById('game-over-message').textContent = message
  document.getElementById('restart-btn').hidden = isOnline()
  const modal = document.getElementById('game-over-modal')
  if (!modal.open) modal.showModal()
}

function endGame(winner, message) {
  gameState.gameOver = true
  gameState.winner = winner
  gameState.resultMessage = message
  updateUI()
  showGameOverModal(winner, message)
  addLog(`🎉 ゲーム終了: ${message}`, 'success')
  syncIfOnline()
}

function addLog(message, type = 'info') {
  const log = document.getElementById('game-log')
  const entry = document.createElement('div')
  entry.className = `log-entry log-entry--${type}`
  entry.textContent = message
  log.appendChild(entry)
  log.scrollTop = log.scrollHeight
}

// ---------------------------------------------------------------------------
// ローカル対戦 (human / ai) の開始
// ---------------------------------------------------------------------------
function startLocalGame(mode) {
  gameState = freshGameState(mode)
  online.roomId = null
  online.myRole = null

  document.getElementById('online-role-banner').hidden = true
  document.getElementById('game-log').innerHTML = ''

  showScreen('game')
  initBoard()
  updateUI()
  addLog('🎮 ゲーム開始!', 'success')
  addLog('🚁 警察のターン: 道路をクリックしてヘリコプターを3台配置してください', 'police')
}

// ---------------------------------------------------------------------------
// オンライン対戦: ロビー
// ---------------------------------------------------------------------------
let selectedHostRole = 'police'

function initLobbyUI() {
  const rolePicker = document.getElementById('role-picker')
  rolePicker.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedHostRole = btn.dataset.role
      rolePicker.querySelectorAll('.role-btn').forEach(b => b.setAttribute('aria-pressed', String(b === btn)))
    })
  })

  document.getElementById('create-room-btn').addEventListener('click', async () => {
    const btn = document.getElementById('create-room-btn')
    btn.disabled = true
    try {
      const initialState = freshGameState('online')
      const { roomId, role } = await fb.createRoom(selectedHostRole, initialState)
      online.roomId = roomId
      online.myRole = role
      online.hostRole = selectedHostRole
      gameState = initialState

      document.getElementById('create-room-result').hidden = false
      document.getElementById('room-code-value').textContent = roomId
      document.getElementById('lobby-status-host').textContent = '対戦相手の参加を待っています…'

      online.unsubscribe?.()
      online.unsubscribe = fb.subscribeRoom(roomId, handleRoomUpdate)
    } catch (err) {
      alert(`部屋の作成に失敗しました: ${err.message}`)
    } finally {
      btn.disabled = false
    }
  })

  document.getElementById('join-room-btn').addEventListener('click', async () => {
    const input = document.getElementById('join-room-input')
    const errorEl = document.getElementById('join-room-error')
    errorEl.hidden = true
    const code = input.value.trim()

    if (!/^\d{6}$/.test(code)) {
      errorEl.textContent = '6桁の数字コードを入力してください。'
      errorEl.hidden = false
      return
    }

    const btn = document.getElementById('join-room-btn')
    btn.disabled = true
    try {
      const { roomId, role } = await fb.joinRoom(code)
      online.roomId = roomId
      online.myRole = role

      online.unsubscribe?.()
      online.unsubscribe = fb.subscribeRoom(roomId, handleRoomUpdate)
    } catch (err) {
      errorEl.textContent = err.message
      errorEl.hidden = false
    } finally {
      btn.disabled = false
    }
  })

  document.getElementById('lobby-back-btn').addEventListener('click', () => {
    cleanupOnlineSession()
    showScreen('title')
  })
}

function cleanupOnlineSession() {
  online.unsubscribe?.()
  online.unsubscribe = null
  if (online.roomId && online.myRole) {
    fb.leaveRoom(online.roomId, online.myRole)
  }
  online.roomId = null
  online.myRole = null
  online.hostRole = null
  document.getElementById('create-room-result').hidden = true
  document.getElementById('join-room-input').value = ''
}

// ---------------------------------------------------------------------------
// 起動時の配線
// ---------------------------------------------------------------------------
function init() {
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode
      if (mode === 'online') {
        showScreen('lobby')
      } else {
        startLocalGame(mode)
      }
    })
  })

  initLobbyUI()

  document.getElementById('quit-game-btn').addEventListener('click', () => {
    showConfirm({
      icon: '🚪',
      title: 'ゲームを終了しますか？',
      message: '現在のゲームを終了してタイトルに戻ります。\n進行状況は失われます。',
      okLabel: '🚪 終了する',
      cancelLabel: '▶️ 続ける'
    }).then(confirmed => {
      if (!confirmed) return
      cleanupOnlineSession()
      const modal = document.getElementById('game-over-modal')
      if (modal.open) modal.close()
      addLog('🚪 ゲームを終了しました', 'info')
      showScreen('title')
    })
  })

  const xrayBtn = document.getElementById('xray-btn')
  xrayBtn.addEventListener('click', () => {
    gameState.xrayMode = !gameState.xrayMode
    xrayBtn.setAttribute('aria-pressed', String(gameState.xrayMode))
    updateVisualFeedback()
    addLog(gameState.xrayMode ? '👁️ 透視モードON' : '👁️ 透視モードOFF', 'criminal')
  })

  const predictBtn = document.getElementById('predict-btn')
  predictBtn.addEventListener('click', () => {
    gameState.showPrediction = !gameState.showPrediction
    predictBtn.setAttribute('aria-pressed', String(gameState.showPrediction))
    updateVisualFeedback()
    addLog(gameState.showPrediction ? '💡 予測モードON' : '💡 予測モードOFF', 'criminal')
  })

  document.getElementById('restart-btn').addEventListener('click', () => {
    document.getElementById('game-over-modal').close()
    startLocalGame(gameState.gameMode)
  })

  document.getElementById('modal-title-btn').addEventListener('click', () => {
    document.getElementById('game-over-modal').close()
    cleanupOnlineSession()
    showScreen('title')
  })

  showScreen('title')
}

init()
