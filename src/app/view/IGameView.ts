import type { GameState, Order } from '../../engine';

/**
 * Thin presentation contract so v2 (Three.js) can swap renderers.
 * Phaser implements this implicitly via GameController callbacks.
 */
export interface IGameView {
  onState(state: GameState): void;
  onMessage(text: string): void;
}

export type OrderSubmit = (order: Order) => void;
