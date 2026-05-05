import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const ROOM_ID = "default";
const ROLE_KEY = "quiz-role";
const POINTS_PER_CORRECT = 10;
const CONSECUTIVE_LIMIT = 2;
const UNFLIP_DELAY = 850;
const DEFAULT_NAMES = ["Player 1", "Player 2"];

const ui = {
  board: document.querySelector("#board"),
  turnIndicator: document.querySelector("#turnIndicator"),
  matchCounter: document.querySelector("#matchCounter"),
  roleChip: document.querySelector("#roleChip"),
  playerChip: document.querySelector("#playerChip"),
  resetBtn: document.querySelector("#resetBtn"),
  shuffleBtn: document.querySelector("#shuffleBtn"),
  editNamesBtn: document.querySelector("#editNamesBtn"),
  modal: document.querySelector("#questionModal"),
  modalBackdrop: document.querySelector(".modal-backdrop"),
  questionTeam: document.querySelector("#questionTeam"),
  questionCount: document.querySelector("#questionCount"),
  questionNote: document.querySelector("#questionNote"),
  questionPrompt: document.querySelector("#questionPrompt"),
  questionOptions: document.querySelector("#questionOptions"),
  textAnswerWrap: document.querySelector("#textAnswerWrap"),
  textAnswerInput: document.querySelector("#textAnswerInput"),
  submitAnswerBtn: document.querySelector("#submitAnswerBtn"),
  closeQuestionBtn: document.querySelector("#closeQuestionBtn"),
  questionFeedback: document.querySelector("#questionFeedback"),
  fatalError: document.querySelector("#fatalError"),
  fatalErrorMessage: document.querySelector("#fatalErrorMessage"),
  boardOverlay: document.querySelector("#boardOverlay"),
  boardOverlayTitle: document.querySelector("#boardOverlayTitle"),
  boardOverlayHint: document.querySelector("#boardOverlayHint"),
  boardOverlayAction: document.querySelector("#boardOverlayAction"),
  joinModal: document.querySelector("#joinModal"),
  playerNameInput: document.querySelector("#playerNameInput"),
  startGameBtn: document.querySelector("#startGameBtn"),
  joinError: document.querySelector("#joinError"),
  roleModal: document.querySelector("#roleModal"),
  chooseHostBtn: document.querySelector("#chooseHostBtn"),
  choosePlayerBtn: document.querySelector("#choosePlayerBtn"),
};

const state = {
  role: null,
  playerId: null,
  authUser: null,
  playerIndex: null,
  cards: [],
  questions: [],
  room: null,
  deckKey: "",
  cardEls: new Map(),
  selectedOption: null,
  currentQuestionKey: null,
  pendingUnflipTimer: null,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const roomRef = doc(db, "rooms", ROOM_ID);

init();

async function init() {
  bindEvents();
  await loadData();
  try {
    await ensureAuth();
  } catch (error) {
    showFatalError(
      "Authentication failed. Enable Anonymous Auth in Firebase and refresh."
    );
    return;
  }

  const role = getRoleFromUrlOrStorage();
  if (role) {
    setRole(role);
    await startRealtime();
  } else {
    clearRole();
    openRoleModal();
  }
}

function bindEvents() {
  ui.resetBtn.addEventListener("click", () => hostReset(true));
  ui.shuffleBtn.addEventListener("click", () => hostReset(false));
  ui.submitAnswerBtn.addEventListener("click", handleSubmitAnswer);
  ui.closeQuestionBtn.addEventListener("click", () => hostSkipQuestion());
  ui.startGameBtn.addEventListener("click", handleJoinSubmit);
  ui.editNamesBtn.addEventListener("click", openJoinModal);
  ui.boardOverlayAction.addEventListener("click", () => {
    openRoleModal();
  });
  ui.chooseHostBtn.addEventListener("click", () => chooseRole("host"));
  ui.choosePlayerBtn.addEventListener("click", () => chooseRole("player"));

  window.addEventListener("pagehide", () => {
    leaveRoom();
  });

  window.addEventListener("beforeunload", () => {
    leaveRoom();
  });
}

async function loadData() {
  const [cardsResponse, questionsResponse] = await Promise.all([
    fetch("data/cards.json"),
    fetch("data/questions.json"),
  ]);

  const cardsJson = await cardsResponse.json();
  const questionsJson = await questionsResponse.json();

  state.cards = Array.isArray(cardsJson) ? cardsJson : cardsJson.pairs || [];
  state.questions = Array.isArray(questionsJson)
    ? questionsJson
    : questionsJson.questions || [];
}

function getRoleFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role");
  if (role === "host" || role === "player") return role;

  const stored = localStorage.getItem(ROLE_KEY);
  if (stored === "host" || stored === "player") return stored;
  return null;
}

