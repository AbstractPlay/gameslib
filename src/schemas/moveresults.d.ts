/* tslint:disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Written information about changes in game state after a move are encoded as a JSON object matching this schema. The goal is to then allow localized statements to be generated from them.
 */
export type APMoveResult =
  | {
      type: "place";
      where?: string;
      what?: string;
    }
  | {
      type: "move";
      from: string;
      to: string;
      what?: string;
    }
  | {
      type: "capture";
      where?: string;
      what?: string;
      count?: number;
    }
  | {
      type: "take";
      what?: string;
      from: string;
    }
  | {
      type: "pass";
    }
  | {
      type: "deltaScore";
      delta?: number;
    }
  | {
      type: "reclaim";
      what?: string;
    }
  | {
      type: "block";
      /**
       * Use this for blocking off a single space
       */
      where?: string;
      /**
       * Use this to block between two spaces
       */
      between?: [string, string];
    }
  | {
      type: "eog";
      reason?: string;
    }
  | {
      type: "winners";
      players: number[];
    }
  | {
      type: "draw";
    }
  | {
      type: "resigned";
      player: number;
    }
  | {
      type: "kicked";
      player: number;
    }
  | {
      type: "promote";
      from?: string;
      to: string;
      where?: string;
    }
  | {
      type: "eliminated";
      who: string;
    }
  | {
      type: "homeworld";
      stars: string[];
      ship: string;
      name: string;
    }
  | {
      type: "discover";
      what?: string;
      where?: string;
      called?: string;
    }
  | {
      type: "convert";
      what: string;
      into: string;
      where?: string;
    }
  | {
      type: "sacrifice";
      what: string;
      where?: string;
    }
  | {
      type: "catastrophe";
      where: string;
      trigger?: string;
    }
  | {
      type: "eject";
      from: string;
      to: string;
      what?: string;
    }
  | {
      type: "orient";
      what?: string;
      where?: string;
      facing: string;
    }
  | {
      type: "detonate";
      what?: string;
      where?: string;
    }
  | {
      type: "destroy";
      what?: string;
      where?: string;
    }
  | {
      type: "bearoff";
      what?: string;
      from: string;
      edge?: string;
    }
  | {
      type: "add";
      where: string;
      num: number;
    }
  | {
      type: "remove";
      where: string;
      num: number;
    }
  | {
      type: "claim";
      where: string;
      who?: string;
    };
