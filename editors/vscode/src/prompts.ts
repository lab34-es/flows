import * as vscode from 'vscode';

import type { InputRequest } from './core/tracker';

/**
 * What a step asks the person running the flow -- the barcode of a parcel, a
 * code shown on some system -- asked where they are: an input box at the top
 * of the window, as any question VS Code itself asks. Enter answers it, and
 * Escape refuses to, which fails the step and lets the run end rather than
 * wait for ever.
 *
 * One question at a time. A question the run stopped waiting for (it was
 * answered elsewhere, or the flow ended) is taken away.
 */

interface Question {
  request: InputRequest;
  title: string;
  answer: (value: string) => void;
  refuse: () => void;
}

export class Prompts implements vscode.Disposable {
  private readonly queue: Question[] = [];
  private current: { question: Question; box: vscode.InputBox; withdrawn: boolean } | null = null;

  /** Ask a question, once the ones before it are answered. */
  ask(question: Question) {
    this.queue.push(question);
    if (!this.current) { this.next(); }
  }

  /** The run no longer waits for an answer to this one. */
  withdraw(id: string) {
    if (this.current && this.current.question.request.id === id) {
      this.current.withdrawn = true;
      this.current.box.hide();
      return;
    }

    const queued = this.queue.findIndex(question => question.request.id === id);
    if (queued !== -1) { this.queue.splice(queued, 1); }
  }

  private next() {
    const question = this.queue.shift();
    if (!question) { return; }

    const { request } = question;
    const box = vscode.window.createInputBox();
    const current = { question, box, withdrawn: false };
    let answered = false;

    box.title = question.title;
    box.prompt = request.label;
    box.password = Boolean(request.secret);
    box.value = request.defaultValue ?? '';
    box.placeholder = 'Enter to answer, Escape to fail the step';
    box.ignoreFocusOut = true;

    box.onDidAccept(() => {
      answered = true;
      question.answer(box.value);
      box.hide();
    });

    box.onDidHide(() => {
      if (!answered && !current.withdrawn) { question.refuse(); }
      box.dispose();
      this.current = null;
      this.next();
    });

    this.current = current;
    box.show();
  }

  dispose() {
    this.queue.length = 0;
    if (this.current) {
      this.current.withdrawn = true;
      this.current.box.dispose();
      this.current = null;
    }
  }
}