function chooseRole(role) {
  setRole(role);
  closeRoleModal();
  startRealtime();
}

function setRole(role) {
  state.role = role;
  document.body.dataset.role = role;
  localStorage.setItem(ROLE_KEY, role);
  ui.roleChip.textContent = `Mode: ${role === "host" ? "Host" : "Player"}`;
  hideBoardOverlay();
}

function clearRole() {
  state.role = null;
  document.body.dataset.role = "none";
  localStorage.removeItem(ROLE_KEY);
  ui.roleChip.textContent = "Mode: -";
  if (ui.playerChip) {
    ui.playerChip.textContent = "You are: -";
  }
  showBoardOverlay({
    title: "Choose a role",
    hint: "Select Host or Player to begin.",
    actionLabel: "Choose role",
  });
}

function ensureAuth() {
  return new Promise((resolve, reject) => {
    if (auth.currentUser) {
      state.authUser = auth.currentUser;
      state.playerId = auth.currentUser.uid;
      resolve(auth.currentUser);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        state.authUser = user;
        state.playerId = user.uid;
        unsubscribe();
        resolve(user);
      }
    });

    signInAnonymously(auth).catch((error) => {
      unsubscribe();
      reject(error);
    });
  });
}

function openRoleModal() {
  ui.roleModal.classList.remove("hidden");
}

function closeRoleModal() {
  ui.roleModal.classList.add("hidden");
}


function showFatalError(message) {
  ui.fatalErrorMessage.textContent = message;
  ui.fatalError.classList.remove("hidden");
}

async function startRealtime() {
  if (state.role === "host") {
    await ensureRoom();
  }

  subscribeRoom();

  if (state.role === "player") {
    openJoinModal();
  }
}

async function ensureRoom() {
  const snap = await getDoc(roomRef);
  if (snap.exists()) return;
  await setDoc(roomRef, buildInitialRoom());
}

function buildInitialRoom() {
  return {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    hostId: state.playerId,
    players: [null, null],
    playerIds: [],
    teams: buildTeamsFromPlayers([null, null], null, true),
    currentTeam: 0,
    deck: buildDeck(state.cards),
    flipped: [],
    matchedPairs: [],
    lock: false,
    pendingUnflip: null,
    activeQuestion: null,
    questionCounter: 0,
    usedQuestions: [],
  };
}

function buildTeamsFromPlayers(players, existingTeams, resetScores) {
  return players.map((player, index) => {
    const name = resetScores
      ? (player?.name || DEFAULT_NAMES[index])
      : (player?.name || existingTeams?.[index]?.name || DEFAULT_NAMES[index]);
    return {
      name,
      score: resetScores ? 0 : existingTeams?.[index]?.score || 0,
      streak: resetScores ? 0 : existingTeams?.[index]?.streak || 0,
    };
  });
}

function buildPlayerIds(players, existingIds) {
  const set = new Set(existingIds || []);
  players.forEach((player) => {
    if (player?.id) set.add(player.id);
  });
  return Array.from(set);
}

function subscribeRoom() {
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      if (state.role === "host") {
        ensureRoom();
      } else {
        ui.joinError.textContent = "Room is not ready yet. Please wait for the host.";
        openJoinModal();
      }
      return;
    }

    state.room = snap.data();
    syncPlayerIndex(state.room);
    renderRoom(state.room);
    handlePendingUnflip(state.room);
  }, (error) => {
    showFatalError(
      "Firestore permission denied. Check rules, enable Anonymous Auth, and refresh."
    );
  });
}

function syncPlayerIndex(room) {
  if (state.role !== "player") return;
  const players = room.players || [];
  const index = players.findIndex((player) => player?.id === state.playerId);
  state.playerIndex = index !== -1 ? index : null;
}

