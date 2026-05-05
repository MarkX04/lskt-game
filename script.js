const DATA = {
  cards: "data/cards.json",
  questions: "data/questions.json",
};

const POINTS_PER_CORRECT = 10;
const CONSECUTIVE_LIMIT = 2;

const ui = {
  board: document.querySelector("#board"),
  turnIndicator: document.querySelector("#turnIndicator"),
  matchCounter: document.querySelector("#matchCounter"),
  resetBtn: document.querySelector("#resetBtn"),
  shuffleBtn: document.querySelector("#shuffleBtn"),
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
};

const state = {
  cards: [],
  questions: [],
  deck: [],
  flipped: [],
  matched: new Set(),
  lock: false,
  teams: [],
  currentTeam: 0,
  usedQuestions: new Set(),
  questionCounter: 0,
  activeQuestion: null,
  selectedOption: null,
  totalPairs: 0,
};

const shuffle = (items) => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

const normalizeAnswer = (value) =>
  value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ");

const formatCorrectAnswer = (question) => {
  const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
  return answers.map((answer) => String(answer).trim()).join(" / ");
};

const nextTeamIndex = (index) => (index + 1) % state.teams.length;

const setTurnIndicator = () => {
  const team = state.teams[state.currentTeam];
  if (!team) return;
  ui.turnIndicator.textContent = `Turn: ${team.name}`;
};

const updateScoreboard = () => {
  state.teams.forEach((team, index) => {
    team.scoreEl.textContent = team.score;
    team.card.classList.toggle("active", index === state.currentTeam);
  });
};

const updateMatchCounter = () => {
  ui.matchCounter.textContent = `${state.matched.size}/${state.totalPairs} pairs`;
};

const flipCard = (card) => {
  card.classList.add("is-flipped");
};

const unflipCard = (card) => {
  card.classList.remove("is-flipped");
};

const markMatched = (first, second) => {
  first.classList.add("is-matched");
  second.classList.add("is-matched");
  state.matched.add(first.dataset.pair);
  updateMatchCounter();
};

const buildDeck = () => {
  const deck = [];
  state.cards.forEach((card) => {
    deck.push({ ...card, uid: `${card.id}-a` });
    deck.push({ ...card, uid: `${card.id}-b` });
  });
  shuffle(deck);
  return deck;
};

const calcCols = (count) => {
  if (count <= 12) return 4;
  if (count <= 16) return 4;
  if (count <= 20) return 5;
  return 6;
};

const buildBoard = () => {
  state.deck = buildDeck();
  state.flipped = [];
  state.matched = new Set();
  state.totalPairs = state.cards.length;
  ui.board.innerHTML = "";

  const cols = calcCols(state.deck.length);
  ui.board.style.setProperty("--cols", cols);

  state.deck.forEach((card, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.dataset.pair = card.id;
    button.dataset.uid = card.uid;
    button.style.setProperty("--delay", `${index * 40}ms`);
    button.setAttribute("aria-label", `Card ${card.label}`);
    button.innerHTML = `
      <span class="card-inner">
        <span class="card-face card-back">?</span>
        <span class="card-face card-front">
          <img src="${card.image}" alt="${card.label}" loading="lazy" />
        </span>
      </span>
    `;
    button.addEventListener("click", handleCardClick);
    ui.board.appendChild(button);
  });

  updateMatchCounter();
};

const pickQuestion = () => {
  if (!state.questions.length) return null;
  if (state.usedQuestions.size >= state.questions.length) {
    state.usedQuestions.clear();
  }

  let question = null;
  while (!question) {
    const candidate = state.questions[Math.floor(Math.random() * state.questions.length)];
    if (!state.usedQuestions.has(candidate.id)) {
      question = candidate;
      state.usedQuestions.add(candidate.id);
    }
  }
  return question;
};

const showModal = () => {
  ui.modal.classList.remove("hidden");
};

