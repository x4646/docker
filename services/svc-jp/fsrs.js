"use strict";

// 复习排期：用 ts-fsrs（Free Spaced Repetition Scheduler）算法，
// 不是简单的"过N天再问一次"，是根据每次答对/答错动态调 stability/difficulty 算出下次该问的日期
const { fsrs, generatorParameters, createEmptyCard, Rating, State } = require("ts-fsrs");

const scheduler = fsrs(generatorParameters({ maximum_interval: 36500 }));

function cardFromRow(row) {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined
  };
}

function rowFromCard(wordId, card) {
  return {
    word_id: wordId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null
  };
}

// row 为 null 表示这个词从没复习过（全新卡）；rating 是 1~4（Again/Hard/Good/Easy）
function schedule(row, rating, now) {
  var card = row ? cardFromRow(row) : createEmptyCard(now);
  var outcome = scheduler.repeat(card, now)[rating];
  return { row: rowFromCard(row ? row.word_id : null, outcome.card), log: outcome.log };
}

module.exports = { schedule, rowFromCard, cardFromRow, Rating: Rating, State: State };