function renderRoom(room) {
  updateScoreboard(room);
  updateTurnIndicator(room);
  updateMatchCounter(room);
  renderBoard(room);
  renderQuestion(room);
  updatePlayerChip(room);
  updateBoardOverlay(room);
  if (state.role === "player" && state.playerIndex !== null) {
    closeJoinModal();
  }
}

function updateBoardOverlay(room) {
  if (!state.role) {
    showBoardOverlay({
      title: "Choose a role",
      hint: "Select Host or Player to begin.",
      actionLabel: "Choose role",
    });
    return;
  }

  if (state.role === "player" && state.playerIndex === null) {
    showBoardOverlay({
      title: "Join the game",
      hint: "Enter your display name to take a seat.",
      actionLabel: "Enter name",
      onAction: openJoinModal,
    });
    return;
  }

  if (state.role === "player" && room && room.currentTeam !== state.playerIndex) {
    const waitingFor = room.teams?.[room.currentTeam]?.name || "the other player";
    showBoardOverlay({
      title: "Waiting",
      hint: `It's ${waitingFor}'s turn.`,
      actionLabel: null,
    });
    return;
  }

  hideBoardOverlay();
}

function showBoardOverlay({ title, hint, actionLabel, onAction }) {
  ui.boardOverlayTitle.textContent = title;
  ui.boardOverlayHint.textContent = hint;
  if (actionLabel) {
    ui.boardOverlayAction.textContent = actionLabel;
    ui.boardOverlayAction.classList.remove("hidden");
    ui.boardOverlayAction.onclick = onAction || openRoleModal;
  } else {
    ui.boardOverlayAction.classList.add("hidden");
  }
  ui.boardOverlay.classList.remove("hidden");
}

function hideBoardOverlay() {
  ui.boardOverlay.classList.add("hidden");
}

function updateScoreboard(room) {
  const teamCards = document.querySelectorAll(".team-card");
  teamCards.forEach((card, index) => {
    const team = room.teams?.[index];
    const nameEl = card.querySelector(".team-name");
    const scoreEl = card.querySelector(".team-score");

    if (team) {
      nameEl.textContent = team.name;
      scoreEl.textContent = team.score;
    }

    card.classList.toggle("active", index === room.currentTeam);
  });
}

function updateTurnIndicator(room) {
  const team = room.teams?.[room.currentTeam];
  ui.turnIndicator.textContent = team ? `Turn: ${team.name}` : "Turn: -";
}

function updateMatchCounter(room) {
  const totalPairs = state.cards.length;
  const matched = room.matchedPairs?.length || 0;
  ui.matchCounter.textContent = `${matched}/${totalPairs} pairs`;
}

function updatePlayerChip(room) {
  if (state.role !== "player") return;
  if (state.playerIndex === null) {
    ui.playerChip.textContent = "You are: -";
    return;
  }
  const name = room.teams?.[state.playerIndex]?.name || DEFAULT_NAMES[state.playerIndex];
  ui.playerChip.textContent = `You are: ${name}`;
}

function renderBoard(room) {
  const deck = room.deck || [];
  const deckKey = deck.map((card) => card.uid).join("|");

  if (deckKey !== state.deckKey) {
    ui.board.innerHTML = "";
    state.cardEls.clear();
    state.deckKey = deckKey;

    deck.forEach((card, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card";
      button.dataset.uid = card.uid;
      button.dataset.pair = card.id;
      button.style.setProperty("--delay", `${index * 40}ms`);
      button.setAttribute("aria-label", `The ${card.label}`);
      button.innerHTML = `
        <span class="card-inner">
          <span class="card-face card-back">?</span>
          <span class="card-face card-front">
            <img src="${card.image}" alt="${card.label}" loading="lazy" />
          </span>
        </span>
      `;
      button.addEventListener("click", () => handleCardClick(card.uid));
      ui.board.appendChild(button);
      state.cardEls.set(card.uid, button);
    });
  }

  deck.forEach((card) => {
    const button = state.cardEls.get(card.uid);
    if (!button) return;
    const flipped = card.flipped || card.matched;
    button.classList.toggle("is-flipped", flipped);
    button.classList.toggle("is-matched", card.matched);
  });

  const locked =
    state.role === "host" ||
    room.lock ||
    !!room.activeQuestion ||
    !canPlayerInteract(room);
  ui.board.classList.toggle("is-locked", locked);
}

