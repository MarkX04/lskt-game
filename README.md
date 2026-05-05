# Architecture Memory Quiz

Flip pairs, unlock questions, and score points.

## How to play
- The host flips cards and answers for players.
- Edit player names directly in the scoreboard.
- Use "New round" to reset scores and reshuffle the deck.
- Use "Shuffle" to reshuffle only the deck.

## Edit content

- Images: replace files in `assets/` and update `data/cards.json`.
- Questions: update `data/questions.json`.

Question format (mcq):

```json
{
  "id": "q1",
  "type": "mcq",
  "prompt": "Your question",
  "options": ["A", "B", "C", "D"],
  "answer": "A"
}
```

Question format (text):

```json
{
  "id": "q2",
  "type": "text",
  "prompt": "Your question",
  "answer": "Correct answer"
}
```

Multiple correct answers (text):

```json
{
  "id": "q3",
  "type": "text",
  "prompt": "Your question",
  "answer": ["Answer 1", "Answer 2"]
}
```

## Deploy to GitHub Pages

1. Push to GitHub.
2. Open Settings -> Pages.
3. Select Branch `main` (or `master`) and root folder `/`.
4. Save and wait for Pages to build.

## Local preview

Open `index.html` in a browser, or serve with any static server.