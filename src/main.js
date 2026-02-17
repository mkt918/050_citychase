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
    { id: 1, x: 3, y: 1 },
    { id: 2, x: 1, y: 3 }
  ],
  selectedHelicopter: 0,
  policeMode: 'move', // 'move' or 'search'
  discoveredTraces: [],
  gameOver: false
}

// グリッドサイズ (5x5のビル = 6x6の交差点)
const GRID_SIZE = 6
const BUILDING_SIZE = 5

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
      
      // ビル(建物)のセル
      if (x < BUILDING_SIZE && y < BUILDING_SIZE) {
        cell.className += ' bg-gradient-to-br from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 transition-all cursor-pointer'
        cell.innerHTML = `
          <div class="w-full h-full flex items-center justify-center">
            <div class="building-icon text-4xl opacity-50">🏢</div>
          </div>
        `
        cell.addEventListener('click', () => handleBuildingClick(x, y))
      } else {
        // 交差点のセル
        cell.className += ' bg-slate-900/30'
        cell.addEventListener('click', () => handleIntersectionClick(x, y))
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
      heliEl.className = 'helicopter absolute inset-0 flex items-center justify-center pointer-events-none'
      heliEl.innerHTML = `
        <div class="text-5xl animate-pulse ${gameState.selectedHelicopter === heli.id ? 'scale-125' : ''}">
          🚁
        </div>
      `
      cell.appendChild(heliEl)
    }
  })
}