function canPlayerInteract(room) {
  if (state.role !== "player") return false;
  if (state.playerIndex === null) return false;
  if (room.currentTeam !== state.playerIndex) return false;
  return true;
}

function renderQuestion(room) {
  const question = room.activeQuestion;
  if (!question) {
    closeQuestionModal();
    return;
  }

  const questionKey = `${question.id}-${question.attempt}`;
  if (questionKey !== state.currentQuestionKey) {
    state.currentQuestionKey = questionKey;
    state.selectedOption = null;
    ui.textAnswerInput.value = "";
  }

  const answeringTeam = room.teams?.[question.answeringTeam];
  ui.questionTeam.textContent = answeringTeam ? answeringTeam.name : "";
  ui.questionCount.textContent = `Question #${question.number}`;
  ui.questionPrompt.textContent = question.prompt;
  ui.questionOptions.innerHTML = "";
  ui.textAnswerWrap.classList.add("hidden");
  ui.questionFeedback.textContent = "";

  const canAnswer =
    state.role === "player" && state.playerIndex === question.answeringTeam;

  if (question.type === "text") {
    ui.textAnswerWrap.classList.remove("hidden");
    ui.textAnswerInput.disabled = !canAnswer;
  } else {
    (question.options || []).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.textContent = option;
      if (!canAnswer) {
        button.classList.add("disabled");
      } else {
        button.addEventListener("click", () => {
          state.selectedOption = option;
          ui.questionOptions.querySelectorAll(".option").forEach((el) => {
            el.classList.toggle("selected", el === button);
          });
        });
      }
      ui.questionOptions.appendChild(button);
    });
  }

  let note = question.note || "";
  if (state.role === "player" && !canAnswer) {
    note = "Waiting for the other player to answer.";
  }
  ui.questionNote.textContent = note;

  ui.submitAnswerBtn.disabled = !canAnswer;
  openQuestionModal();
}

function openQuestionModal() {
  ui.modal.classList.remove("hidden");
}

function closeQuestionModal() {
  ui.modal.classList.add("hidden");
  ui.questionFeedback.textContent = "";
}

