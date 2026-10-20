import { DAILY_EPOCH, GAME_NAME } from '../config';
import { dailyPair, msUntilNextPuzzle, puzzleNumber } from '../game/daily';
import {
  currentCloseness,
  currentWord,
  MoveError,
  type Closeness,
  type Engine,
  type Mode,
  type Operation,
  type Round,
  type Step,
  type Tier,
} from '../game/engine';
import { pickPair } from '../game/random';
import { shareText } from '../game/share';
import { dailyStreak, DISTRIBUTION_BUCKETS, recordRound, type ModeStats, type Stats } from '../game/stats';
import * as storage from '../game/storage';
import { WORD_POOL } from '../game/wordPool';
import { $, h, replayAnimation } from './dom';
import { toast } from './toast';

const TIER_LABEL: Record<Tier, string> = { cold: 'Cold', warm: 'Warm', hot: 'Hot', goal: 'Goal!' };
const OP_SYMBOL: Record<Operation, string> = { add: '+', subtract: '−' };
const WIN_HEADLINES = ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Nice!'];
/** Time for the result tile animation before the results dialog opens. */
const RESULT_DIALOG_DELAY_MS = 900;
const GIVE_UP_CONFIRM_MS = 3000;

export class App {
  private mode: Mode = storage.loadMode();
  private readonly rounds = new Map<Mode, Round>();
  private op: Operation = 'add';
  private busy = false;
  private stats: Stats = storage.loadStats();
  private pool: string[] = [];
  private giveUpArmedUntil = 0;
  private giveUpTimer: number | undefined;

  private readonly el = {
    tabs: [...document.querySelectorAll<HTMLButtonElement>('.mode-tab')],
    loading: $('#loading'),
    board: $('#board'),
    startTile: $('#start-tile'),
    goalTile: $('#goal-tile'),
    history: $<HTMLOListElement>('#history'),
    currentLabel: $('#current-label'),
    currentTile: $('#current-tile'),
    meterFill: $('#meter-fill'),
    meterText: $('#meter-text'),
    form: $<HTMLFormElement>('#move-form'),
    input: $<HTMLInputElement>('#word-input'),
    opButtons: [...document.querySelectorAll<HTMLButtonElement>('.op-btn')],
    finished: $('#finished'),
    finishedText: $('#finished-text'),
    finishedActions: $('#finished-actions'),
    stepCount: $('#step-count'),
    giveUp: $<HTMLButtonElement>('#give-up-btn'),
    helpDialog: $<HTMLDialogElement>('#help-dialog'),
    statsDialog: $<HTMLDialogElement>('#stats-dialog'),
    statsBody: $('#stats-body'),
    resultDialog: $<HTMLDialogElement>('#result-dialog'),
    resultBody: $('#result-body'),
    credits: $('#credits'),
  };

  constructor(private readonly engine: Engine) {}

  async start(): Promise<void> {
    const known = await Promise.all(WORD_POOL.map((w) => this.engine.provider.hasWord(w)));
    this.pool = WORD_POOL.filter((_, i) => known[i]);
    const missing = WORD_POOL.filter((_, i) => !known[i]);
    if (missing.length) console.warn('Start/goal words missing from the word vectors:', missing);
    if (this.pool.length < 2) throw new Error('Not enough start/goal words in this dataset');

    document.title = GAME_NAME;
    $('.title').textContent = GAME_NAME;
    const { name, attribution } = this.engine.provider.info;
    this.el.credits.textContent = `Word vectors: ${attribution || name}`;

    await this.ensureRound(this.mode);
    this.bindEvents();
    this.el.loading.hidden = true;
    this.el.board.hidden = false;
    this.render();
    window.setInterval(() => this.tick(), 1000);

    if (!storage.hasSeenHelp()) {
      storage.markHelpSeen();
      this.el.helpDialog.showModal();
    } else if (this.round.status === 'playing' && matchMedia('(pointer: fine)').matches) {
      this.el.input.focus();
    }
  }

  private get round(): Round {
    const round = this.rounds.get(this.mode);
    if (!round) throw new Error(`No round loaded for ${this.mode}`);
    return round;
  }

  // ---- Rounds -------------------------------------------------------------

  private todaysPuzzle(): number {
    return puzzleNumber(new Date(), DAILY_EPOCH);
  }