// 痕跡チップ描画
function renderTraces() {
  document.querySelectorAll('.trace-chip').forEach(el => el.remove())
  
  gameState.discoveredTraces.forEach(trace => {
    const cell = document.querySelector(`[data-x="${trace.x}"][data-y="${trace.y}"]`)
    if (cell) {
      const traceEl = document.createElement('div')
      traceEl.className = 'trace-chip absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold'
      
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
  
  if (gameState.turn === 'police' && gameState.policeMode === 'search') {
    searchBuilding(x, y)
  }
}

// 交差点クリック処理
function handleIntersectionClick(x, y) {
  if (!gameState.isGameStarted || gameState.gameOver) return
  
  if (gameState.turn === 'police' && gameState.policeMode === 'move') {
    moveHelicopter(x, y)
  }
}

// 犯人の移動
function moveCriminal(direction) {
  if (!gameState.criminalPosition) {
    // 初回:ランダムな位置に配置
    gameState.criminalPosition = {
      x: Math.floor(Math.random() * BUILDING_SIZE),
      y: Math.floor(Math.random() * BUILDING_SIZE)
    }
  } else {
    const newPos = { ...gameState.criminalPosition }
    
    switch(direction) {
      case 'up': newPos.y--; break
      case 'down': newPos.y++; break
      case 'left': newPos.x--; break
      case 'right': newPos.x++; break
    }
    
    // 範囲チェック
    if (newPos.x < 0 || newPos.x >= BUILDING_SIZE || newPos.y < 0 || newPos.y >= BUILDING_SIZE) {
      addLog('❌ 移動できません(範囲外)', 'error')
      return
    }
    
    // 既に痕跡がある場所には移動できない
    if (gameState.criminalTraces.some(t => t.x === newPos.x && t.y === newPos.y)) {
      addLog('❌ 移動できません(痕跡あり)', 'error')
      return
    }
    
    gameState.criminalPosition = newPos
  }
  
  // 痕跡を配置
  gameState.criminalTraces.push({
    x: gameState.criminalPosition.x,
    y: gameState.criminalPosition.y,
    round: gameState.round
  })
  
  addLog(`🚗 犯人が移動しました (ラウンド${gameState.round})`, 'criminal')
  endTurn()
}

// AIの犯人移動
function aiCriminalMove() {
  const directions = ['up', 'down', 'left', 'right']
  const validMoves = []
  
  if (!gameState.criminalPosition) {
    // 初回配置
    moveCriminal('up') // ダミー方向(実際はランダム配置)
    return
  }
  
  // 有効な移動方向を探す
  directions.forEach(dir => {
    const newPos = { ...gameState.criminalPosition }
    switch(dir) {
      case 'up': newPos.y--; break
      case 'down': newPos.y++; break
      case 'left': newPos.x--; break
      case 'right': newPos.x++; break
    }
    
    if (newPos.x >= 0 && newPos.x < BUILDING_SIZE && 
        newPos.y >= 0 && newPos.y < BUILDING_SIZE &&
        !gameState.criminalTraces.some(t => t.x === newPos.x && t.y === newPos.y)) {
      validMoves.push(dir)
    }
  })
  
  if (validMoves.length === 0) {
    // 移動不可能 → 警察の勝利
    endGame('police', '犯人が包囲されました!')
    return
  }
  
  // ランダムに移動
  const randomDir = validMoves[Math.floor(Math.random() * validMoves.length)]
  moveCriminal(randomDir)
}

// ヘリコプター移動
function moveHelicopter(x, y) {
  const heli = gameState.helicopters[gameState.selectedHelicopter]
  
  // 隣接チェック(縦横のみ)
  const dx = Math.abs(x - heli.x)
  const dy = Math.abs(y - heli.y)
  
  if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
    // 他のヘリコプターがいないかチェック
    if (gameState.helicopters.some(h => h.x === x && h.y === y)) {
      addLog('❌ 他のヘリコプターがいます', 'error')
      return
    }
    
    heli.x = x
    heli.y = y
    renderHelicopters()
    addLog(`🚁 ヘリ${heli.id + 1}が移動しました`, 'police')
    
    // 全ヘリコプターが行動完了したかチェック
    checkPoliceActionComplete()
  } else {
    addLog('❌ 隣接するマスにのみ移動できます', 'error')
  }
}

// ビル調査
function searchBuilding(x, y) {
  const heli = gameState.helicopters[gameState.selectedHelicopter]
  
  // 隣接4マスのビルかチェック
  const adjacentBuildings = [
    { x: heli.x - 1, y: heli.y - 1 },
    { x: heli.x, y: heli.y - 1 },
    { x: heli.x - 1, y: heli.y },
    { x: heli.x, y: heli.y }
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
  
  checkPoliceActionComplete()
}

// 警察の行動完了チェック
function checkPoliceActionComplete() {
  // 簡易実装:1回の行動で次のターンへ
  setTimeout(() => endTurn(), 500)
}

// ターン終了
function endTurn() {
  if (gameState.turn === 'criminal') {
    gameState.turn = 'police'
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
    
    // AIモードの場合、自動で犯人を移動
    if (gameState.gameMode === 'ai') {
      setTimeout(() => aiCriminalMove(), 1000)
    }
  }
}

// UI更新
function updateUI() {
  document.getElementById('round-display').textContent = gameState.round
  document.getElementById('turn-display').textContent = gameState.turn === 'criminal' ? '犯人' : '警察'
  document.getElementById('turn-status').textContent = gameState.turn === 'criminal' ? '移動中...' : '捜査中...'
  
  // パネル表示切り替え
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
  
  document.getElementById('game-log').innerHTML = ''
  document.getElementById('traces-found').textContent = '0'
  
  initBoard()
  updateUI()
  addLog('🎮 ゲーム開始!', 'success')
  addLog('🚗 犯人のターンです', 'criminal')
  
  if (gameState.gameMode === 'ai') {
    setTimeout(() => aiCriminalMove(), 1000)
  }
})

// 犯人の移動ボタン
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const direction = btn.dataset.dir
    moveCriminal(direction)
  })
})

// 警察モード切り替え
document.getElementById('move-mode-btn').addEventListener('click', () => {
  gameState.policeMode = 'move'
  addLog('📍 移動モードに切り替えました', 'police')
})

document.getElementById('search-mode-btn').addEventListener('click', () => {
  gameState.policeMode = 'search'
  addLog('🔍 調査モードに切り替えました', 'police')
})

// ヘリコプター選択
document.getElementById('helicopter-select').addEventListener('change', (e) => {
  gameState.selectedHelicopter = parseInt(e.target.value)
  renderHelicopters()
  addLog(`🚁 ヘリ${gameState.selectedHelicopter + 1}を選択しました`, 'police')
})

// リスタート
document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('game-over-modal').classList.add('hidden')
  document.getElementById('game-over-modal').classList.remove('flex')
  document.getElementById('start-game-btn').click()
})

// 初期ボード表示
initBoard()
