import './style.css'

// ゲーム状態管理
const gameState = {
  round: 1,
  turn: 'criminal', // 'criminal' or 'police'
  gameMode: 'human', // 'human' or 'ai'
  isGameStarted: false,
  criminalPosition: null,
  criminalTraces: [], // {x, y, round}の配列
  helicopters: [
    { id: 0, x: 1, y: 1 },
    { id: 1, x: 7, y: 1 },
    { id: 2, x: 1, y: 7 }
  ],
  selectedHelicopter: null,
  policeMode: 'move', // 'move' or 'search'
  discoveredTraces: [],
  gameOver: false,
  draggedHelicopter: null
}

// グリッドサイズ: 9x9 (ビル5x5 + 道路4x4が交互配置)
const GRID_SIZE = 9
const BUILDING_POSITIONS = [] // ビルの座標リスト
const ROAD_POSITIONS = [] // 道路の座標リスト

// ビルと道路の座標を事前計算
for (let y = 0; y < GRID_SIZE; y++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    // 偶数行・偶数列 = ビル
    if (x % 2 === 0 && y % 2 === 0) {
      BUILDING_POSITIONS.push({ x, y })
    } else {
      ROAD_POSITIONS.push({ x, y })
    }
  }
}

// 座標がビルかどうか判定
function isBuilding(x, y) {
  return x % 2 === 0 && y % 2 === 0
}

// 座標が交差点(道路)かどうか判定
function isRoad(x, y) {
  return !isBuilding(x, y)
}