  /** Load the saved round for `mode`, or start a new one. */
  private async ensureRound(mode: Mode): Promise<void> {
    const existing = this.rounds.get(mode);
    if (existing && (mode === 'unlimited' || existing.puzzle === this.todaysPuzzle())) return;

    const saved = storage.loadRound(mode);
    let round: Round | null = null;
    if (mode === 'daily') {
      const puzzle = this.todaysPuzzle();
      const { start, goal } = dailyPair(puzzle, this.pool);
      const matches = saved?.puzzle === puzzle && saved.start === start && saved.goal === goal;
      round = saved && matches && (await this.isUsable(saved)) ? saved : await this.engine.newRound('daily', start, goal, puzzle);
    } else {
      round = saved && (await this.isUsable(saved)) ? saved : await this.newUnlimitedRound();
    }
    this.rounds.set(mode, round);
    storage.saveRound(round);
  }

  /** A saved round is only usable if its words exist in the current dataset. */
  private async isUsable(round: Round): Promise<boolean> {
    const words = [round.start, round.goal, currentWord(round)];
    return (await Promise.all(words.map((w) => this.engine.provider.hasWord(w)))).every(Boolean);
  }

  private async newUnlimitedRound(): Promise<Round> {
    const { start, goal } = pickPair(this.pool);
    return this.engine.newRound('unlimited', start, goal);
  }

  private setRound(round: Round): void {
    this.rounds.set(round.mode, round);
    storage.saveRound(round);
  }

  private async switchMode(mode: Mode): Promise<void> {
    if (mode === this.mode || this.busy) return;
    this.busy = true;
    try {
      await this.ensureRound(mode);
      this.mode = mode;
      storage.saveMode(mode);
      this.disarmGiveUp();
      this.render();
    } finally {
      this.busy = false;
    }
  }