const hideModal = () => {
  ui.modal.classList.add("hidden");
  ui.questionFeedback.textContent = "";
};

const renderQuestion = (question, teamIndex, note) => {
  const team = state.teams[teamIndex];
  ui.questionTeam.textContent = team ? team.name : "";
  ui.questionCount.textContent = `Question #${state.activeQuestion.number}`;
  ui.questionNote.textContent = note || "";
  ui.questionPrompt.textContent = question.prompt;
  ui.questionFeedback.textContent = "";
  ui.questionOptions.innerHTML = "";
  ui.textAnswerWrap.classList.add("hidden");
  state.selectedOption = null;

  if (question.type === "text") {
    ui.textAnswerWrap.classList.remove("hidden");
    ui.textAnswerInput.value = "";
    ui.textAnswerInput.focus();
    return;
  }

  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.textContent = option;
    button.addEventListener("click", () => {
      state.selectedOption = option;
      ui.questionOptions.querySelectorAll(".option").forEach((el) => {
        el.classList.toggle("selected", el === button);
      });
    });
    ui.questionOptions.appendChild(button);
  });
};

const openQuestion = () => {
  const question = pickQuestion();
  if (!question) {
    state.lock = false;
    return;
  }

  state.questionCounter += 1;
  const initialTeam = state.currentTeam;
  let answeringTeam = initialTeam;
  let note = "";

  if (state.teams[answeringTeam].streak >= CONSECUTIVE_LIMIT) {
    answeringTeam = nextTeamIndex(initialTeam);
    note = "This team already answered correctly twice in a row. The next question goes to the other team.";
  }

  state.activeQuestion = {
    question,
    number: state.questionCounter,
    attempt: 1,
    initialTeam,
    answeringTeam,
  };

  renderQuestion(question, answeringTeam, note);
  showModal();
};

const closeQuestion = () => {
  state.activeQuestion = null;
  hideModal();
};

const skipQuestion = () => {
  const baseTeam = state.activeQuestion?.answeringTeam ?? state.currentTeam;
  closeQuestion();
  state.flipped = [];
  state.lock = false;
  state.currentTeam = nextTeamIndex(baseTeam);
  updateScoreboard();
  setTurnIndicator();
};

const awardPoints = (teamIndex) => {
  const team = state.teams[teamIndex];
  team.score += POINTS_PER_CORRECT;
  team.streak += 1;
  state.teams.forEach((other, index) => {
    if (index !== teamIndex) other.streak = 0;
  });
  state.currentTeam = teamIndex;
  updateScoreboard();
  setTurnIndicator();
};

const handleWrongAnswer = (teamIndex) => {
  state.teams[teamIndex].streak = 0;
  updateScoreboard();
};

const resolveQuestionCorrect = (teamIndex) => {
  awardPoints(teamIndex);
  closeQuestion();
  state.flipped = [];
  state.lock = false;
};

const resolveQuestionWrong = (teamIndex) => {
  handleWrongAnswer(teamIndex);

  if (state.activeQuestion.attempt === 1) {
    const nextTeam = nextTeamIndex(teamIndex);
    if (nextTeam !== teamIndex) {
      state.activeQuestion.attempt = 2;
      state.activeQuestion.answeringTeam = nextTeam;
      renderQuestion(state.activeQuestion.question, nextTeam, "Other team can answer now.");
      return;
    }
  }

  closeQuestion();
  state.flipped = [];
  state.lock = false;
  state.currentTeam = nextTeamIndex(teamIndex);
  updateScoreboard();
  setTurnIndicator();
};

const getSubmittedAnswer = (question) => {
  if (question.type === "text") {
    return ui.textAnswerInput.value;
  }
  return state.selectedOption;
};

