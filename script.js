const BOARD_SIZE = 5;
const CHOICE_COUNT = 3;

const ASSETS = {
  basePath: "./assets",
  tiles: {
    farm: "farm.png",
    bakery: "bakery.png",
    tavern: "tavern.png",
    dog: "dog.png",
  },
  loaded: {},
};

const TILE_DEFS = {
  farm: { label: "Farm" },
  bakery: { label: "Bakery" },
  tavern: { label: "Tavern" },
  dog: { label: "Dog" },
};

const gameState = {
  phase: "start",
  turn: 0,
  resources: {
    wheat: 0,
    bread: 0,
    happiness: 0,
  },
  board: createEmptyBoard(),
  choices: [],
  selectedChoice: null,
  message: "ゲーム開始でターンを始めます。",
  tavernActiveStreak: 0,
  winner: null,
};

const dom = {
  hud: document.getElementById("hud"),
  board: document.getElementById("board"),
  phaseText: document.getElementById("phaseText"),
  messageText: document.getElementById("messageText"),
  choiceButtons: document.getElementById("choiceButtons"),
  startButton: document.getElementById("startButton"),
};

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => ({
    type: null,
    efficiency: 1,
    activeStreak: 0,
    producedLastTurn: false,
    producedThisTurn: 0,
  }));
}

function initialize() {
  loadAssets().then(() => {
    bindEvents();
    render();
  });
}

function bindEvents() {
  dom.startButton.addEventListener("click", () => {
    update({ type: "START_GAME" });
    render();
  });

  dom.choiceButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-choice]");
    if (!button) return;
    update({ type: "SELECT_CHOICE", choice: button.dataset.choice });
    render();
  });

  dom.board.addEventListener("click", (event) => {
    const cell = event.target.closest("button[data-index]");
    if (!cell) return;
    update({ type: "PLACE_TILE", index: Number(cell.dataset.index) });
    render();
  });
}

function loadAssets() {
  const keys = Object.keys(ASSETS.tiles);
  const loaders = keys.map((key) => loadImageWithFallback(key, `${ASSETS.basePath}/${ASSETS.tiles[key]}`));
  return Promise.all(loaders);
}

function loadImageWithFallback(key, src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      ASSETS.loaded[key] = { ok: true, image, src };
      resolve();
    };
    image.onerror = () => {
      ASSETS.loaded[key] = { ok: false, image: null, src };
      resolve();
    };
    image.src = src;
  });
}

function update(action) {
  switch (action.type) {
    case "START_GAME": {
      gameState.phase = "playing";
      gameState.turn = 1;
      gameState.resources = { wheat: 0, bread: 0, happiness: 0 };
      gameState.board = createEmptyBoard();
      gameState.selectedChoice = null;
      gameState.tavernActiveStreak = 0;
      gameState.winner = null;
      gameState.choices = drawChoices();
      gameState.message = "タイル候補を選んで配置してください。";
      return;
    }
    case "SELECT_CHOICE": {
      if (gameState.phase !== "playing") return;
      if (!gameState.choices.includes(action.choice)) return;
      gameState.selectedChoice = action.choice;
      gameState.message = `${TILE_DEFS[action.choice].label} を選択中。配置先をクリックしてください。`;
      return;
    }
    case "PLACE_TILE": {
      if (gameState.phase !== "playing") return;
      if (!gameState.selectedChoice) {
        gameState.message = "先に候補タイルを選んでください。";
        return;
      }
      if (!isPlaceable(action.index)) {
        gameState.message = "そのマスには配置できません。";
        return;
      }
      placeTile(action.index, gameState.selectedChoice);
      executeProductionPhase();
      applyDecayPhase();
      updateWinCondition();
      if (gameState.phase === "playing") {
        gameState.turn += 1;
        gameState.choices = drawChoices();
        gameState.selectedChoice = null;
        gameState.message = "次のターンです。候補から1つ選んで配置してください。";
      }
      return;
    }
    default:
      return;
  }
}

function drawChoices() {
  const pool = Object.keys(TILE_DEFS);
  const picks = [];
  while (picks.length < CHOICE_COUNT) {
    const choice = pool[Math.floor(Math.random() * pool.length)];
    picks.push(choice);
  }
  return picks;
}

function isPlaceable(index) {
  const cell = gameState.board[index];
  return cell && cell.type === null;
}

function placeTile(index, type) {
  gameState.board[index] = {
    type,
    efficiency: 1,
    activeStreak: 0,
    producedLastTurn: false,
    producedThisTurn: 0,
  };
}

function executeProductionPhase() {
  resetTurnProductionFlags();
  produceFarms();
  produceBakeries();
  const happinessProduced = produceTaverns();
  gameState.tavernActiveStreak = happinessProduced > 0 ? gameState.tavernActiveStreak + 1 : 0;
}

function resetTurnProductionFlags() {
  gameState.board.forEach((cell) => {
    cell.producedThisTurn = 0;
  });
}

function produceFarms() {
  forEachTileOfType("farm", (cell, index) => {
    const multiplier = getProductionMultiplier(cell);
    if (multiplier <= 0) {
      markInactive(cell);
      return;
    }
    const streak = cell.producedLastTurn ? cell.activeStreak + 1 : 1;
    cell.activeStreak = streak;
    const base = streak >= 2 ? 2 : 1;
    const boost = getDogBoost(index);
    const amount = (base + boost) * multiplier;

    gameState.resources.wheat += amount;
    cell.producedThisTurn = amount;
    cell.producedLastTurn = true;
  });
}

