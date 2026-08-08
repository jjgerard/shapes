// Shared "10 correct in a row" scoring engine for Level 3 (constituency
// yes/no) and Level 4 (category ID) -- a wrong answer resets the streak to
// zero, so the sub-level is only done once 10 straight answers land
// correctly. Reward AND penalty scale with the CURRENT bonus tier (the
// streak going into this question, before it's answered), so a wrong
// guess at a high streak is a real loss, not a free reroll -- that's what
// actually discourages spamming random answers to fish for 10 in a row.
const STREAK_TARGET = 10;
const STREAK_BASE_POINTS = 10;
const STREAK_TIER_SIZE = 3; // every 3-in-a-row doubles the multiplier

class StreakGame {
  constructor() {
    this.streak = 0;
  }
  multiplier() {
    return Math.pow(2, Math.floor(this.streak / STREAK_TIER_SIZE));
  }
  // Apply a correct/incorrect answer; returns {pointsDelta, streak,
  // progress (0-1), complete, multiplier (the one this answer scored at)}.
  answer(correct) {
    const multiplier = this.multiplier();
    const pointsDelta = (correct ? 1 : -1) * STREAK_BASE_POINTS * multiplier;
    this.streak = correct ? this.streak + 1 : 0;
    return {
      pointsDelta,
      multiplier,
      streak: this.streak,
      progress: Math.min(1, this.streak / STREAK_TARGET),
      complete: this.streak >= STREAK_TARGET,
    };
  }
}