  private async playAgain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.el.resultDialog.close();
      this.setRound(await this.newUnlimitedRound());
      if (this.mode !== 'unlimited') {
        this.mode = 'unlimited';
        storage.saveMode('unlimited');
      }
      this.render();
      this.el.input.focus();
    } finally {
      this.busy = false;
    }
  }

  // ---- Moves --------------------------------------------------------------

  private async submitMove(): Promise<void> {
    if (this.busy || this.round.status !== 'playing') return;
    const parsed = await this.engine.parseMove(this.el.input.value);
    if (!parsed.ok) {
      this.rejectInput(parsed.message);
      return;
    }
    const op = parsed.op ?? this.op;
    this.busy = true;
    try {
      const next = await this.engine.play(this.round, op, parsed.word);
      if (parsed.corrected) toast(`Using “${parsed.word}”`);
      this.el.input.value = '';
      this.showOp(this.op); // a typed +/- prefix only applies to that one move
      this.setRound(next);
      this.disarmGiveUp();
      this.render({ animateLatest: true });
      if (next.status !== 'playing') this.finishRound(next);
    } catch (error) {
      if (error instanceof MoveError) {
        this.rejectInput(error.message);
      } else {
        console.error(error);
        toast('Something went wrong. Try another word.');
      }
    } finally {
      this.busy = false;
    }
  }

  private rejectInput(message: string): void {
    toast(message);
    replayAnimation(this.el.form, 'is-shaking');
  }

  /** The operation picked with the +/- buttons. */
  private setOp(op: Operation): void {
    this.op = op;
    this.showOp(op);
  }

  /** Highlight a button without changing the picked operation (used while a +/- prefix is typed). */
  private showOp(op: Operation): void {
    for (const button of this.el.opButtons) {
      button.setAttribute('aria-checked', String(button.dataset.op === op));
    }
  }

  private giveUp(): void {
    if (this.busy || this.round.status !== 'playing') return;
    if (Date.now() > this.giveUpArmedUntil) {
      // First tap only arms the button, so a stray tap can't end the game.
      this.giveUpArmedUntil = Date.now() + GIVE_UP_CONFIRM_MS;
      this.el.giveUp.textContent = 'Tap again to give up';
      this.el.giveUp.classList.add('is-armed');
      window.clearTimeout(this.giveUpTimer);
      this.giveUpTimer = window.setTimeout(() => this.disarmGiveUp(), GIVE_UP_CONFIRM_MS);
      return;
    }
    this.disarmGiveUp();
    const next = this.engine.giveUp(this.round);
    this.setRound(next);
    this.render();
    this.finishRound(next);
  }

  private disarmGiveUp(): void {
    window.clearTimeout(this.giveUpTimer);
    this.giveUpArmedUntil = 0;
    this.el.giveUp.textContent = 'Give up';
    this.el.giveUp.classList.remove('is-armed');
  }

  private finishRound(round: Round): void {
    this.stats = recordRound(this.stats, round);
    storage.saveStats(this.stats);
    this.el.input.blur();
    window.setTimeout(() => {
      if (this.rounds.get(round.mode) === round && this.mode === round.mode) this.openResults();
    }, RESULT_DIALOG_DELAY_MS);
  }

  private async share(): Promise<void> {
    const url = location.href.split(/[?#]/)[0];
    const text = shareText(this.round, GAME_NAME, url);
    const mobile = matchMedia('(pointer: coarse)').matches;
    try {
      if (mobile && navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast('Copied results to clipboard');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') toast('Could not share. Try again?');
    }
  }

  /** Runs every second: daily rollover and countdowns. */
  private tick(): void {
    const daily = this.rounds.get('daily');
    if (daily && daily.puzzle !== this.todaysPuzzle() && !this.busy) {
      this.rounds.delete('daily');
      if (this.mode === 'daily') {
        this.busy = true;
        this.ensureRound('daily')
          .then(() => this.render())
          .finally(() => (this.busy = false));
      }
      return;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
      el.textContent = formatCountdown(msUntilNextPuzzle(new Date()));
    }
  }

  // ---- Events -------------------------------------------------------------

  private bindEvents(): void {
    for (const tab of this.el.tabs) {
      tab.addEventListener('click', () => this.switchMode(tab.dataset.mode as Mode));
    }
    for (const button of this.el.opButtons) {
      button.addEventListener('click', () => {
        this.setOp(button.dataset.op as Operation);
        this.el.input.focus();
      });
    }
    this.el.input.addEventListener('input', () => {
      const first = this.el.input.value.trimStart()[0];
      this.showOp(first === '+' ? 'add' : first === '-' || first === '−' ? 'subtract' : this.op);
    });
    this.el.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitMove();
    });
    this.el.giveUp.addEventListener('click', () => this.giveUp());
    $('#help-btn').addEventListener('click', () => this.el.helpDialog.showModal());
    $('#stats-btn').addEventListener('click', () => this.openStats());

    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('click', (event) => {
        // Clicks on the backdrop land on the <dialog> itself.
        const target = event.target as HTMLElement;
        if (target === dialog || target.closest('[data-close]')) dialog.close();
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tick();
    });
  }

  // ---- Rendering ----------------------------------------------------------

  private render(options: { animateLatest?: boolean } = {}): void {
    const round = this.round;
    const playing = round.status === 'playing';

    for (const tab of this.el.tabs) {
      const selected = tab.dataset.mode === this.mode;
      tab.setAttribute('aria-selected', String(selected));
      if (tab.dataset.mode === 'daily') tab.textContent = `Daily #${this.todaysPuzzle()}`;
    }

    this.el.startTile.textContent = round.start;
    this.el.goalTile.textContent = round.goal;

    this.el.history.replaceChildren(
      ...round.steps.map((step, i) =>
        renderStep(step, i, options.animateLatest === true && i === round.steps.length - 1),
      ),
    );

    const closeness = currentCloseness(round);
    this.el.currentLabel.textContent = round.status === 'won' ? 'You reached' : round.steps.length ? 'You are at' : 'You start at';
    this.el.currentTile.textContent = currentWord(round);
    this.el.currentTile.className = `tile tile-lg tier-${closeness.tier}`;
    if (options.animateLatest) replayAnimation(this.el.currentTile, round.status === 'won' ? 'is-winning' : 'is-revealing');
    this.el.meterFill.style.width = `${closeness.score}%`;
    this.el.meterFill.className = `meter-fill tier-${closeness.tier}`;
    this.el.meterText.textContent = describeCloseness(closeness);

    const steps = round.steps.length;
    this.el.stepCount.textContent = `${steps} ${steps === 1 ? 'step' : 'steps'}`;
    this.el.form.hidden = !playing;
    this.el.giveUp.hidden = !playing;
    this.el.finished.hidden = playing;
    if (!playing) {
      this.el.finishedText.textContent =
        round.status === 'won'
          ? `Solved in ${steps} ${steps === 1 ? 'step' : 'steps'}!`
          : `You gave up after ${steps} ${steps === 1 ? 'step' : 'steps'}.`;
      this.el.finishedActions.replaceChildren(...this.finishedActions(false));
    }

    if (options.animateLatest) {
      (playing ? this.el.form : this.el.finished).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /** Buttons shown once a round is over (on the board and in the results dialog). */
  private finishedActions(inDialog: boolean): HTMLElement[] {
    const share = h('button', { class: 'btn btn-primary', type: 'button' }, 'Share');
    share.addEventListener('click', () => this.share());
    const actions: HTMLElement[] = [share];

    if (this.mode === 'unlimited') {
      const next = h('button', { class: 'btn', type: 'button' }, 'New round');
      next.addEventListener('click', () => this.playAgain());
      actions.push(next);
    } else {
      const unlimited = h('button', { class: 'btn', type: 'button' }, 'Play unlimited');
      unlimited.addEventListener('click', () => {
        this.el.resultDialog.close();
        void this.switchMode('unlimited');
      });
      actions.push(unlimited);
    }
    const row = h('div', { class: 'actions' }, ...actions);
    if (this.mode !== 'daily') return [row];
    const countdown = h(
      'p',
      { class: inDialog ? 'countdown countdown-lg' : 'countdown' },
      'Next puzzle in ',
      h('span', { 'data-countdown': true }, formatCountdown(msUntilNextPuzzle(new Date()))),
    );
    return [row, countdown];
  }

  private openResults(): void {
    const round = this.round;
    const won = round.status === 'won';
    const steps = round.steps.length;
    const headline = won ? WIN_HEADLINES[Math.min(steps, WIN_HEADLINES.length) - 1] : 'Better luck next time';

    const path = h('ol', { class: 'path' }, h('li', null, h('span', { class: 'tile tile-sm' }, round.start)));
    for (const step of round.steps) {
      path.append(
        h(
          'li',
          null,
          h('span', { class: 'path-op' }, `${OP_SYMBOL[step.op]} ${step.operand}`),
          h('span', { class: `tile tile-sm tier-${step.closeness.tier}` }, step.result),
        ),
      );
    }

    const modeStats = round.mode === 'daily' ? this.stats.daily : this.stats.unlimited;
    this.el.resultBody.replaceChildren(
      h('h2', { id: 'result-title' }, headline),
      h(
        'p',
        { class: 'lede' },
        won
          ? `You got from ${round.start.toUpperCase()} to ${round.goal.toUpperCase()} in ${steps} ${steps === 1 ? 'step' : 'steps'}.`
          : `The goal was ${round.goal.toUpperCase()}.`,
      ),
      path,
      renderStatNumbers(modeStats, this.streakFor(round.mode)),
      ...this.finishedActions(true),
    );
    if (!this.el.resultDialog.open) this.el.resultDialog.showModal();
  }

  private streakFor(mode: Mode): number {
    return mode === 'daily' ? dailyStreak(this.stats, this.todaysPuzzle()) : this.stats.unlimited.currentStreak;
  }

  private openStats(): void {
    const section = (title: string, stats: ModeStats, streak: number) =>
      h('section', { class: 'stats-section' }, h('h3', null, title), renderStatNumbers(stats, streak), renderDistribution(stats));
    this.el.statsBody.replaceChildren(
      section('Daily', this.stats.daily, this.streakFor('daily')),
      section('Unlimited', this.stats.unlimited, this.streakFor('unlimited')),
    );
    this.el.statsDialog.showModal();
  }
}

function renderStep(step: Step, index: number, isNew: boolean): HTMLLIElement {
  const tier = step.closeness.tier;
  return h(
    'li',
    { class: `step${isNew ? ' is-new' : ''}` },
    h('span', { class: 'step-num' }, index + 1),
    h(
      'span',
      { class: 'step-eq' },
      h('span', { class: 'step-from' }, step.from),
      h('span', { class: `step-op op-${step.op}` }, OP_SYMBOL[step.op]),
      h('span', { class: 'step-operand' }, step.operand),
    ),
    h('span', { class: 'step-arrow', 'aria-hidden': true }, '→'),
    h('span', { class: `tile tile-sm tier-${tier}` }, step.result),
    h('span', { class: 'step-score', title: 'Closeness to the goal (0-100)' }, step.closeness.score),
  );
}

function describeCloseness(c: Closeness): string {
  if (c.tier === 'goal') return 'You reached the goal!';
  const parts = [`${TIER_LABEL[c.tier]} · closeness ${c.score}/100`];
  if (c.rank !== null) parts.push(`#${c.rank.toLocaleString()} nearest to the goal`);
  return parts.join(' · ');
}

function renderStatNumbers(stats: ModeStats, streak: number): HTMLElement {
  const winPct = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  const stat = (value: number, label: string) =>
    h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
  return h(
    'div',
    { class: 'stat-numbers' },
    stat(stats.played, 'Played'),
    stat(winPct, 'Win %'),
    stat(streak, 'Current streak'),
    stat(stats.maxStreak, 'Max streak'),
  );
}

function renderDistribution(stats: ModeStats): HTMLElement {
  const max = Math.max(1, ...stats.distribution);
  const rows = stats.distribution.map((count, i) => {
    const label = i === DISTRIBUTION_BUCKETS - 1 ? `${i + 1}+` : `${i + 1}`;
    return h(
      'div',
      { class: 'dist-row' },
      h('span', { class: 'dist-label' }, label),
      h(
        'span',
        { class: 'dist-bar-track' },
        h('span', { class: `dist-bar${count ? ' has-value' : ''}`, style: `width: ${Math.max(7, (count / max) * 100)}%` }, count),
      ),
    );
  });
  return h('div', { class: 'distribution', 'aria-label': 'Wins by number of steps' }, h('h4', null, 'Steps to solve'), ...rows);
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