// ゲームボード初期化
function initBoard() {
  const board = document.getElementById('game-board')
  board.innerHTML = ''

  // グリッドコンテナ
  const gridContainer = document.createElement('div')
  gridContainer.className = 'grid gap-0 w-full h-full'
  gridContainer.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`
  gridContainer.style.gridTemplateRows = `repeat(${GRID_SIZE}, 1fr)`

  // グリッドセルを生成
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = document.createElement('div')
      cell.className = 'relative border border-white/10'
      cell.dataset.x = x
      cell.dataset.y = y

      if (isBuilding(x, y)) {
        // ビル(建物)のセル
        cell.className += ' bg-gradient-to-br from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 transition-all cursor-pointer'
        cell.innerHTML = `
          <div class="w-full h-full flex items-center justify-center">
            <div class="building-icon text-3xl opacity-50">🏢</div>
          </div>
        `
        cell.addEventListener('click', () => handleBuildingClick(x, y))
      } else {
        // 道路のセル
        cell.className += ' bg-slate-900/30 hover:bg-slate-800/40 transition-all'
        cell.addEventListener('click', () => handleRoadClick(x, y))

        // ドロップ可能エリア
        cell.addEventListener('dragover', (e) => {
          e.preventDefault()
          if (gameState.draggedHelicopter !== null) {
            cell.classList.add('bg-blue-500/20')
          }
        })

        cell.addEventListener('dragleave', () => {
          cell.classList.remove('bg-blue-500/20')
        })

        cell.addEventListener('drop', (e) => {
          e.preventDefault()
          cell.classList.remove('bg-blue-500/20')
          handleHelicopterDrop(x, y)
        })
      }

      gridContainer.appendChild(cell)
    }
  }

  board.appendChild(gridContainer)
  renderHelicopters()
}

// ヘリコプター描画
function renderHelicopters() {
  // 既存のヘリコプターを削除
  document.querySelectorAll('.helicopter').forEach(el => el.remove())

  gameState.helicopters.forEach(heli => {
    const cell = document.querySelector(`[data-x="${heli.x}"][data-y="${heli.y}"]`)
    if (cell) {
      const heliEl = document.createElement('div')
      heliEl.className = 'helicopter absolute inset-0 flex items-center justify-center z-10'
      heliEl.draggable = gameState.turn === 'police' && !gameState.gameOver
      heliEl.dataset.heliId = heli.id

      const isSelected = gameState.selectedHelicopter === heli.id
      heliEl.innerHTML = `
        <div class="text-4xl cursor-move transition-transform ${isSelected ? 'scale-125 drop-shadow-lg' : 'hover:scale-110'}">
          🚁
        </div>
      `

      // ドラッグイベント
      heliEl.addEventListener('dragstart', (e) => {
        if (gameState.turn === 'police' && !gameState.gameOver) {
          gameState.draggedHelicopter = heli.id
          gameState.selectedHelicopter = heli.id
          e.dataTransfer.effectAllowed = 'move'
          heliEl.style.opacity = '0.5'
          addLog(`🚁 ヘリ${heli.id + 1}を選択`, 'police')
        }
      })

      heliEl.addEventListener('dragend', () => {
        heliEl.style.opacity = '1'
        gameState.draggedHelicopter = null
      })

      // クリックで選択
      heliEl.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameState.turn === 'police' && !gameState.gameOver) {
          gameState.selectedHelicopter = heli.id
          renderHelicopters()
          addLog(`🚁 ヘリ${heli.id + 1}を選択`, 'police')
        }
      })

      cell.appendChild(heliEl)
    }
  })
}

// ヘリコプタードロップ処理
function handleHelicopterDrop(x, y) {
  if (gameState.draggedHelicopter === null) return
  if (!gameState.isGameStarted || gameState.gameOver) return
  if (gameState.turn !== 'police') return

  const heli = gameState.helicopters[gameState.draggedHelicopter]

  // 道路かチェック
  if (!isRoad(x, y)) {
    addLog('❌ ヘリコプターは道路にのみ配置できます', 'error')
    return
  }

  // 隣接チェック(縦横のみ)
  const dx = Math.abs(x - heli.x)
  const dy = Math.abs(y - heli.y)

  if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
    // 他のヘリコプターがいないかチェック
    if (gameState.helicopters.some(h => h.x === x && h.y === y && h.id !== heli.id)) {
      addLog('❌ 他のヘリコプターがいます', 'error')
      return
    }

    heli.x = x
    heli.y = y
    renderHelicopters()
    addLog(`🚁 ヘリ${heli.id + 1}が移動しました`, 'police')

    setTimeout(() => endTurn(), 500)
  } else {
    addLog('❌ 隣接するマスにのみ移動できます', 'error')
  }
}

// 痕跡チップ描画
function renderTraces() {
  document.querySelectorAll('.trace-chip').forEach(el => el.remove())

  gameState.discoveredTraces.forEach(trace => {
    const cell = document.querySelector(`[data-x="${trace.x}"][data-y="${trace.y}"]`)
    if (cell) {
      const traceEl = document.createElement('div')
      traceEl.className = 'trace-chip absolute top-1 right-1 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-lg z-20'

      // ラウンドに応じた色
      if (trace.round === 1) {
        traceEl.className += ' bg-yellow-400 text-black'
      } else if (trace.round === 6) {
        traceEl.className += ' bg-red-500 text-white'
      } else {
        traceEl.className += ' bg-blue-500 text-white'
      }

      traceEl.textContent = trace.round
      cell.appendChild(traceEl)
    }
  })
}

// ビルクリック処理
function handleBuildingClick(x, y) {
  if (!gameState.isGameStarted || gameState.gameOver) return

  if (gameState.turn === 'criminal' && gameState.gameMode === 'human') {
    // 犯人の移動
    moveCriminalToBuilding(x, y)
  } else if (gameState.turn === 'police') {
    // 警察の調査
    searchBuilding(x, y)
  }
}

// 道路クリック処理
function handleRoadClick(x, y) {
  if (!gameState.isGameStarted || gameState.gameOver) return

  if (gameState.turn === 'police' && gameState.selectedHelicopter !== null) {
    // 選択中のヘリコプターを移動
    const heli = gameState.helicopters[gameState.selectedHelicopter]
    const dx = Math.abs(x - heli.x)
    const dy = Math.abs(y - heli.y)

    if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
      if (gameState.helicopters.some(h => h.x === x && h.y === y)) {
        addLog('❌ 他のヘリコプターがいます', 'error')
        return
      }

      heli.x = x
      heli.y = y
      renderHelicopters()
      addLog(`🚁 ヘリ${heli.id + 1}が移動しました`, 'police')
      setTimeout(() => endTurn(), 500)
    } else {
      addLog('❌ 隣接するマスにのみ移動できます', 'error')
    }
  }
}

// 犯人のビルへの移動
function moveCriminalToBuilding(x, y) {
  if (!isBuilding(x, y)) {
    addLog('❌ ビルにのみ移動できます', 'error')
    return
  }

  if (!gameState.criminalPosition) {
    // 初回配置
    gameState.criminalPosition = { x, y }
    gameState.criminalTraces.push({ x, y, round: gameState.round })
    addLog(`🚗 犯人が配置されました (ラウンド${gameState.round})`, 'criminal')
    endTurn()
    return
  }

  // 隣接チェック
  const dx = Math.abs(x - gameState.criminalPosition.x)
  const dy = Math.abs(y - gameState.criminalPosition.y)

  if ((dx === 2 && dy === 0) || (dx === 0 && dy === 2)) {
    // 既に痕跡がある場所には移動できない
    if (gameState.criminalTraces.some(t => t.x === x && t.y === y)) {
      addLog('❌ 移動できません(痕跡あり)', 'error')
      return
    }

    gameState.criminalPosition = { x, y }
    gameState.criminalTraces.push({ x, y, round: gameState.round })
    addLog(`🚗 犯人が移動しました (ラウンド${gameState.round})`, 'criminal')
    endTurn()
  } else {
    addLog('❌ 隣接するビルにのみ移動できます', 'error')
  }
}

// AIの犯人移動
function aiCriminalMove() {
  if (!gameState.criminalPosition) {
    // 初回:ランダムな位置に配置
    const randomBuilding = BUILDING_POSITIONS[Math.floor(Math.random() * BUILDING_POSITIONS.length)]
    gameState.criminalPosition = { x: randomBuilding.x, y: randomBuilding.y }
    gameState.criminalTraces.push({ ...gameState.criminalPosition, round: gameState.round })
    addLog(`🚗 犯人が配置されました (ラウンド${gameState.round})`, 'criminal')
    endTurn()
    return
  }

  // 隣接するビルを探す
  const adjacentBuildings = [
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

// ビル調査
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

  // 隣接4マスのビルかチェック
  const adjacentBuildings = [
    { x: heli.x - 1, y: heli.y - 1 },
    { x: heli.x + 1, y: heli.y - 1 },
    { x: heli.x - 1, y: heli.y + 1 },
    { x: heli.x + 1, y: heli.y + 1 }
  ]

  const isAdjacent = adjacentBuildings.some(b => b.x === x && b.y === y)

  if (!isAdjacent) {
    addLog('❌ 隣接するビルのみ調査できます', 'error')
    return
  }

  // 犯人の車を発見
  if (gameState.criminalPosition &&
    gameState.criminalPosition.x === x &&
    gameState.criminalPosition.y === y) {
    endGame('police', '犯人の車を発見しました!')
    return
  }

  // 痕跡を発見
  const trace = gameState.criminalTraces.find(t => t.x === x && t.y === y)
  if (trace && !gameState.discoveredTraces.some(d => d.x === x && d.y === y)) {
    gameState.discoveredTraces.push(trace)
    renderTraces()
    addLog(`🔍 痕跡を発見! (ラウンド${trace.round})`, 'success')
    document.getElementById('traces-found').textContent = gameState.discoveredTraces.length
  } else {
    addLog('🔍 何も見つかりませんでした', 'info')
  }

  setTimeout(() => endTurn(), 500)
}

// ターン終了
function endTurn() {
  if (gameState.turn === 'criminal') {
    gameState.turn = 'police'
    gameState.selectedHelicopter = null
    updateUI()
    addLog('🚁 警察のターンです', 'police')
  } else {
    gameState.turn = 'criminal'
    gameState.round++

    if (gameState.round > 11) {
      endGame('criminal', '犯人が逃げ切りました!')
      return
    }

    updateUI()
    addLog(`--- ラウンド ${gameState.round} ---`, 'info')

    if (gameState.gameMode === 'ai') {
      setTimeout(() => aiCriminalMove(), 1000)
    }
  }
}

// UI更新
function updateUI() {
  document.getElementById('round-display').textContent = gameState.round
  document.getElementById('turn-display').textContent = gameState.turn === 'criminal' ? '犯人' : '警察'
  document.getElementById('turn-status').textContent = gameState.turn === 'criminal' ? 'ビルをクリック' : 'ヘリをドラッグ'

  const criminalPanel = document.getElementById('criminal-panel')
  const policePanel = document.getElementById('police-panel')

  if (gameState.turn === 'criminal' && gameState.gameMode === 'human') {
    criminalPanel.classList.remove('hidden')
    policePanel.classList.add('hidden')
  } else if (gameState.turn === 'police') {
    criminalPanel.classList.add('hidden')
    policePanel.classList.remove('hidden')
  } else {
    criminalPanel.classList.add('hidden')
    policePanel.classList.add('hidden')
  }

  renderHelicopters()
}

// ゲーム終了
function endGame(winner, message) {
  gameState.gameOver = true
  document.getElementById('winner-text').textContent = winner === 'police' ? '🚁 警察の勝利!' : '🚗 犯人の勝利!'
  document.getElementById('game-over-message').textContent = message
  document.getElementById('game-over-modal').classList.remove('hidden')
  document.getElementById('game-over-modal').classList.add('flex')
  addLog(`🎉 ゲーム終了: ${message}`, 'success')
}

// ログ追加
function addLog(message, type = 'info') {
  const log = document.getElementById('game-log')
  const entry = document.createElement('div')

  const colors = {
    info: 'text-gray-300',
    success: 'text-green-400',
    error: 'text-red-400',
    criminal: 'text-red-300',
    police: 'text-blue-300'
  }

  entry.className = colors[type] || colors.info
  entry.textContent = message
  log.appendChild(entry)
  log.scrollTop = log.scrollHeight
}

// イベントリスナー
document.getElementById('start-game-btn').addEventListener('click', () => {
  gameState.gameMode = document.getElementById('game-mode').value
  gameState.isGameStarted = true
  gameState.round = 1
  gameState.turn = 'criminal'
  gameState.criminalPosition = null
  gameState.criminalTraces = []
  gameState.discoveredTraces = []
  gameState.gameOver = false
  gameState.selectedHelicopter = null

  document.getElementById('game-log').innerHTML = ''
  document.getElementById('traces-found').textContent = '0'

  initBoard()
  updateUI()
  addLog('🎮 ゲーム開始!', 'success')
  addLog('🚗 犯人のターン: ビルをクリックして配置', 'criminal')

  if (gameState.gameMode === 'ai') {
    setTimeout(() => aiCriminalMove(), 1000)
  }
})

// リスタート
document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('game-over-modal').classList.add('hidden')
  document.getElementById('game-over-modal').classList.remove('flex')
  document.getElementById('start-game-btn').click()
})

// 初期ボード表示
initBoard()