function produceBakeries() {
  forEachTileOfType("bakery", (cell, index) => {
    const multiplier = getProductionMultiplier(cell);
    if (multiplier <= 0) {
      markInactive(cell);
      return;
    }
    const maxConversions = (1 + getDogBoost(index)) * multiplier;
    const conversions = Math.min(maxConversions, Math.floor(gameState.resources.wheat / 2));
    if (conversions <= 0) {
      markInactive(cell);
      return;
    }
    gameState.resources.wheat -= conversions * 2;
    gameState.resources.bread += conversions;
    markActive(cell, conversions);
  });
}

function produceTaverns() {
  let total = 0;
  forEachTileOfType("tavern", (cell, index) => {
    const multiplier = getProductionMultiplier(cell);
    if (multiplier <= 0) {
      markInactive(cell);
      return;
    }
    const maxConversions = (1 + getDogBoost(index)) * multiplier;
    const conversions = Math.min(maxConversions, gameState.resources.bread);
    if (conversions <= 0) {
      markInactive(cell);
      return;
    }
    gameState.resources.bread -= conversions;
    gameState.resources.happiness += conversions;
    total += conversions;
    markActive(cell, conversions);
  });
  return total;
}

function applyDecayPhase() {
  gameState.board.forEach((cell) => {
    if (!cell.type || cell.type === "dog") return;
    if (cell.producedThisTurn > 0) {
      cell.efficiency = 1;
    } else {
      cell.efficiency = Math.max(0, cell.efficiency - 1);
    }
  });
}

function updateWinCondition() {
  if (gameState.tavernActiveStreak >= 3) {
    gameState.phase = "gameover";
    gameState.winner = "player";
    gameState.message = "勝利！ Tavern が3ターン連続で happiness を生産しました。";
  }
}

function getProductionMultiplier(cell) {
  return cell.efficiency > 0 ? 1 : 0;
}

function getDogBoost(index) {
  const neighbors = getOrthogonalNeighbors(index);
  return neighbors.reduce((count, neighborIndex) => {
    const neighbor = gameState.board[neighborIndex];
    return count + (neighbor.type === "dog" ? 1 : 0);
  }, 0);
}

function getOrthogonalNeighbors(index) {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const out = [];
  if (row > 0) out.push(index - BOARD_SIZE);
  if (row < BOARD_SIZE - 1) out.push(index + BOARD_SIZE);
  if (col > 0) out.push(index - 1);
  if (col < BOARD_SIZE - 1) out.push(index + 1);
  return out;
}

function forEachTileOfType(type, handler) {
  gameState.board.forEach((cell, index) => {
    if (cell.type === type) {
      handler(cell, index);
    }
  });
}

function markInactive(cell) {
  cell.producedLastTurn = false;
  cell.activeStreak = 0;
  cell.producedThisTurn = 0;
}

function markActive(cell, amount) {
  const wasActive = cell.producedLastTurn;
  cell.producedLastTurn = true;
  cell.activeStreak = wasActive ? cell.activeStreak + 1 : 1;
  cell.producedThisTurn = amount;
}

function render() {
  renderHud();
  renderControls();
  renderChoices();
  renderBoard();
}

function renderHud() {
  const stats = [
    `Turn: ${gameState.turn}`,
    `Phase: ${gameState.phase}`,
    `Wheat: ${gameState.resources.wheat}`,
    `Bread: ${gameState.resources.bread}`,
    `Happiness: ${gameState.resources.happiness}`,
  ];
  dom.hud.innerHTML = stats.map((text) => `<div class="stat">${text}</div>`).join("");
}

function renderControls() {
  dom.phaseText.textContent = `現在フェーズ: ${gameState.phase}`;
  dom.messageText.textContent = gameState.message;
  dom.startButton.disabled = gameState.phase === "playing";
}

function renderChoices() {
  dom.choiceButtons.innerHTML = "";
  if (gameState.phase !== "playing") return;

  gameState.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `choice-btn ${gameState.selectedChoice === choice ? "selected" : ""}`;
    btn.dataset.choice = choice;
    btn.textContent = TILE_DEFS[choice].label;
    dom.choiceButtons.appendChild(btn);
  });
}

function renderBoard() {
  dom.board.innerHTML = "";
  gameState.board.forEach((cell, index) => {
    const cellButton = document.createElement("button");
    cellButton.type = "button";
    cellButton.className = `cell ${cell.type ? "filled" : ""}`;
    cellButton.dataset.index = String(index);

    if (!cell.type) {
      cellButton.innerHTML = `<span class="placeholder">(${index}) Empty</span>`;
      dom.board.appendChild(cellButton);
      return;
    }

    const header = document.createElement("div");
    header.className = "tile-header";
    header.innerHTML = `<strong>${TILE_DEFS[cell.type].label}</strong><span>Eff ${cell.efficiency}</span>`;

    const visual = renderTileVisual(cell.type);

    const footer = document.createElement("div");
    footer.className = "tile-footer";
    footer.textContent = `Turn Prod: ${cell.producedThisTurn}`;

    cellButton.appendChild(header);
    cellButton.appendChild(visual);
    cellButton.appendChild(footer);
    dom.board.appendChild(cellButton);
  });
}

function renderTileVisual(type) {
  const visual = document.createElement("div");
  visual.className = "tile-visual";

  const asset = ASSETS.loaded[type];
  if (asset && asset.ok) {
    const image = document.createElement("img");
    image.src = asset.src;
    image.alt = `${type} tile`;
    visual.appendChild(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder";
    placeholder.textContent = `${type.toUpperCase()} (no image)`;
    visual.appendChild(placeholder);
  }
  return visual;
}

initialize();