const handleSubmitAnswer = () => {
  if (!state.activeQuestion) return;
  const question = state.activeQuestion.question;
  const answer = getSubmittedAnswer(question);

  if (!answer || !answer.trim()) {
    ui.questionFeedback.textContent = "Please choose an answer.";
    return;
  }

  const normalizedAnswer = normalizeAnswer(answer);
  const expectedAnswers = Array.isArray(question.answer)
    ? question.answer
    : [question.answer];
  const isCorrect = expectedAnswers.some(
    (item) => normalizeAnswer(String(item)) === normalizedAnswer
  );

  if (isCorrect) {
    ui.questionFeedback.textContent = "Correct!";
    setTimeout(() => {
      resolveQuestionCorrect(state.activeQuestion.answeringTeam);
    }, 400);
  } else {
    const isFinalAttempt = state.activeQuestion.attempt >= 2;
    if (isFinalAttempt) {
      const correctAnswer = formatCorrectAnswer(question);
      ui.questionFeedback.textContent = `Incorrect. Correct answer: ${correctAnswer}`;
      setTimeout(() => {
        resolveQuestionWrong(state.activeQuestion.answeringTeam);
      }, 1200);
    } else {
      ui.questionFeedback.textContent = "Incorrect.";
      setTimeout(() => {
        resolveQuestionWrong(state.activeQuestion.answeringTeam);
      }, 400);
    }
  }
};

const handleCardClick = (event) => {
  const card = event.currentTarget;
  if (state.lock) return;
  if (card.classList.contains("is-flipped") || card.classList.contains("is-matched")) return;

  flipCard(card);
  state.flipped.push(card);

  if (state.flipped.length < 2) return;

  state.lock = true;
  const [first, second] = state.flipped;
  const isMatch = first.dataset.pair === second.dataset.pair;

  if (isMatch) {
    markMatched(first, second);
    setTimeout(() => {
      openQuestion();
    }, 450);
  } else {
    setTimeout(() => {
      unflipCard(first);
      unflipCard(second);
      state.flipped = [];
      state.lock = false;
      state.currentTeam = nextTeamIndex(state.currentTeam);
      updateScoreboard();
      setTurnIndicator();
    }, 850);
  }
};

const setupTeams = () => {
  const cards = document.querySelectorAll(".team-card");
  state.teams = Array.from(cards).map((card, index) => {
    const nameInput = card.querySelector(".team-name");
    const scoreEl = card.querySelector(".team-score");
    const team = {
      index,
      name: nameInput.value.trim() || `Player ${index + 1}`,
      score: 0,
      streak: 0,
      card,
      nameInput,
      scoreEl,
    };

    nameInput.addEventListener("input", () => {
      team.name = nameInput.value.trim() || `Player ${index + 1}`;
      setTurnIndicator();
    });

    return team;
  });
};

const resetScores = () => {
  state.teams.forEach((team, index) => {
    team.score = 0;
    team.streak = 0;
    team.name = team.nameInput.value.trim() || `Player ${index + 1}`;
  });
  state.currentTeam = 0;
  updateScoreboard();
  setTurnIndicator();
};

const resetRound = () => {
  state.usedQuestions.clear();
  state.questionCounter = 0;
  resetScores();
  buildBoard();
};

const shuffleRound = () => {
  buildBoard();
};

const init = async () => {
  setupTeams();
  setTurnIndicator();

  try {
    const [cardsResponse, questionsResponse] = await Promise.all([
      fetch(DATA.cards),
      fetch(DATA.questions),
    ]);

    state.cards = await cardsResponse.json();
    state.questions = await questionsResponse.json();
    buildBoard();
    updateScoreboard();
    setTurnIndicator();
  } catch (error) {
    ui.board.innerHTML = "<p>Unable to load data. Please check data/ files.</p>";
  }
};

ui.resetBtn.addEventListener("click", resetRound);
ui.shuffleBtn.addEventListener("click", shuffleRound);
ui.submitAnswerBtn.addEventListener("click", handleSubmitAnswer);
ui.closeQuestionBtn.addEventListener("click", skipQuestion);
ui.modalBackdrop.addEventListener("click", skipQuestion);

document.addEventListener("DOMContentLoaded", init);