async function handleCardClick(uid) {
  if (state.role !== "player") return;
  if (!state.room || !canPlayerInteract(state.room)) return;
  if (state.room.lock || state.room.activeQuestion) return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;

    const room = snap.data();
    if (room.lock || room.activeQuestion) return;
    if (room.currentTeam !== state.playerIndex) return;

    const deck = [...room.deck];
    const cardIndex = deck.findIndex((card) => card.uid === uid);
    if (cardIndex === -1) return;
    if (deck[cardIndex].matched || deck[cardIndex].flipped) return;

    deck[cardIndex] = { ...deck[cardIndex], flipped: true };
    const flipped = [...(room.flipped || []), uid];

    if (flipped.length < 2) {
      tx.update(roomRef, {
        deck,
        flipped,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const [firstUid, secondUid] = flipped;
    const firstCard = deck.find((card) => card.uid === firstUid);
    const secondCard = deck.find((card) => card.uid === secondUid);
    if (!firstCard || !secondCard) return;

    if (firstCard.id === secondCard.id) {
      const matchedPairs = Array.from(
        new Set([...(room.matchedPairs || []), firstCard.id])
      );

      const questionPick = pickQuestion(room.usedQuestions || []);
      if (!questionPick) {
        tx.update(roomRef, {
          deck: deck.map((card) =>
            card.id === firstCard.id
              ? { ...card, matched: true }
              : card
          ),
          flipped: [],
          matchedPairs,
          lock: false,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      const baseTeam = room.currentTeam;
      let answeringTeam = baseTeam;
      let note = "";

      if (room.teams?.[baseTeam]?.streak >= CONSECUTIVE_LIMIT) {
        answeringTeam = getNextTeamIndex(baseTeam);
        note = "This player already answered correctly twice in a row. The next question goes to the other player.";
      }

      const activeQuestion = {
        ...questionPick.question,
        number: (room.questionCounter || 0) + 1,
        attempt: 1,
        initialTeam: baseTeam,
        answeringTeam,
        note,
      };

      const updatedDeck = deck.map((card) =>
        card.id === firstCard.id ? { ...card, matched: true } : card
      );

      tx.update(roomRef, {
        deck: updatedDeck,
        flipped: [],
        matchedPairs,
        activeQuestion,
        questionCounter: (room.questionCounter || 0) + 1,
        usedQuestions: questionPick.usedQuestions,
        lock: true,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    tx.update(roomRef, {
      deck,
      flipped,
      lock: true,
      pendingUnflip: {
        uids: flipped,
        by: state.playerId,
        nextTeam: getNextTeamIndex(room.currentTeam),
      },
      updatedAt: serverTimestamp(),
    });
  });
}

function handlePendingUnflip(room) {
  const pending = room.pendingUnflip;
  if (!pending || pending.by !== state.playerId) return;
  if (state.pendingUnflipTimer) return;

  state.pendingUnflipTimer = setTimeout(() => {
    resolveUnflip(pending.uids, pending.by, pending.nextTeam);
    state.pendingUnflipTimer = null;
  }, UNFLIP_DELAY);
}

async function resolveUnflip(uids, by, nextTeam) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data();
    if (!room.pendingUnflip || room.pendingUnflip.by !== by) return;

    const deck = room.deck.map((card) =>
      uids.includes(card.uid) ? { ...card, flipped: false } : card
    );

    tx.update(roomRef, {
      deck,
      flipped: [],
      lock: false,
      pendingUnflip: null,
      currentTeam: nextTeam,
      updatedAt: serverTimestamp(),
    });
  });
}

async function handleSubmitAnswer() {
  if (state.role !== "player") return;
  if (!state.room?.activeQuestion) return;
  if (state.playerIndex !== state.room.activeQuestion.answeringTeam) return;

  const question = state.room.activeQuestion;
  const answer = getAnswerInput(question);

  if (!answer) {
    ui.questionFeedback.textContent = "Please choose an answer.";
    return;
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data();
    const active = room.activeQuestion;
    if (!active) return;
    if (active.answeringTeam !== state.playerIndex) return;

    const isCorrect = checkAnswer(active, answer);
    const teams = room.teams.map((team) => ({ ...team }));

    if (isCorrect) {
      const team = teams[active.answeringTeam];
      team.score += POINTS_PER_CORRECT;
      team.streak += 1;
      teams.forEach((other, index) => {
        if (index !== active.answeringTeam) other.streak = 0;
      });

      tx.update(roomRef, {
        teams,
        activeQuestion: null,
        lock: false,
        currentTeam: active.answeringTeam,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    teams[active.answeringTeam].streak = 0;

    if (active.attempt === 1) {
      const nextTeam = getNextTeamIndex(active.answeringTeam);
      tx.update(roomRef, {
        teams,
        activeQuestion: {
          ...active,
          attempt: 2,
          answeringTeam: nextTeam,
          note: "Other player can answer now.",
        },
        updatedAt: serverTimestamp(),
      });
      return;
    }

    tx.update(roomRef, {
      teams,
      activeQuestion: null,
      lock: false,
      currentTeam: getNextTeamIndex(active.answeringTeam),
      updatedAt: serverTimestamp(),
    });
  });
}

function getAnswerInput(question) {
  if (question.type === "text") {
    return ui.textAnswerInput.value.trim();
  }
  return state.selectedOption;
}

function checkAnswer(question, answer) {
  const normalizedAnswer = normalizeAnswer(String(answer));
  const expectedAnswers = Array.isArray(question.answer)
    ? question.answer
    : [question.answer];

  return expectedAnswers.some(
    (item) => normalizeAnswer(String(item)) === normalizedAnswer
  );
}

function normalizeAnswer(value) {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");
}

async function handleJoinSubmit() {
  if (state.role !== "player") return;

  const name = ui.playerNameInput.value.trim();
  if (!name) {
    ui.joinError.textContent = "Please enter a display name.";
    return;
  }

  ui.joinError.textContent = "";
  try {
    const index = await joinPlayer(name);
    state.playerIndex = index;
    closeJoinModal();
  } catch (error) {
    ui.joinError.textContent = error.message || "Unable to join.";
  }
}

async function leaveRoom() {
  if (state.role !== "player") return;
  if (!state.playerId) return;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) return;
      const room = snap.data();

      const players = room.players ? [...room.players] : [null, null];
      const index = players.findIndex((player) => player?.id === state.playerId);
      if (index === -1) return;

      players[index] = null;

      const teams = room.teams?.map((team) => ({ ...team })) || [];
      if (teams[index]) {
        teams[index].name = DEFAULT_NAMES[index];
      }

      const playerIds = (room.playerIds || []).filter((id) => id !== state.playerId);

      tx.update(roomRef, {
        players,
        playerIds,
        teams,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    // Best effort on unload.
  }
}

async function joinPlayer(name) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) {
      throw new Error("Room is not ready yet. Please wait for the host.");
    }

    const room = snap.data();
    const players = room.players ? [...room.players] : [null, null];

    let index = players.findIndex((player) => player?.id === state.playerId);
    if (index === -1) {
      index = players.findIndex((player) => !player);
    }

    if (index === -1) {
      throw new Error("Room is full (2 players already).");
    }

    players[index] = {
      id: state.playerId,
      name,
      joinedAt: Date.now(),
    };

    const teams = buildTeamsFromPlayers(players, room.teams, false);
    const playerIds = buildPlayerIds(players, room.playerIds);

    tx.update(roomRef, {
      players,
      playerIds,
      teams,
      updatedAt: serverTimestamp(),
    });

    return index;
  });
}

function openJoinModal() {
  ui.joinError.textContent = "";
  ui.playerNameInput.value = "";
  ui.joinModal.classList.remove("hidden");
  ui.playerNameInput.focus();
  ui.board.classList.add("is-locked");
}

function closeJoinModal() {
  ui.joinModal.classList.add("hidden");
  ui.board.classList.remove("is-locked");
}

async function hostReset(resetScores) {
  if (state.role !== "host") return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const room = snap.exists() ? snap.data() : null;

    const shouldClearPlayers = resetScores === true;
    const players = shouldClearPlayers ? [null, null] : (room?.players || [null, null]);
    const teams = buildTeamsFromPlayers(players, room?.teams, resetScores);
    const playerIds = shouldClearPlayers ? [] : buildPlayerIds(players, room?.playerIds);
    const deck = buildDeck(state.cards);
    const hostId = room?.hostId || state.playerId;

    const update = {
      hostId,
      players,
      playerIds,
      teams,
      deck,
      flipped: [],
      matchedPairs: [],
      pendingUnflip: null,
      activeQuestion: null,
      lock: false,
      updatedAt: serverTimestamp(),
    };

    if (resetScores) {
      update.currentTeam = 0;
      update.questionCounter = 0;
      update.usedQuestions = [];
    } else {
      update.currentTeam = room?.currentTeam ?? 0;
      update.questionCounter = room?.questionCounter ?? 0;
      update.usedQuestions = room?.usedQuestions ?? [];
    }

    if (snap.exists()) {
      tx.update(roomRef, update);
    } else {
      tx.set(roomRef, {
        ...buildInitialRoom(),
        ...update,
      });
    }
  });
}

async function hostSkipQuestion() {
  if (state.role !== "host") return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data();
    if (!room.activeQuestion) return;

    const nextTeam = getNextTeamIndex(room.activeQuestion.answeringTeam);

    tx.update(roomRef, {
      activeQuestion: null,
      lock: false,
      currentTeam: nextTeam,
      updatedAt: serverTimestamp(),
    });
  });
}

function buildDeck(cards) {
  const deck = [];
  cards.forEach((card) => {
    deck.push({ ...card, uid: `${card.id}-a`, flipped: false, matched: false });
    deck.push({ ...card, uid: `${card.id}-b`, flipped: false, matched: false });
  });
  return shuffle(deck);
}

function pickQuestion(usedQuestions) {
  if (!state.questions.length) return null;
  const used = new Set(usedQuestions);
  let available = state.questions.filter((question) => !used.has(question.id));

  if (!available.length) {
    used.clear();
    available = [...state.questions];
  }

  if (!available.length) return null;
  const question = available[Math.floor(Math.random() * available.length)];
  used.add(question.id);
  return { question, usedQuestions: Array.from(used) };
}

function getNextTeamIndex(index) {
  return (index + 1) % 2;
}

function shuffle(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
