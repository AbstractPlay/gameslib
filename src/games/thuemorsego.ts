import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, AreaTrack, BoardBasic, ColourResolvable, Colourfuncs, Glyph, MarkerDots, MarkerLine, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, shuffle, SnubSquareGraph, UserFacingError } from "../common/index.js";
import type { FlagContext, GameFlag } from "../common/flags.js";
import { makeGeometry, otherColour, passAliveStrings, signature, stringAt, type Board, type Geometry, type Stone } from "./killallgo.js";
import i18next from "i18next";
import { gameApgamesUidKey } from "../common/game-apgames-t.js";

/** Variant and display labels are resolved in {@link GameBase}; anchors for strict apgames key coverage. */
void gameApgamesUidKey("thuemorsego", "variants", "size-11", "name");
void gameApgamesUidKey("thuemorsego", "variants", "#board", "name");
void gameApgamesUidKey("thuemorsego", "variants", "size-19", "name");
void gameApgamesUidKey("thuemorsego", "variants", "size-23", "name");
void gameApgamesUidKey("thuemorsego", "variants", "#connect", "name");
void gameApgamesUidKey("thuemorsego", "variants", "#connect", "description");
void gameApgamesUidKey("thuemorsego", "variants", "snub", "name");
void gameApgamesUidKey("thuemorsego", "variants", "snub", "description");
void gameApgamesUidKey("thuemorsego", "variants", "#protocol", "name");
void gameApgamesUidKey("thuemorsego", "variants", "#protocol", "description");
void gameApgamesUidKey("thuemorsego", "variants", "marseillais", "name");
void gameApgamesUidKey("thuemorsego", "variants", "marseillais", "description");
void gameApgamesUidKey("thuemorsego", "variants", "handicap", "name");
void gameApgamesUidKey("thuemorsego", "variants", "handicap", "description");
void gameApgamesUidKey("thuemorsego", "variants", "reverse-komi", "name");
void gameApgamesUidKey("thuemorsego", "variants", "reverse-komi", "description");
void gameApgamesUidKey("thuemorsego", "variants", "#repetition", "name");
void gameApgamesUidKey("thuemorsego", "variants", "#repetition", "description");
void gameApgamesUidKey("thuemorsego", "variants", "superko", "name");
void gameApgamesUidKey("thuemorsego", "variants", "superko", "description");
void gameApgamesUidKey("thuemorsego", "variants", "double-delayed-psk", "name");
void gameApgamesUidKey("thuemorsego", "variants", "double-delayed-psk", "description");
void gameApgamesUidKey("thuemorsego", "variants", "weak-eyes", "name");
void gameApgamesUidKey("thuemorsego", "variants", "weak-eyes", "description");
void gameApgamesUidKey("thuemorsego", "variants", "half-button", "name");
void gameApgamesUidKey("thuemorsego", "variants", "half-button", "description");
void gameApgamesUidKey("thuemorsego", "variants", "kill-all", "name");
void gameApgamesUidKey("thuemorsego", "variants", "kill-all", "description");
void gameApgamesUidKey("thuemorsego", "displays", "tms-tracker", "name");
void gameApgamesUidKey("thuemorsego", "displays", "tms-tracker", "description");
void gameApgamesUidKey("thuemorsego", "displays", "digits-down", "name");
void gameApgamesUidKey("thuemorsego", "displays", "digits-down", "description");
void gameApgamesUidKey("thuemorsego", "displays", "hide-territory", "name");
void gameApgamesUidKey("thuemorsego", "displays", "hide-territory", "description");
void gameApgamesUidKey("thuemorsego", "displays", "palette-borders", "name");
void gameApgamesUidKey("thuemorsego", "displays", "palette-borders", "description");
void gameApgamesUidKey("thuemorsego", "displays", "pass-alive-throughout", "name");
void gameApgamesUidKey("thuemorsego", "displays", "pass-alive-throughout", "description");

export const gameApgamesEn = {
    validation: {
        INSTRUCTIONS_PLAY_one: "Place a stone, or pass; this move is a single placement.",
        INSTRUCTIONS_PLAY_other: "This move is {{count}} placements: place up to {{count}} stones, or submit early to pass the rest.",
        INSTRUCTIONS_PLAY_BUTTON_one: "Place a stone, pass, or take the button (worth {{points}}); this move is a single placement.",
        INSTRUCTIONS_PLAY_BUTTON_other: "This move is {{count}} placements: place up to {{count}} stones, take the button (worth {{points}}) in place of one, or submit early to pass the rest.",
        INSTRUCTIONS_PLAY_FORCED: "The first placement of this move is given away as a handicap stone. Place a stone for the other, or pass.",
        INSTRUCTIONS_PLAY_FORCED_BUTTON: "The first placement of this move is given away as a handicap stone. Place a stone for the other, take the button (worth {{points}}), or pass.",
        INSTRUCTIONS_PLAY_DEFENDER_one: "Place a stone. You win by forming one unconditionally alive string.",
        INSTRUCTIONS_PLAY_DEFENDER_other: "Place {{count}} stones. You win by forming one unconditionally alive string.",
        INSTRUCTIONS_PLAY_ATTACKER_one: "Place a stone. You win by preventing the Defender from forming an unconditionally alive string.",
        INSTRUCTIONS_PLAY_ATTACKER_other: "Place {{count}} stones. You win by preventing the Defender from forming an unconditionally alive string.",
        INSTRUCTIONS_DECLARE: "You are giving the handicap. Click a numbered stone to set how many handicap stones you give, from 1 to {{max}}: you pass that many placements while your opponent places freely, and this declaration is the first of them.",
        INSTRUCTIONS_BOTH: "Begin this move with the reverse komi and the handicap, in either order. Click a numbered stone in the upper row, or enter any whole number from 1 to {{max}} in the move box, to set how many points you give your opponent; click one in the lower row to set how many handicap stones you give, from 1 to {{stones}}. The komi costs no placement; the handicap stones are the placements you pass, this declaration being the first of them.",
        HANDICAP_THEN_KOMI_one: "Handicap of {{count}} stone. Now choose the reverse komi: click a numbered stone in the upper row, or enter a whole number in the move box.",
        HANDICAP_THEN_KOMI_other: "Handicap of {{count}} stones. Now choose the reverse komi: click a numbered stone in the upper row, or enter a whole number in the move box.",
        KOMI_MISSING: "Choose the reverse komi before placing a stone: click a numbered stone in the upper row, or enter a whole number first.",
        DECLARE_MISSING: "Choose the handicap before placing a stone: click one of its numbered stones first.",
        CHOOSE_FIRST: "Choose the reverse komi and the handicap first: click a numbered stone from each row. {{where}} is not one of them.",
        BAD_DECLARATION: "The reverse komi and the handicap come before the placements, once each: a number of points as 14p and a number of stones as 3s, in either order, or plain numbers in that order.",
        DECLARE_RANGE: "The handicap must be between 1 and {{max}} stones.",
        DECLARE_NO_PLACEMENT: "With a handicap of {{count}} stones, every placement of this move is given away.",
        DECLARE_OK_one: "Handicap of one stone. Submit, or click a different numbered stone.",
        DECLARE_OK_other: "Handicap of {{count}} stones. Submit, or click a different numbered stone.",
        DECLARE_ONE: "Handicap of one stone, given by this declaration. Place a stone as the second placement of this move, or submit to pass it.",
        DECLARE_ONE_BUTTON: "Handicap of one stone, given by this declaration. Place a stone or take the button as the second placement of this move, or submit to pass it.",
        DECLARE_FIRST: "Choose the handicap first: click one of its numbered stones. {{where}} is not one of them.",
        NO_PLACEMENT_LEFT: "This move has no placement left to make: submit, or click a numbered stone to change your choice.",
        TOO_MANY_one: "This move has only one placement left to fill.",
        TOO_MANY_other: "This move has only {{count}} placements left to fill.",
        FORCED_MOVE: "Every placement of this move is given away as handicap stones, which happens automatically.",
        NO_PASS: "Passing is not allowed in Kill-All games.",
        NO_BUTTON: "There is no button in this game.",
        BUTTON_TAKEN: "The button has already been taken.",
        KO_PSK: "That placement would recreate an earlier position of the board (positional superko).",
        KO_PSK_DDPSK: "That placement would recreate an earlier position of the board for the fourth time (double delayed superko).",
        SUICIDE_REPEAT: "That stone has no liberties and captures nothing, so it is removed as suicide and the board is left as it was, which positional superko forbids.",
        SUICIDE_REPEAT_DDPSK: "That stone has no liberties and captures nothing, so it is removed as suicide and the board is left as it was, a position that has already arisen three times, which double delayed superko forbids.",
        SUICIDE_REPEAT_MOVE: "The stones placed this move have no liberties and capture nothing, so the clearing after its last placement removes them and leaves the board as it was before the move, which positional superko forbids.",
        SUICIDE_REPEAT_MOVE_DDPSK: "The stones placed this move have no liberties and capture nothing, so the clearing after its last placement removes them and leaves the board as it was before the move, a position that has already arisen three times, which double delayed superko forbids.",
        OVER_MID_MOVE: "The game ended at the previous placement.",
        PLACE_MORE_one: "Place one more stone.",
        PLACE_MORE_other: "Place {{count}} more stones.",
        DEAD_END: "No legal placement can follow that one; choose a different placement.",
        MUST_CONTINUE: "Ending the move here would recreate an earlier position of the board; place another stone, or choose a different placement.",
        MUST_CONTINUE_SUICIDE: "Ending the move here would leave that stone with no liberties and nothing captured, so it would be removed as suicide and the board left as it was; place another stone, or choose a different placement.",
        INSTRUCTIONS_HANDICAP: "You are giving the handicap. Click a numbered stone to set how many extra Attacker stones, from 1 to {{max}}, your opponent will place if they take the Attacker side.",
        HANDICAP_INVALID: "The handicap must be a whole number.",
        HANDICAP_RANGE: "The handicap must be between 1 and {{max}} stones.",
        HANDICAP_OK_one: "Handicap of one stone. Submit, or click a different numbered stone.",
        HANDICAP_OK_other: "Handicap of {{count}} stones. Submit, or click a different numbered stone.",
        NOT_A_NUMBERED_STONE: "{{where}} is not one of the numbered stones.",
        INSTRUCTIONS_ALT: "Place an Attacker stone to continue the opening, or choose to play as the Attacker. If you choose the Attacker, your opponent moves first as the Defender.",
        INSTRUCTIONS_ALT_HANDICAP_one: "Place an Attacker stone to continue the opening, or choose to play as the Attacker. If you choose the Attacker, place one extra stone; your opponent then moves first as the Defender.",
        INSTRUCTIONS_ALT_HANDICAP_other: "Place an Attacker stone to continue the opening, or choose to play as the Attacker. If you choose the Attacker, place {{count}} extra stones; your opponent then moves first as the Defender.",
        SETUP_FULL: "The board already holds the maximum number of setup stones this phase allows ({{max}}); take the Attacker side instead of placing another.",
        ATTACKER_NO_STONES: "Taking the Attacker side does not involve placing stones now.",
        STONES_LEFT_one: "Place one more Attacker stone.",
        STONES_LEFT_other: "Place {{count}} more Attacker stones.",
        BATCH_TOO_MANY_one: "You must place exactly one extra Attacker stone.",
        BATCH_TOO_MANY_other: "You must place exactly {{count}} extra Attacker stones.",
        DUPLICATE_CELL: "The cell {{where}} is listed twice.",
        INVALID_PASS: "You cannot pass now.",
        INSTRUCTIONS_KOMI: "Begin this move with the reverse komi: click one of the numbered stones, or enter any whole number from 1 to {{max}} in the move box, to set how many points you give your opponent. It costs no placement; your stones follow it.",
        KOMI_INVALID: "This move must begin with the reverse komi: a whole number from 1 to {{max}}, the numbered stones offering the multiples of 14.",
        KOMI_THEN_PLACE_one: "Reverse komi of {{count}} point to your opponent. Now place your stones, or submit to pass this move.",
        KOMI_THEN_PLACE_other: "Reverse komi of {{count}} points to your opponent. Now place your stones, or submit to pass this move.",
        KOMI_THEN_DECLARE_one: "Reverse komi of {{count}} point to your opponent. Now click a numbered stone in the lower row to set the handicap.",
        KOMI_THEN_DECLARE_other: "Reverse komi of {{count}} points to your opponent. Now click a numbered stone in the lower row to set the handicap.",
        KOMI_FIRST: "Choose the reverse komi first: click one of its numbered stones, or enter a whole number in the move box. {{where}} is not one of the numbered stones.",
        OCCUPIED_MARK: "{{where}} is occupied. To mark its string as dead, press Pass first, then click the string; in a two-placement move a stone can still be placed for one of the placements.",
        MARKS_NEED_PASS: "Strings can be marked dead only in a move that passes at least one placement: pass first, then click or name the strings.",
        MARK_EMPTY: "There is no stone at {{where}} to mark dead.",
        MARKS_LOCKED: "Strings can no longer be marked dead: dead-stone marking ended when a move passing nothing, or a pass marking nothing dead, followed a marking. Capture any dead stones on the board, then end the game with two whole-move passes in turn; every stone still on the board then counts as alive.",
        PASS_OPEN_zero: "Submit to pass this move, click strings to mark them dead first, or place a stone instead. If your opponent then passes keeping the marking, the game ends with the marked strings removed.",
        PASS_OPEN_one: "Submit to pass this move with one stone marked dead, or click strings to change the marking. If your opponent then passes keeping it, the game ends with the marked strings removed.",
        PASS_OPEN_other: "Submit to pass this move with {{count}} stones marked dead, or click strings to change the marking. If your opponent then passes keeping it, the game ends with the marked strings removed.",
        PASS_AGREE_zero: "Your opponent passed with no strings marked dead. Submit to pass and end the game, or click strings to mark them dead, after which your opponent may pass to accept the marking or play on.",
        PASS_AGREE_one: "Your opponent passed with one stone marked dead. Submit to pass and end the game with it removed, or click strings to change the marking, after which your opponent may pass to accept it or play on.",
        PASS_AGREE_other: "Your opponent passed with {{count}} stones marked dead. Submit to pass and end the game with them removed, or click strings to change the marking, after which your opponent may pass to accept it or play on.",
        PASS_DISPUTE_one: "This changes your opponent's marking to one stone marked dead, so the game goes on: your opponent may pass to accept it, change it again, or play on. Submit, or click strings to change the marking.",
        PASS_DISPUTE_other: "This changes your opponent's marking to {{count}} stones marked dead, so the game goes on: your opponent may pass to accept it, change it again, or play on. Submit, or click strings to change the marking.",
        PASS_PLACE_zero: "Submit to pass the rest of this move, or place another stone. Passing part of a move does not end the game, but your opponent may then pass their whole move to end it.",
        PASS_PLACE_one: "Submit to pass the rest of this move with one stone marked dead, or place another stone. Passing part of a move does not end the game, but your opponent may then pass their whole move keeping the marking to end it with the marked string removed.",
        PASS_PLACE_other: "Submit to pass the rest of this move with {{count}} stones marked dead, or place another stone. Passing part of a move does not end the game, but your opponent may then pass their whole move keeping the marking to end it with the marked strings removed.",
        PASS_LOCKED_PLACE: "Dead-stone marking has ended for this game, so passes carry no marking. Submit to pass the rest of this move, or place another stone; your opponent may then pass their whole move to end the game with every stone alive.",
        PASS_CLEARS: "Passing with no strings marked dead after a marking ends dead-stone marking for the rest of the game: the game goes on, dead stones must be captured, and the game ends when both players pass their whole moves in turn, with every stone on the board alive. Submit, or click strings to mark them dead instead.",
        PASS_CLEARS_PLACE: "Passing the rest of this move with no strings marked dead after a marking ends dead-stone marking for the rest of the game, as does placing another stone: the game goes on, dead stones must be captured, and the game ends when both players pass their whole moves in turn, with every stone on the board alive. Submit, or place another stone.",
        MARK_CLICK: "Click strings to mark them dead, or to change the marking.",
        MARK_HINT: "To mark strings dead as well, press Pass first, then place the stone again and click them.",
        PLACING_ENDS_MARKING: "This move passes nothing, so it ends dead-stone marking for the rest of the game: dead stones must then be captured, and the game ends when both players pass their whole moves in turn, with every stone on the board alive.",
        MARKING_PENDING_one: "One stone is marked dead. Pass at least one placement to answer the marking; a move that passes nothing ends dead-stone marking for the rest of the game.",
        MARKING_PENDING_other: "{{count}} stones are marked dead. Pass at least one placement to answer the marking; a move that passes nothing ends dead-stone marking for the rest of the game.",
        PASS_LOCKED: "Dead-stone marking has ended for this game, so passes carry no marking. Submit to pass this move, or place a stone for one of its placements; if your opponent then passes their whole move, the game ends with every stone alive.",
        PASS_LOCKED_ENDS: "Dead-stone marking has ended for this game, so passes carry no marking. Your opponent's last move passed: submit to pass this move and end the game with every stone alive, or place a stone to play on.",
    },
    variants: {
        "size-11": {
            name: "11x11 board",
        },
        "#board": {
            name: "16x16 board",
        },
        "size-19": {
            name: "19x19 board",
        },
        "size-23": {
            name: "23x23 board",
        },
        "#connect": {
            name: "Square",
            description: "Points connect orthogonally, as in Go.",
        },
        snub: {
            name: "Snub square",
            description: "Points connect as in the snub square tiling, so each point has five neighbours and the board contains triangles.",
        },
        "#protocol": {
            name: "Thue-Morse",
            description: "Placements follow the full Thue-Morse sequence: 0110 1001 1001 0110 …",
        },
        marseillais: {
            name: "Balanced Marseillais",
            description: "Placements repeat the first four terms of the Thue-Morse sequence, ABBA, also known as 12* or T(2).",
        },
        handicap: {
            name: "Handicap stones",
            description: "Player 2 begins their first move by giving Player 1 a number of handicap stones, up to a fortieth of the board's points: Player 2 passes that many placements, the declaration being the first, while Player 1 places freely. In Kill-All games, Player 1 instead sets a number of extra Attacker stones, up to twice that, which Player 2 places immediately on claiming the Attacker side.",
        },
        "reverse-komi": {
            name: "Reverse komi",
            description: "Player 2 begins their first move by giving Player 1 a reverse komi: a whole number of points up to 14 times the handicap limit, the numbered stones offering the multiples of 14, added to Player 1's score at the end of the game. Unlike the handicap it costs no placement; it comes before any handicap declaration. Cannot be combined with Kill-All, and makes the game unrated.",
        },
        "#repetition": {
            name: "5-fold repetition draw",
            description: "No ko rule: the fifth occurrence of a position ends the game in a draw. Intended for players who don't mind draws and want to let short cycles play out.",
        },
        superko: {
            name: "Positional superko (PSK)",
            description: "No placement may recreate an earlier position of the board. Intended for players who want to keep the ko prohibition from Go.",
        },
        "double-delayed-psk": {
            name: "Double delayed PSK",
            description: "Like positional superko, except that a position may arise three times: only a placement that would make a fourth occurrence is forbidden. Intended for players who dislike draws and want to let short cycles play out.",
        },
        "weak-eyes": {
            name: "Weak eyes",
            description: "When checked, only the last placement of a move clears the board or checks repetition, so a two-placement move can fill both eyes of a group and three eyes are needed to live. Unchecked, every placement clears the board and two eyes live.",
        },
        "half-button": {
            name: "0.5 point button",
            description: "Any placement may instead take the button, worth half a point to whoever takes it first, on any board, which prevents tied scores. Unchecked, the button evens the count instead: a 1-point button on boards with an odd number of points and none on boards with an even number, so the points at stake always add up to an even number. Kill-All games have no button.",
        },
        "kill-all": {
            name: "Kill-All",
            description: "Players take turns placing Attacker stones until one of them claims the Attacker side; the other plays the Defender, places first, and wins by forming an unconditionally alive string. Cannot be combined with the 0.5 point button, and has no button.",
        },
    },
    displays: {
        "tms-tracker": {
            name: "TMS tracker",
            description: "Show the tracker as the three hexadecimal digits of the next placement's index, one column of 16 per digit, instead of a single column of the next 16 placements.",
        },
        "digits-down": {
            name: "Tracker runs downward",
            description: "Run the tracker from the top down: the next placement at the top of the column, or digit 0 at the top of each column of the digit tracker.",
        },
        "hide-territory": {
            name: "Hide territory dots",
            description: "Do not dot the points that count as territory as the board stands: the empty points reaching stones of only one colour, with the strings marked dead removed. Strings marked dead are still shown faded. Kill-All games show no territory anyway.",
        },
        "palette-borders": {
            name: "Stone borders from the palette",
            description: "Draw the border of each stone in palette slot 5 to 8, for stones in slots 1 to 4, instead of black or white, whichever contrasts better with the fill. The palette must have at least eight colours.",
        },
        "pass-alive-throughout": {
            name: "Mark pass-alive stones throughout the game",
            description: "In Kill-All games, show the unconditionally alive (pass-alive) stones of both sides faded in every position, not only in the position that ended the game. Does nothing outside Kill-All games.",
        },
    },
    buttons: {
        attacker: "Play as the Attacker",
    },
    status: {
        NEXT_PLACEMENT: "Next placements (hex)",
        BUTTON: "Button",
        BUTTON_AVAILABLE: "Available",
        PASSES_OWED: "Handicap stones still to give",
        DEFENDER: "Defender",
        ATTACKER: "Attacker",
        UNDECIDED: "Not yet chosen",
        HANDICAP: "Handicap stones",
        PHASE_HAND_N: "{{player}} sets the number of handicap stones",
        PHASE_ALT_PLACE: "{{player}} places an Attacker stone or takes the Attacker side",
        PHASE_DECLARE: "{{player}} sets the number of handicap stones",
        PHASE_KOMI: "{{player}} chooses the reverse komi",
        PHASE_KOMI_DECLARE: "{{player}} chooses the reverse komi and the handicap",
        KOMI: "Reverse komi",
        MARKING: "Dead-stone marking",
        MARKING_COUNT_one: "One stone marked dead",
        MARKING_COUNT_other: "{{count}} stones marked dead",
        MARKING_LOCKED: "Ended: all dead stones should be manually captured before passing",
    },
};

export const gameApresultsEn = {
    CAPTURE: {
        suicide_one: "{{player}} removed their own stone by suicide.",
        suicide_other: "{{player}} removed {{count}} of their own stones by suicide.",
    },
    CLAIM: {
        attacker: "{{player}} chose to play as the Attacker.",
    },
    DECLARE: {
        stones_one: "{{player}} set the handicap to one stone.",
        stones_other: "{{player}} set the handicap to {{count}} stones.",
        komi_one: "{{player}} gave their opponent a reverse komi of {{count}} point.",
        komi_other: "{{player}} gave their opponent a reverse komi of {{count}} points.",
    },
    EOG: {
        repetition: "The game has ended in a draw because the same position occurred five times.",
        pass_alive: "The game has ended because the Defender formed an unconditionally alive string.",
        no_room: "The game has ended because the Attacker's unconditionally alive stones leave the Defender no room to form an unconditionally alive string.",
        no_moves: "The game has ended because the player to move has no legal move.",
    },
    PASS: {
        handicap: "{{player}} gave a handicap stone by passing.",
    },
    PLACE: {
        setup: "{{player}} placed an Attacker stone at {{where}}.",
    },
    REMOVE: {
        dead_one: "The stone marked dead was removed from the board.",
        dead_other: "The {{count}} stones marked dead were removed from the board.",
    },
    SELECT: {
        marked_one: "{{player}} marked one stone as dead.",
        marked_other: "{{player}} marked {{count}} stones as dead.",
        changed_one: "{{player}} changed the marking: one stone is marked dead.",
        changed_other: "{{player}} changed the marking: {{count}} stones are marked dead.",
        cleared: "{{player}} cleared the marking: no stones are marked dead.",
        locked: "Dead-stone marking has ended: no stones are marked dead, and passes carry no marking for the rest of the game.",
    },
};

/**
 * Thue-Morse Go.
 *
 * Go under Tromp-Taylor rules in which the order of placements follows the Thue-Morse sequence
 * (0110 1001 1001 0110 …): placement n belongs to colour 1 when n has an even number of 1 bits
 * and to colour 2 otherwise. A move is a maximal run of placements by one colour, so every move
 * is one or two placements and the seats alternate moves exactly as in ordinary Go.
 *
 * Colours are seats in the standard game. In the Kill-All variant colour 1 is the Defender
 * (Red, who places first) and colour 2 the Attacker (Blue); `defenderSeat` records which seat
 * plays Red once pieboxing has decided it.
 */
type playerid = 1 | 2;

type Phase =
    | "hand-n"      // Kill-All handicap: Player 1 types the number of extra Attacker stones
    | "alt-place"   // Kill-All pieboxing: alternating Attacker stones until someone takes them
    | "play";       // Thue-Morse placements

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Board;
    lastmove?: string;
    phase: Phase;
    /** Index of the next placement; its Thue-Morse digit names the colour to place. */
    placed: number;
    /** Seats of the trailing run of moves that each passed at least one placement voluntarily. */
    passes: playerid[];
    /** Positions this move created other than the saved board (positional superko, repetition). */
    interim: string[];
    /** Whether the saved board is a position this move created (false after a move without a stone). */
    novel: boolean;
    /** Stones of the strings the last pass marked dead, in board order. */
    marks: string[];
    /** Whether dead-stone marking has ended for the rest of the game, so that passes carry none. */
    locked: boolean;
    /** The seat holding the button. */
    button?: playerid;
    /** The declared handicap: passes in the standard game, extra Attacker stones in Kill-All. */
    handicap?: number;
    /** Standard handicap: passes Player 2 still has to serve. */
    passesOwed?: number;
    /** Reverse komi: the points Player 2 chose, with their first move, to have added to their score. */
    komi?: number;
    defenderSeat?: playerid;
    /** The stones that decided a Kill-All game. */
    alive?: string[];
}

export interface IThueMorseGoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

interface ILegend {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
}

/** An empty region of the board and the colour it scores for, when it reaches only one. */
interface IRegion {
    cells: string[];
    owner?: Stone;
}

/** One numbered stone of an on-board picker. */
interface IPickerButton {
    cell: string;
    value: number;
}

/** The messages saying why a click means nothing now, by the outcome that names them. */
const CLICK_ERROR_KEYS = {
    NOT_A_NUMBERED_STONE: "apgames:validation.thuemorsego.NOT_A_NUMBERED_STONE",
    KOMI_FIRST: "apgames:validation.thuemorsego.KOMI_FIRST",
    DECLARE_FIRST: "apgames:validation.thuemorsego.DECLARE_FIRST",
    CHOOSE_FIRST: "apgames:validation.thuemorsego.CHOOSE_FIRST",
    NO_PLACEMENT_LEFT: "apgames:validation.thuemorsego.NO_PLACEMENT_LEFT",
} as const;

/** What a click does: the move it leaves, or why it does nothing. */
type IClickOutcome = { move: string } | { error: keyof typeof CLICK_ERROR_KEYS };

/** The messages of the errors a placement token can meet, by the code `applyToken` reports. */
const TOKEN_ERROR_KEYS = {
    OVER_MID_MOVE: "apgames:validation.thuemorsego.OVER_MID_MOVE",
    TOO_MANY: "apgames:validation.thuemorsego.TOO_MANY",
    NO_PASS: "apgames:validation.thuemorsego.NO_PASS",
    NO_BUTTON: "apgames:validation.thuemorsego.NO_BUTTON",
    BUTTON_TAKEN: "apgames:validation.thuemorsego.BUTTON_TAKEN",
    KO_PSK: "apgames:validation.thuemorsego.KO_PSK",
    KO_PSK_DDPSK: "apgames:validation.thuemorsego.KO_PSK_DDPSK",
    SUICIDE_REPEAT: "apgames:validation.thuemorsego.SUICIDE_REPEAT",
    SUICIDE_REPEAT_DDPSK: "apgames:validation.thuemorsego.SUICIDE_REPEAT_DDPSK",
    SUICIDE_REPEAT_MOVE: "apgames:validation.thuemorsego.SUICIDE_REPEAT_MOVE",
    SUICIDE_REPEAT_MOVE_DDPSK: "apgames:validation.thuemorsego.SUICIDE_REPEAT_MOVE_DDPSK",
} as const;

/** The codes of the errors a placement token can meet; the last three take the token itself. */
type TokenError = keyof typeof TOKEN_ERROR_KEYS | "INVALIDCELL" | "OCCUPIED" | "INCOMPLETE";

/** The parts of Player 2's first move: the declarations it names, and what follows them. */
interface IFirstMove {
    komi?: string;
    handicap?: string;
    placements: string[];
    /** Set when the declarations are malformed. */
    error?: "BAD_DECLARATION";
}

/**
 * A move in progress: the board and bookkeeping as the placements of one move are applied, on a
 * scratch copy while validating and enumerating, and committed to the game when a move is made.
 */
interface ISim {
    board: Board;
    /** Occurrence counts of every position reached before this move (shared, never mutated). */
    base: Map<string, number>;
    results: APMoveResult[];
    /** The position at the start of the move. */
    start: string;
    /** Positions created so far in this move, in order; the last is the board as it stands. */
    created: string[];
    /** Opponent stones captured so far in this move. */
    captured: number;
    /** Own stones removed by suicide so far in this move. */
    suicided: number;
    /** Placements in this move. */
    length: number;
    /** Placements consumed so far, the handicap passes served at its start included. */
    placed: number;
    buttonTaken: boolean;
    placedStone: boolean;
    /** Checked weak eyes: whether the move's deferred clearing has happened. */
    cleared: boolean;
    /** Whether the game ended during this move (repetition draw). */
    over: boolean;
}

const UNDECIDED_COLOUR = "#999999";
/** The palette slots of the Kill-All roles, used when a palette for this game sets them. */
const ATTACKER_SLOT = 3;
const DEFENDER_SLOT = 4;
/** The colours the Kill-All roles take otherwise: the Attacker the first, as in Kill-All Go. */
const ATTACKER_DEFAULT = 1;
const DEFENDER_DEFAULT = 2;
const CELL_RE = /^[a-z]+\d+$/;
const TRACK_ROWS = 16;
const TRACK_DIGITS = 3;
/** sqrt(1/3): the small tracker glyphs have about a third of the area of the digit markers. */
const SMALL_SCALE = 0.57735;
const TRACK_TINT = 0.2;
/** The palette slot of a stone's border lies this far above the slot of its fill: 5 to 8 for 1 to 4. */
const BORDER_SLOT_OFFSET = 4;
const REPETITIONS_FOR_DRAW = 5;
/** The reverse komi comes in multiples of this many points. */
const KOMI_STEP = 14;
/**
 * The legend keys of the tracker's glyphs: the small stones s1/s2 (s0 when grey), the rolling
 * tracker's plain markers m1/m2, and the TMS tracker's digit markers m1d0 to m2df.
 */
const TRACK_KEY_RE = /^(s[012]|m[12](d[0-9a-f])?)$/;
/** The last placement the digit tracker's three columns can show; past it the tracker goes grey. */
const MAX_TRACK_INDEX = 0xfff;
/**
 * A declaration token of Player 2's first move: a whole number, tagged `p` for points of reverse
 * komi or `s` for handicap stones, or untagged to fill the komi and then the handicap in turn.
 */
const DECLARATION_RE = /^(\d+)([ps]?)$/;
/** Opacity of a stone marked dead. */
const DEAD_OPACITY = 0.4;
/** The opacity of pass-alive stones in Kill-All games, as in Kill-All Go. */
const ALIVE_OPACITY = 0.75;
/** Diameter of a territory dot as a fraction of a cell, the size of the renderer's own dots. */
const DOT_SIZE = 0.2;
/** Diameter of a star point as a fraction of a cell, the size the renderer draws its own. */
const STAR_SIZE = 0.15;
/** Scale of the digit written on a tracker marker. */
const DIGIT_SCALE = 0.75;
/** Stroke width of the border around the tracker's columns, in the track board's own units. */
const TRACK_BORDER_WIDTH = 8;

const popcount = (n: number): number => {
    let count = 0;
    let rest = n;
    while (rest > 0) {
        count += rest & 1;
        rest = Math.floor(rest / 2);
    }
    return count;
};

const snubGeometryCache = new Map<number, Geometry>();

/** The snub square board as a `Geometry`, so the shared Go helpers can walk it. */
const makeSnubGeometry = (size: number): Geometry => {
    const cached = snubGeometryCache.get(size);
    if (cached !== undefined) {
        return cached;
    }
    const graph = new SnubSquareGraph(size, size);
    const cells: string[] = [];
    const neighbours = new Map<string, string[]>();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cell = graph.coords2algebraic(x, y);
            cells.push(cell);
            neighbours.set(cell, graph.neighbours(cell));
        }
    }
    const geo: Geometry = {
        size,
        cells,
        neighbours,
        coords2algebraic: (x: number, y: number) => graph.coords2algebraic(x, y),
        algebraic2coords: (cell: string) => graph.algebraic2coords(cell),
    };
    snubGeometryCache.set(size, geo);
    return geo;
};

/** Remove every string of `colour` that has no liberties; returns the strings removed. */
const clearColour = (board: Board, geo: Geometry, colour: Stone): string[][] => {
    const removed: string[][] = [];
    const seen = new Set<string>();
    for (const cell of geo.cells) {
        if (board.get(cell) !== colour || seen.has(cell)) {
            continue;
        }
        const info = stringAt(board, geo, cell);
        for (const stone of info.stones) {
            seen.add(stone);
        }
        if (info.liberties.size === 0) {
            for (const stone of info.stones) {
                board.delete(stone);
            }
            removed.push(info.stones);
        }
    }
    return removed;
};

export class ThueMorseGoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Thue-Morse Go",
        uid: "thuemorsego",
        playercounts: [2],
        version: "20261004",
        dateAdded: "2026-10-04",
        description: "Go in which the order of placements follows the Thue-Morse sequence (0110 1001 1001 0110 …), so every move is one or two stones and no komi is needed. Tromp-Taylor rules with suicide allowed, an optional button, and a Kill-All variant.",
        notes: "Placements follow the Thue-Morse sequence: placement n (counting from 0) belongs to Player 1 when n has an even number of 1 bits in binary and to Player 2 otherwise, giving the order 0110 1001 1001 0110 … A move is a maximal run of placements by one player, so every move is one or two placements. The tracker beside the board shows the next 16 placements in a single column, those of the next move as full-size stones; the tint behind the column and the border around it are the colour of the next placement. A display option shows instead the index of the next placement in hexadecimal, one column per digit: the rightmost column gives the colours of the placements to come before the next carry, each other column the colour of the 0 row of the column to its right, and the marked cell of each column carries its digit. It has three columns; past placement fff it shows only grey stones, with no markers or border, rather than digits it cannot show. The Balanced Marseillais protocol repeats the first four terms (ABBA) instead, and shows no tracker.\n\nStones are placed and captured under Tromp-Taylor rules: after a placement, opponent strings without liberties are removed, then your own, so multi-stone suicide is legal. Any placement may instead be a pass or, while nobody holds it, take the button, worth one point to its holder. By default the button evens the count: there is one on boards with an odd number of points (11x11, 19x19, 23x23) and none on boards with an even number (16x16); the 0.5 point button variant makes it worth half a point on any board, so scores cannot tie. A move lists its placements separated by commas; a move submitted with fewer placements than it allows passes the rest. A player's score is their area (stones plus the empty points reaching only their colour) plus the button; there is no komi. Captured stones do not score. Dots show the empty points that would count as territory as the board stands, so a lone first stone claims the whole board; a display option hides them.\n\nEnding the game: the game ends when a player passes their whole move right after the opponent passed at least one placement, keeping the marking of dead strings the opponent's move carried. A move that passes any of its placements, whether or not it also places a stone, may mark strings of either colour dead: click them, or name them after the passes (`pass,pass,-a1` marks the string at a1; `e5,pass,-a1` places e5, passes the other placement and marks it). The marked stones are shown faded, and the dots show the territory as it would be scored with them removed, the points under them included; a mark on a stone the move's own placement captures drops out. The opponent's next move starts from that marking, and clicking a string changes it. If the opponent passes their whole move keeping the marking, the game ends: the marked strings are removed and the board is scored. A move that places a stone, or that changes the marking, never ends the game, and the players may keep passing and changing the marking in turn for as long as every move passes at least one placement and keeps some string marked. Dead-stone marking ends for the rest of the game as soon as a marking is answered by a move that passes nothing, or by a pass that marks nothing dead. From then on passes carry no marking, dead stones must be captured for real, and the game ends when a whole-move pass follows a move of the opponent that passed at least one placement, with every stone on the board alive. A stone placed after passing the move is entered as the placement followed by the pass, such as `e5,pass`.\n\nBy default there is no ko rule, and the fifth occurrence of a position ends the game in a draw, even partway through a move. Under the positional superko variant no placement may recreate an earlier position of the board, including positions reached partway through a move; under double delayed superko a position may arise three times, and only a placement that would make a fourth occurrence is forbidden. Passes, taking the button and handicap passes change nothing and create no position. A single stone with no liberties that captures nothing is removed as suicide and so recreates the position it was played into, which is why superko does not allow it, and double delayed superko only until the position has arisen three times.\n\nWeak eyes: normally every placement clears the board, so two eyes live. With checked weak eyes only the last placement of a move clears it, so a two-placement move can fill both eyes of a group, three eyes are needed to live, and a placement that would be suicide can be rescued by the second placement of the move. Only the position the move leaves then counts for repetition, not the one partway through it.\n\nHandicap stones: Player 2's first move begins by giving Player 1 a number of handicap stones, up to a fortieth of the board's points rounded away from nine (3 on 11x11, 6 on 16x16, 10 on 19x19, 14 on 23x23): Player 2 passes that many placements, the first with the declaration itself and the rest automatically at the start of their following moves. These passes do not count towards ending the game and may run out partway through a two-placement move. In the move notation the handicap is a number followed by s, such as 3s, and the reverse komi a number followed by p, such as 14p; they come before the placements in either order.\n\nReverse komi: Player 2's first move begins by giving Player 1 a reverse komi, any whole number of points up to 14 times the handicap limit (the numbered stones offer the multiples of 14), added to Player 1's score at the end of the game. Unlike the handicap it costs no placement; it comes before any handicap declaration, and the game is unrated.\n\nKill-All: players take turns placing Attacker stones until one of them claims the Attacker side (pieboxing); the other plays the Defender and makes placement 0. The Defender wins by forming an unconditionally alive string (pass-alive by Benson's algorithm, with three vital regions instead of two under checked weak eyes), the Attacker by making that impossible. The Attacker's stones take the first colour and the Defender's the second, as in Kill-All Go; a palette set for this game can change them through slots 3 and 4, for instance the other way round. Passing is not allowed, and a player with no legal move loses. With a handicap, Player 1 first sets a number of extra Attacker stones, up to twice the handicap limit, that Player 2 places immediately on claiming the Attacker side. There is no button in Kill-All games. In the position that ends the game, the pass-alive stones of both sides are shown faded; a display option shows them faded in every position.\n\nColours: a stone's border is black or white, whichever contrasts better with its fill. A display option takes the borders from palette slots 5 to 8 instead, for stones in slots 1 to 4; it needs a palette of at least eight colours, since a palette that lacks a slot the game names cannot be drawn.\n\nOrigins: the Thue-Morse order was proposed for Go independently by atimholt and TheElvenAngelCatboy on r/baduk and by BHydden on the Online Go Forum, each pointing to the same video about the sequence; the forum community then built tools for playing it on OGS, ran tournaments, and worked out the rules implemented here. The Balanced Marseillais order comes from chess: Marseillais Chess (AABB) is attributed either to Albert Fortis with J. Rossow or to Jehan de Queylar, and Robert Bruce first proposed the ABBA correction that balances it.",
        urls: [
            "https://forums.online-go.com/t/thue-morse-fair-sharing-sequence-a-possible-alternative-to-komi/22547",
            "https://www.reddit.com/r/baduk/comments/65nx60/using_the_thuemorse_sequence_to_determine_whose/",
            "https://www.reddit.com/r/baduk/comments/92clfm/how_would_go_using_the_thuemorse_fairestsharing/",
            "https://www.youtube.com/watch?v=prh72BLNjIk",
            "https://www.chessvariants.com/multimove.dir/marseill.html",
            "https://en.wikipedia.org/wiki/Thue%E2%80%93Morse_sequence",
            "https://tromp.github.io/go.html",
        ],
        // The Thue-Morse order was proposed for Go independently at least three times; the Online
        // Go Forum community then built tools, ran tournaments and settled the rules used here.
        people: [
            {
                type: "designer",
                name: "atimholt",
                urls: ["https://www.reddit.com/r/baduk/comments/65nx60/using_the_thuemorse_sequence_to_determine_whose/"],
            },
            {
                type: "designer",
                name: "TheElvenAngelCatboy",
                urls: ["https://www.reddit.com/r/baduk/comments/92clfm/how_would_go_using_the_thuemorse_fairestsharing/"],
            },
            {
                type: "designer",
                name: "BHydden",
                urls: ["https://forums.online-go.com/t/thue-morse-fair-sharing-sequence-a-possible-alternative-to-komi/22547"],
            },
            {
                type: "other",
                name: "Online Go Forum community",
                urls: ["https://forums.online-go.com/t/thue-morse-fair-sharing-sequence-a-possible-alternative-to-komi/22547"],
            },
            {
                type: "coder",
                name: "Samraku",
                urls: [],
                apid: "6ea91933-1262-41a5-b5f3-a6af70692296",
            },
        ],
        variants: [
            { uid: "size-11", group: "board" },
            { uid: "#board" },
            { uid: "size-19", group: "board" },
            { uid: "size-23", group: "board" },
            { uid: "#connect" },
            { uid: "snub", group: "connect" },
            { uid: "#protocol" },
            {
                uid: "marseillais",
                group: "protocol",
                people: [
                    {
                        type: "designer",
                        name: "Robert Bruce",
                        urls: ["https://www.chessvariants.com/multimove.dir/marseill.html"],
                    },
                ],
            },
            { uid: "handicap", unrated: true },
            { uid: "reverse-komi", unrated: true, conflictsWith: ["kill-all"] },
            { uid: "#repetition" },
            { uid: "superko", group: "repetition" },
            { uid: "double-delayed-psk", group: "repetition" },
            { uid: "weak-eyes" },
            { uid: "half-button" },
            { uid: "kill-all", conflictsWith: ["half-button"] },
        ],
        categories: ["goal>area", "goal>cripple", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>rect", "board>connect>rect", "board>connect>snub", "components>simple>1per"],
        flags: ["experimental", "scores", "custom-buttons", "no-moves", "custom-randomization"],
        displays: [{ uid: "tms-tracker" }, { uid: "digits-down" }, { uid: "hide-territory" }, { uid: "palette-borders" }, { uid: "pass-alive-throughout" }],
        // Kill-All games draw their roles from slots 3 and 4, so that the Attacker takes the first
        // colour as in Kill-All Go by default, and a player who prefers the Defender in the first
        // colour can set those two slots the other way round.
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of Player 1's stones, the Thue-Morse 0 placements, outside Kill-All games",
                player: 1,
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of Player 2's stones, the Thue-Morse 1 placements, outside Kill-All games",
                player: 2,
            },
            {
                num: 3,
                default: 1,
                explanation: "Colour of the Attacker's stones in Kill-All games. Unless a palette for this game sets it, the Attacker takes the first colour, as in Kill-All Go; set slots 3 and 4 the other way round to give the Defender, who makes placement 0, the first colour.",
            },
            {
                num: 4,
                default: 2,
                explanation: "Colour of the Defender's stones in Kill-All games. Unless a palette for this game sets it, the Defender takes the second colour.",
            },
            {
                num: 5,
                default: "#000000",
                explanation: "Border of the stones in slot 1 under the display option that takes the borders from the palette; otherwise borders are black or white, whichever contrasts better with the fill",
            },
            {
                num: 6,
                default: "#000000",
                explanation: "Border of the stones in slot 2 under the same display option",
            },
            {
                num: 7,
                default: "#000000",
                explanation: "Border of the stones in slot 3 under the same display option",
            },
            {
                num: 8,
                default: "#000000",
                explanation: "Border of the stones in slot 4 under the same display option",
            },
        ],
    };

    /** Kill-All games have no scores, and their colours follow roles rather than seats. */
    public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
        const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
        if (context.variants?.includes("kill-all")) {
            flags.push("custom-colours");
            return flags.filter((flag) => flag !== "scores");
        }
        return flags;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Board;
    public phase!: Phase;
    public placed = 0;
    public passes: playerid[] = [];
    public interim: string[] = [];
    public novel = false;
    public marks: string[] = [];
    public locked = false;
    public button?: playerid;
    public handicap?: number;
    public passesOwed = 0;
    public komi?: number;
    public defenderSeat?: playerid;
    public alive?: string[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 16;
    private geo!: Geometry;

    constructor(state?: IThueMorseGoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = this.applyVariantConstraints(variants);
            }
            let phase: Phase = "play";
            if (this.variants.includes("kill-all")) {
                phase = this.variants.includes("handicap") ? "hand-n" : "alt-place";
            }
            const fresh: IMoveState = {
                _version: ThueMorseGoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                phase,
                placed: 0,
                passes: [],
                interim: [],
                novel: false,
                marks: [],
                locked: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                // A state pasted with indentation around it is still JSON, not a compressed state.
                const text = state.trim();
                if (!text.startsWith("{") && !text.startsWith("[")) {
                    throw new Error("Compressed game state must be decompressed before constructing the engine.");
                }
                state = JSON.parse(text, reviver) as IThueMorseGoState;
            }
            if (state.game !== ThueMorseGoGame.gameinfo.uid) {
                throw new Error(`The Thue-Morse Go engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ThueMorseGoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.phase = state.phase;
        this.placed = state.placed;
        this.passes = [...state.passes];
        this.interim = [...state.interim];
        this.novel = state.novel;
        this.marks = [...state.marks];
        this.locked = state.locked;
        this.button = state.button;
        this.handicap = state.handicap;
        this.passesOwed = state.passesOwed ?? 0;
        this.komi = state.komi;
        this.defenderSeat = state.defenderSeat;
        this.alive = state.alive === undefined ? undefined : [...state.alive];
        this.boardSize = ThueMorseGoGame.sizeFromVariants(this.variants);
        this.geo = this.variants.includes("snub") ? makeSnubGeometry(this.boardSize) : makeGeometry(this.boardSize);
        return this;
    }

    private static sizeFromVariants(variants: string[]): number {
        if (variants.includes("size-11")) { return 11; }
        if (variants.includes("size-19")) { return 19; }
        if (variants.includes("size-23")) { return 23; }
        return 16;
    }

    // -----------------------------------------------------------------------
    // Variants
    // -----------------------------------------------------------------------

    private get killAll(): boolean {
        return this.variants.includes("kill-all");
    }

    private get handicapVariant(): boolean {
        return this.variants.includes("handicap");
    }

    private get reverseKomi(): boolean {
        return this.variants.includes("reverse-komi");
    }

    /** A fortieth of the board's points, rounded away from nine: the handicap stones offered. */
    private get handicapLimit(): number {
        const base = this.points / 40;
        return base <= 9 ? Math.floor(base) : Math.ceil(base);
    }

    /** The largest handicap: the limit, or twice that for Kill-All's cheaper Attacker stones. */
    private get maxHandicap(): number {
        return this.killAll ? 2 * this.handicapLimit : this.handicapLimit;
    }

    /** Reverse komi: points given to Player 1, up to 14 times the handicap limit; the stones offer the multiples of 14. */
    private get maxKomi(): number {
        return KOMI_STEP * this.handicapLimit;
    }

    private komiValues(): number[] {
        const values: number[] = [];
        for (let value = KOMI_STEP; value <= this.maxKomi; value += KOMI_STEP) {
            values.push(value);
        }
        return values;
    }

    /** Any whole number of points up to the largest stone may be typed. */
    private isKomi(n: number): boolean {
        return n >= 1 && n <= this.maxKomi;
    }

    /** Checked weak eyes: only the last placement of a move clears the board. */
    private get checkedEyes(): boolean {
        return this.variants.includes("weak-eyes");
    }

    /**
     * How many times a position may arise before a placement recreating it is forbidden: once
     * under positional superko, three times under double delayed superko, and without limit by
     * default, where the fifth occurrence draws the game instead.
     */
    private get repetitionLimit(): number | undefined {
        if (this.variants.includes("superko")) {
            return 1;
        }
        if (this.variants.includes("double-delayed-psk")) {
            return 3;
        }
        return undefined;
    }

    /**
     * The button's worth: half a point under the 0.5 point button variant; otherwise a point on
     * boards with an odd number of points and nothing on boards with an even number, so that the
     * points at stake always add up to an even number. Kill-All games have no button.
     */
    private get buttonValue(): number {
        if (this.killAll) {
            return 0;
        }
        if (this.variants.includes("half-button")) {
            return 0.5;
        }
        return this.geo.cells.length % 2 === 1 ? 1 : 0;
    }

    /** The period of a repeating protocol (Balanced Marseillais: ABBA), or 0 for the full sequence. */
    private get period(): number {
        return this.variants.includes("marseillais") ? 4 : 0;
    }

    /**
     * Vital regions a string needs to be pass-alive. With checked weak eyes the opponent can fill
     * two liberties before any clearing, so two vital regions are not enough: Benson's argument
     * then needs three, which the two-placement move cannot all empty at once.
     */
    private get minVital(): number {
        return this.checkedEyes ? 3 : 2;
    }

    // -----------------------------------------------------------------------
    // The sequence
    // -----------------------------------------------------------------------

    /** The Thue-Morse digit of placement `n`: the parity of its 1 bits (within one period of a repeating protocol). */
    public digitAt(n: number): 0 | 1 {
        const idx = this.period === 0 ? n : n % this.period;
        return (popcount(idx) % 2) as 0 | 1;
    }

    public colourAt(n: number): Stone {
        return this.digitAt(n) === 0 ? 1 : 2;
    }

    /** The number of placements in the move that starts at placement `n`: the run of its colour. */
    public moveLength(n: number): number {
        let length = 1;
        while (this.colourAt(n + length) === this.colourAt(n)) {
            length++;
        }
        return length;
    }

    // -----------------------------------------------------------------------
    // Seats and colours
    // -----------------------------------------------------------------------

    private otherSeat(seat: playerid): playerid {
        return seat === 1 ? 2 : 1;
    }

    private get attackerSeat(): playerid | undefined {
        return this.defenderSeat === undefined ? undefined : this.otherSeat(this.defenderSeat);
    }

    private colourOfSeat(seat: playerid): Stone | undefined {
        if (!this.killAll) {
            return seat;
        }
        if (this.defenderSeat === undefined) {
            return undefined;
        }
        return seat === this.defenderSeat ? 1 : 2;
    }

    /**
     * The palette slot a stone colour is customized in: the seats' own slots in the standard game,
     * and in Kill-All games the roles' slots.
     */
    private slotOfColour(colour: Stone): number {
        if (!this.killAll) {
            return colour;
        }
        return colour === 1 ? DEFENDER_SLOT : ATTACKER_SLOT;
    }

    /**
     * The fill of a stone colour. In the standard game it is the seat's own slot. In Kill-All games
     * it is the role's slot when a palette for this game sets it, and otherwise the first colour for
     * the Attacker and the second for the Defender. The renderer's custom function makes that
     * choice: without it, players with no palette for this game would get the renderer's own third
     * and fourth colours.
     */
    private fillOfColour(colour: Stone): number | Colourfuncs {
        const slot = this.slotOfColour(colour);
        if (!this.killAll) {
            return slot;
        }
        return { func: "custom", default: slot === ATTACKER_SLOT ? ATTACKER_DEFAULT : DEFENDER_DEFAULT, palette: slot };
    }

    /**
     * The paint of a stone of `colour`: its border is black or white, whichever contrasts better
     * with the fill, or under the display option the palette slot four above the colour's slot, 5
     * to 8 for slots 1 to 4. The option is opt-in because the renderer rejects a palette that lacks
     * a slot the game names, and the engine cannot see how many colours a palette has.
     */
    private stonePaint(colour: Stone, fromPalette: boolean): { fill: number | Colourfuncs; border: ColourResolvable } {
        const fill = this.fillOfColour(colour);
        const border: ColourResolvable = fromPalette
            ? this.slotOfColour(colour) + BORDER_SLOT_OFFSET
            : { func: "bestContrast", bg: fill, fg: ["#000", "#fff"] };
        return { fill, border };
    }

    public getPlayerColour(p: playerid): number | string | Colourfuncs {
        if (!this.killAll) {
            return p;
        }
        if (this.defenderSeat === undefined) {
            return UNDECIDED_COLOUR;
        }
        return this.fillOfColour(this.colourOfSeat(p)!);
    }

    public coords2algebraic(x: number, y: number): string {
        return this.geo.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.geo.algebraic2coords(cell);
    }

    private get points(): number {
        return this.boardSize * this.boardSize;
    }

    /**
     * The most Attacker stones one Kill-All setup phase may contribute: just under half the board,
     * so the two phases together can never cover every point, which is what keeps whole-board
     * suicide (and so a repeated position) out of the setup without simulating it.
     */
    private maxSetupStones(): number {
        return Math.floor((this.points - 1) / 2);
    }

    private isValidCell(cell: string): boolean {
        if (!CELL_RE.test(cell)) {
            return false;
        }
        try {
            const [x, y] = this.geo.algebraic2coords(cell);
            return x >= 0 && y >= 0 && x < this.boardSize && y < this.boardSize;
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Turn structure
    // -----------------------------------------------------------------------

    /**
     * Split Player 2's first move into its declarations and the placements after them. Tagged
     * tokens (`14p`, `3s`) may come in either order; untagged numbers fill the reverse komi and
     * then the handicap, whichever of them the variants ask for, in that order.
     */
    private parseFirstMove(tokens: string[]): IFirstMove {
        const out: IFirstMove = { placements: [] };
        let i = 0;
        for (; i < tokens.length; i++) {
            const m = DECLARATION_RE.exec(tokens[i]);
            if (m === null) {
                break;
            }
            let slot: "komi" | "handicap";
            if (m[2] === "p") {
                slot = "komi";
            } else if (m[2] === "s") {
                slot = "handicap";
            } else if (this.reverseKomi && out.komi === undefined) {
                slot = "komi";
            } else if (this.handicapVariant && out.handicap === undefined) {
                slot = "handicap";
            } else {
                out.error = "BAD_DECLARATION";
                return out;
            }
            const wanted = slot === "komi" ? this.reverseKomi : this.handicapVariant;
            if (!wanted || out[slot] !== undefined) {
                out.error = "BAD_DECLARATION";
                return out;
            }
            out[slot] = m[1];
        }
        out.placements = tokens.slice(i);
        return out;
    }

    /** The canonical tokens of the declarations: points as `14p`, stones as `3s`. */
    private declarationTokens(first: IFirstMove): string[] {
        const tokens: string[] = [];
        if (first.komi !== undefined) {
            tokens.push(`${first.komi}p`);
        }
        if (first.handicap !== undefined) {
            tokens.push(`${first.handicap}s`);
        }
        return tokens;
    }

    /** Whether Player 2's first move still has a reverse komi or handicap to declare. */
    private declarationsPending(): boolean {
        return this.komiPending() || (this.declaring() && this.handicap === undefined);
    }

    /**
     * Whether this is Player 2's first move of the standard game, which follows placement 0. The
     * stack says so even while a partial move has already counted its declaration.
     */
    private firstMoveOfPlayer2(): boolean {
        return !this.killAll && this.phase === "play" && this.stack.length === 2 && this.currplayer === 2;
    }

    /** Standard handicap: whether this is Player 2's first move, in which the handicap is set. */
    private declaring(): boolean {
        return this.handicapVariant && this.firstMoveOfPlayer2();
    }

    /** Reverse komi: whether this move must begin with the komi, which costs no placement. */
    private komiPending(): boolean {
        return this.reverseKomi && this.komi === undefined && this.firstMoveOfPlayer2();
    }

    /** Standard handicap: the passes served at the start of the current move. */
    private forcedPasses(): number {
        if (this.killAll || this.phase !== "play" || this.currplayer !== 2 || this.passesOwed <= 0) {
            return 0;
        }
        return Math.min(this.passesOwed, this.moveLength(this.placed));
    }

    /** Kill-All handicap: stones the current player must add when taking the Attacker side now. */
    private handicapOwed(): number {
        if (this.phase === "alt-place" && this.handicapVariant && this.currplayer === 2) {
            return this.handicap ?? 0;
        }
        return 0;
    }

    // -----------------------------------------------------------------------
    // Dead strings
    // -----------------------------------------------------------------------

    /** The stones of the string at `cell` on `board`, which must hold a stone there. */
    private stringOn(board: Board, cell: string): string[] {
        return stringAt(board, this.geo, cell).stones;
    }

    /**
     * The marking that names the strings at `cells` on `board`: every stone of each, in board
     * order. Cells without a stone name nothing, so a mark on a stone the move's own placements
     * captured simply drops out.
     */
    private canonicalMarksOn(board: Board, cells: Iterable<string>): string[] {
        const marked = new Set<string>();
        for (const cell of cells) {
            if (board.has(cell) && !marked.has(cell)) {
                for (const stone of this.stringOn(board, cell)) {
                    marked.add(stone);
                }
            }
        }
        return this.geo.cells.filter((cell) => marked.has(cell));
    }

    private canonicalMarks(cells: Iterable<string>): string[] {
        return this.canonicalMarksOn(this.board, cells);
    }

    /** The tokens that spell a marking on `board`: one per marked string, naming its first stone in board order. */
    private markTokensOn(board: Board, marks: string[]): string[] {
        const named = new Set<string>();
        const tokens: string[] = [];
        for (const cell of marks) {
            if (!named.has(cell)) {
                tokens.push(`-${cell}`);
                for (const stone of this.stringOn(board, cell)) {
                    named.add(stone);
                }
            }
        }
        return tokens;
    }

    private markTokens(marks: string[]): string[] {
        return this.markTokensOn(this.board, marks);
    }

    private sameMarks(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((cell, i) => cell === b[i]);
    }

    /** A move's placement tokens and the cells its mark tokens (`-cell`) name. */
    private splitMarks(tokens: string[]): { placements: string[]; marked: string[] } {
        const placements: string[] = [];
        const marked: string[] = [];
        for (const token of tokens) {
            if (token.startsWith("-")) {
                marked.push(token.substring(1));
            } else {
                placements.push(token);
            }
        }
        return { placements, marked };
    }

    /** Whether `placements` are the voluntary passes of a whole-move pass, the only move that can end the game. */
    private passesWholeMove(placements: string[]): boolean {
        return !this.killAll && placements.length > 0 && placements.every((token) => token === "pass");
    }

    /**
     * Whether `placements` pass at least one placement. Such a move counts as a pass, may carry a
     * marking, and stays open for strings to be clicked; a whole-move pass by the opponent can then
     * end the game.
     */
    private passesAny(placements: string[]): boolean {
        return !this.killAll && placements.includes("pass");
    }

    /**
     * The marking the current player's move answers: the pending one when the opponent's last
     * move passed at least one placement, so that a whole-move pass keeping it ends the game.
     */
    private inheritedMarks(): string[] | undefined {
        const n = this.passes.length;
        return n > 0 && this.passes[n - 1] !== this.currplayer ? this.marks : undefined;
    }

    /** The board with the marked strings removed. */
    private effectiveBoard(): Board {
        if (this.marks.length === 0) {
            return this.board;
        }
        const board = new Map(this.board);
        for (const cell of this.marks) {
            board.delete(cell);
        }
        return board;
    }

    private clearMarks(): void {
        this.marks = [];
    }

    /**
     * End dead-stone marking for the rest of the game: a placement or a pass that marks nothing
     * dead has followed a marking, so the players must capture dead stones for real, and the game
     * ends when both pass their whole moves in turn, every stone on the board counting as alive.
     */
    private endMarking(): void {
        this.results.push({ type: "select", what: "dead", how: "locked" });
        this.locked = true;
        this.marks = [];
    }

    /** Whether a marking is pending that the current move answers, so that a placement would end marking. */
    private markingPending(): boolean {
        return this.marks.length > 0 && !this.locked;
    }

    /** Append to a valid verdict the warning that a placement now ends dead-stone marking. */
    private warnMarkingEnds(result: IValidationResult): IValidationResult {
        if (result.valid && this.markingPending()) {
            result.message = `${result.message} ${i18next.t("apgames:validation.thuemorsego.PLACING_ENDS_MARKING")}`;
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // Positions and placements
    // -----------------------------------------------------------------------

    /**
     * How often each position has arisen so far: the initial board and every position a stone
     * placement created, including those partway through a move. Passes, taking the button and
     * the handicap's declaration and passes change nothing and create no position.
     */
    private positionCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        const add = (sig: string): void => {
            counts.set(sig, (counts.get(sig) ?? 0) + 1);
        };
        add(signature(this.stack[0].board, this.geo));
        for (let i = 1; i < this.stack.length; i++) {
            const state = this.stack[i];
            for (const sig of state.interim) {
                add(sig);
            }
            if (state.novel) {
                add(signature(state.board, this.geo));
            }
        }
        return counts;
    }

    private newSim(length: number, placed: number, base?: Map<string, number>): ISim {
        return {
            board: new Map(this.board),
            base: base ?? this.positionCounts(),
            results: [],
            start: signature(this.board, this.geo),
            created: [],
            captured: 0,
            suicided: 0,
            length,
            placed,
            buttonTaken: false,
            placedStone: false,
            cleared: false,
            over: false,
        };
    }

    private copySim(sim: ISim): ISim {
        return { ...sim, board: new Map(sim.board), created: [...sim.created], results: [...sim.results] };
    }

    private occurrences(sim: ISim, sig: string): number {
        let count = sim.base.get(sig) ?? 0;
        for (const created of sim.created) {
            if (created === sig) {
                count++;
            }
        }
        return count;
    }

    /**
     * Record the position the board holds after a placement (or after the clearing a placement
     * owed). Returns the key of the validation message when the repetition rule forbids it: the
     * suicide message when the placement left the board as it was because its own stone was
     * removed, the move's suicide message when the clearing at the end of a move with checked
     * weak eyes removed every stone it placed, the plain one otherwise, each in its superko or
     * double delayed superko wording. By default the fifth occurrence of a position ends the game
     * instead. `step` is what the clearing removed this time.
     */
    private recordPosition(sim: ISim, step: { captured: number; suicided: number }): TokenError | undefined {
        const sig = signature(sim.board, this.geo);
        const seen = this.occurrences(sim, sig);
        const limit = this.repetitionLimit;
        if (limit !== undefined && seen >= limit) {
            const previous = sim.created.length > 0 ? sim.created[sim.created.length - 1] : sim.start;
            const unchanged = step.captured === 0 && step.suicided > 0 && (sig === previous || sig === sim.start);
            const stem = !unchanged ? "KO_PSK" : sig === sim.start && step.suicided > 1 ? "SUICIDE_REPEAT_MOVE" : "SUICIDE_REPEAT";
            return limit === 1 ? stem : `${stem}_DDPSK`;
        }
        sim.created.push(sig);
        if (limit === undefined && seen + 1 >= REPETITIONS_FOR_DRAW) {
            sim.over = true;
        }
        return undefined;
    }

    /** Tromp-Taylor clearing after `colour` placed: opponent strings without liberties, then its own. */
    private clear(sim: ISim, colour: Stone): { captured: number; suicided: number } {
        const step = { captured: 0, suicided: 0 };
        for (const group of clearColour(sim.board, this.geo, otherColour(colour))) {
            sim.results.push({ type: "capture", where: group.join(","), count: group.length });
            step.captured += group.length;
        }
        for (const group of clearColour(sim.board, this.geo, colour)) {
            sim.results.push({ type: "capture", where: group.join(","), count: group.length, how: "suicide" });
            step.suicided += group.length;
        }
        sim.captured += step.captured;
        sim.suicided += step.suicided;
        return step;
    }

    /**
     * Checked weak eyes: the clearing deferred to the move's last placement, done once. When it
     * removes anything, the board it leaves is a position to record.
     */
    private clearAtEnd(sim: ISim, colour: Stone): TokenError | undefined {
        if (!this.checkedEyes || sim.cleared || !sim.placedStone) {
            return undefined;
        }
        sim.cleared = true;
        return this.recordPosition(sim, this.clear(sim, colour));
    }

    /** Serve handicap passes at the start of a move. */
    private serveForced(sim: ISim, count: number): void {
        for (let i = 0; i < count; i++) {
            sim.results.push({ type: "pass", why: "handicap" });
            sim.placed++;
        }
    }

    /**
     * Apply one placement token (a cell, `pass`, or `button`) for `colour` to `sim`. Returns the
     * key of the validation message when the token is illegal. Every stone placement creates a
     * position, judged at once; with checked weak eyes the position after a placement that is not
     * the move's last is the board before any clearing.
     */
    private applyToken(sim: ISim, token: string, colour: Stone): TokenError | undefined {
        if (sim.over) {
            return "OVER_MID_MOVE";
        }
        if (sim.placed >= sim.length) {
            return "TOO_MANY";
        }
        const final = sim.placed === sim.length - 1;
        if (token === "pass" || token === "button") {
            if (token === "pass") {
                if (this.killAll) {
                    return "NO_PASS";
                }
                sim.results.push({ type: "pass" });
            } else {
                if (this.buttonValue === 0) {
                    return "NO_BUTTON";
                }
                if (this.button !== undefined || sim.buttonTaken) {
                    return "BUTTON_TAKEN";
                }
                sim.buttonTaken = true;
                sim.results.push({ type: "button" });
            }
            sim.placed++;
            return final ? this.clearAtEnd(sim, colour) : undefined;
        }
        if (!this.isValidCell(token)) {
            return "INVALIDCELL";
        }
        if (sim.board.has(token)) {
            return "OCCUPIED";
        }
        sim.board.set(token, colour);
        sim.results.push({ type: "place", where: token });
        sim.placedStone = true;
        sim.placed++;
        if (!this.checkedEyes) {
            return this.recordPosition(sim, this.clear(sim, colour));
        }
        if (!final) {
            // With checked weak eyes the board is neither cleared nor its position recorded until
            // the move's last placement: only the position the move leaves counts for repetition.
            return undefined;
        }
        sim.cleared = true;
        return this.recordPosition(sim, this.clear(sim, colour));
    }

    /** Pass the placements a move string left unspecified (standard game only). */
    private finishMove(sim: ISim, colour: Stone): TokenError | undefined {
        while (!sim.over && sim.placed < sim.length) {
            if (this.killAll) {
                return "INCOMPLETE";
            }
            const err = this.applyToken(sim, "pass", colour);
            if (err !== undefined) {
                return err;
            }
        }
        return undefined;
    }

    private tokenMessage(key: TokenError, token: string): string {
        switch (key) {
            case "INVALIDCELL":
                return i18next.t("apgames:validation._general.INVALIDCELL", { cell: token });
            case "OCCUPIED":
                if (this.killAll || this.locked) {
                    return i18next.t("apgames:validation._general.OCCUPIED", { where: token });
                }
                return i18next.t("apgames:validation.thuemorsego.OCCUPIED_MARK", { where: token });
            case "INCOMPLETE":
                return i18next.t("apgames:validation._general.INCOMPLETE_MOVE");
            default:
                return i18next.t(TOKEN_ERROR_KEYS[key]);
        }
    }

    /** The tokens that may come next in a move on `sim`. */
    private candidates(sim: ISim): string[] {
        const list: string[] = [];
        if (!this.killAll) {
            list.push("pass");
            if (this.buttonValue > 0 && this.button === undefined && !sim.buttonTaken) {
                list.push("button");
            }
        }
        for (const cell of this.geo.cells) {
            if (!sim.board.has(cell)) {
                list.push(cell);
            }
        }
        return list;
    }

    /** Whether some legal sequence of placements completes the move on `sim`. */
    private hasContinuation(sim: ISim, colour: Stone): boolean {
        if (sim.over || sim.placed >= sim.length) {
            return true;
        }
        for (const token of this.candidates(sim)) {
            const trial = this.copySim(sim);
            if (this.applyToken(trial, token, colour) !== undefined) {
                continue;
            }
            if (this.hasContinuation(trial, colour)) {
                return true;
            }
        }
        return false;
    }

    /** Every legal sequence of placements that completes the move on `sim`. */
    private completions(sim: ISim, colour: Stone): string[][] {
        if (sim.over || sim.placed >= sim.length) {
            return [[]];
        }
        const out: string[][] = [];
        for (const token of this.candidates(sim)) {
            const trial = this.copySim(sim);
            if (this.applyToken(trial, token, colour) !== undefined) {
                continue;
            }
            for (const rest of this.completions(trial, colour)) {
                out.push([token, ...rest]);
            }
        }
        return out;
    }

    /** A random legal sequence of placements that completes the move on `sim`. */
    private randomCompletion(sim: ISim, colour: Stone): string[] | undefined {
        if (sim.over || sim.placed >= sim.length) {
            return [];
        }
        for (const token of shuffle(this.candidates(sim)) as string[]) {
            const trial = this.copySim(sim);
            if (this.applyToken(trial, token, colour) !== undefined) {
                continue;
            }
            const rest = this.randomCompletion(trial, colour);
            if (rest !== undefined) {
                return [token, ...rest];
            }
        }
        return undefined;
    }

    private hasLegalMove(seat: playerid): boolean {
        const colour = this.colourOfSeat(seat)!;
        const length = this.moveLength(this.placed);
        const forced = seat === this.currplayer ? this.forcedPasses() : 0;
        const sim = this.newSim(length, 0);
        this.serveForced(sim, forced);
        return this.hasContinuation(sim, colour);
    }

    // -----------------------------------------------------------------------
    // Move lists
    // -----------------------------------------------------------------------

    /**
     * Legal moves. Two-placement moves are enumerated exhaustively, which is slow on large boards;
     * the game is flagged `no-moves` so that only tests and tooling call this.
     */
    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        switch (this.phase) {
            case "hand-n":
                for (let n = 1; n <= this.maxHandicap; n++) {
                    moves.push(n.toString());
                }
                break;
            case "alt-place":
                if (this.board.size < this.maxSetupStones()) {
                    for (const cell of this.geo.cells) {
                        if (!this.board.has(cell)) {
                            moves.push(cell);
                        }
                    }
                }
                if (this.handicapOwed() === 0) {
                    moves.push("attacker");
                }
                break;
            case "play":
                // The komi may be any of the numbered values; the list shows the moves with the first.
                moves.push(...this.playMoves().map((move) => this.komiPending() ? `${KOMI_STEP}p,${move}` : move));
                break;
        }
        return moves;
    }

    private playMoves(): string[] {
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        const base = this.positionCounts();
        const moves: string[] = [];
        if (this.declaring() && this.handicap === undefined) {
            for (let n = 1; n <= this.maxHandicap; n++) {
                const forced = Math.min(n, length);
                if (forced === length) {
                    moves.push(`${n}s`);
                    continue;
                }
                const sim = this.newSim(length, forced, base);
                for (const rest of this.completions(sim, colour)) {
                    moves.push([`${n}s`, ...rest].join(","));
                }
            }
            return moves;
        }
        const forced = this.forcedPasses();
        if (forced === length) {
            return [Array<string>(length).fill("pass").join(",")];
        }
        const sim = this.newSim(length, forced, base);
        return this.completions(sim, colour).map((tokens) => this.withMarks(tokens).join(","));
    }

    /** A whole-move pass keeps the pending marking, which is the pass that can end the game. */
    private withMarks(tokens: string[]): string[] {
        return this.passesWholeMove(tokens) ? [...tokens, ...this.markTokens(this.marks)] : tokens;
    }

    public randomMove(): string {
        if (this.phase !== "play") {
            const moves = this.moves();
            return moves[Math.floor(Math.random() * moves.length)];
        }
        const values = this.komiValues();
        const komi = this.komiPending() ? [`${values[Math.floor(Math.random() * values.length)]}p`] : [];
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        let forced: number;
        let prefix: string[] = [];
        if (this.declaring() && this.handicap === undefined) {
            const n = 1 + Math.floor(Math.random() * this.maxHandicap);
            forced = Math.min(n, length);
            prefix = [`${n}s`];
        } else {
            forced = this.forcedPasses();
        }
        const sim = this.newSim(length, forced);
        const rest = this.randomCompletion(sim, colour) ?? [];
        const tokens = [...komi, ...(prefix.length > 0 ? [...prefix, ...rest] : this.withMarks(rest))];
        return tokens.length > 0 ? tokens.join(",") : Array<string>(length).fill("pass").join(",");
    }

    // -----------------------------------------------------------------------
    // Pickers and buttons
    // -----------------------------------------------------------------------

    /**
     * Numbered stones in a row across the board: `values` left to right, centred on the centre
     * column, `offset` rows below the centre point. A cell that already holds a stone shows that
     * stone instead, but still answers to a click with its value, since clicking the opponent's
     * stone means nothing else.
     */
    private pickerRow(values: number[], offset: number): IPickerButton[] {
        const centre = Math.floor(this.boardSize / 2);
        const left = centre - Math.floor(values.length / 2);
        return values.map((value, i) => ({ cell: this.coords2algebraic(left + i, centre + offset), value }));
    }

    private range(max: number): number[] {
        const values: number[] = [];
        for (let value = 1; value <= max; value++) {
            values.push(value);
        }
        return values;
    }

    /** Kill-All handicap: the odd values in a row just above the centre, the even ones just below. */
    private killAllPicker(): IPickerButton[] {
        const values = this.range(this.maxHandicap);
        return [
            ...this.pickerRow(values.filter((value) => value % 2 === 1), -1),
            ...this.pickerRow(values.filter((value) => value % 2 === 0), 1),
        ];
    }

    /** Standard handicap: every value up to the limit in one row. */
    private handicapPicker(offset: number): IPickerButton[] {
        return this.pickerRow(this.range(this.maxHandicap), offset);
    }

    /** Reverse komi: every multiple of 14 up to the limit in one row. */
    private komiPicker(offset: number): IPickerButton[] {
        return this.pickerRow(this.komiValues(), offset);
    }

    /** Rows of the first-move pickers: the komi above the handicap when both are offered. */
    private pickerOffsets(): { komi: number; handicap: number } {
        const both = this.reverseKomi && this.handicapVariant;
        return { komi: both ? -1 : 0, handicap: both ? 1 : 0 };
    }

    /**
     * The picker the current state shows, if any, and the cells of the values chosen so far. On
     * Player 2's first move the komi and handicap stones stay until every choice is made, and
     * then as long as no placement remains, so that a choice can be changed by clicking.
     */
    private picker(): { buttons: IPickerButton[]; chosen: string[] } | undefined {
        if (this.gameover) {
            return undefined;
        }
        if (this.phase === "hand-n") {
            const buttons = this.killAllPicker();
            return { buttons, chosen: buttons.filter((btn) => btn.value === this.handicap).map((btn) => btn.cell) };
        }
        if (!this.firstMoveOfPlayer2() || (!this.reverseKomi && !this.handicapVariant)) {
            return undefined;
        }
        const chosenAll = (!this.reverseKomi || this.komi !== undefined) && (!this.handicapVariant || this.handicap !== undefined);
        if (chosenAll && (!this.handicapVariant || this.handicap === 1)) {
            // A placement remains, so the board takes over.
            return undefined;
        }
        const offsets = this.pickerOffsets();
        const buttons: IPickerButton[] = [];
        const chosen: string[] = [];
        if (this.reverseKomi) {
            for (const btn of this.komiPicker(offsets.komi)) {
                buttons.push(btn);
                if (btn.value === this.komi) {
                    chosen.push(btn.cell);
                }
            }
        }
        if (this.handicapVariant) {
            for (const btn of this.handicapPicker(offsets.handicap)) {
                buttons.push(btn);
                if (btn.value === this.handicap) {
                    chosen.push(btn.cell);
                }
            }
        }
        return { buttons, chosen };
    }

    /**
     * The move that passes every placement of the current move the player controls, keeping the
     * pending marking so that clicks on strings change it rather than start it over.
     */
    private wholeMovePass(): string {
        const free = Math.max(1, this.moveLength(this.placed) - this.forcedPasses());
        return [...Array<string>(free).fill("pass"), ...this.markTokens(this.marks)].join(",");
    }

    /**
     * The move a `_btn_` click stands for: `pass` passes the whole move, keeping the reverse komi
     * the move in progress begins with, and other values are moves.
     */
    private buttonMove(value: string, move: string): string {
        if (value !== "pass" || this.phase !== "play") {
            return value;
        }
        const pass = this.wholeMovePass();
        if (this.declarationsPending()) {
            return [...this.declarationTokens(this.parseFirstMove(this.parseTokens(move))), pass].join(",");
        }
        return pass;
    }

    public getButtons(): ICustomButton[] {
        if (this.gameover) {
            return [];
        }
        if (this.phase === "alt-place") {
            return [{ label: "apgames:buttons.thuemorsego.attacker", move: "attacker" }];
        }
        if (this.phase !== "play" || this.killAll) {
            return [];
        }
        // The handicap declaration and the reverse komi are typed or clicked, not pressed.
        if ((this.declaring() && this.handicap === undefined) || this.komiPending()) {
            return [];
        }
        if (this.forcedPasses() === this.moveLength(this.placed)) {
            return [];
        }
        // The Pass button passes the whole move; a single click on the board can still fill a placement.
        const buttons: ICustomButton[] = [{ label: "apgames:buttons.pass", move: this.wholeMovePass() }];
        if (this.buttonValue > 0 && this.button === undefined) {
            buttons.push({ label: "apgames:buttons.takebutton", move: "button" });
        }
        return buttons;
    }

    // -----------------------------------------------------------------------
    // Clicks
    // -----------------------------------------------------------------------

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            // Renderer builds before August 2026 pass clicks on the tracker's glyphs to the game
            // with the tracker's own rows and columns. They change nothing.
            if (piece !== undefined && TRACK_KEY_RE.test(piece)) {
                return { ...this.validateMove(move), move };
            }
            if (row < 0 || col < 0) {
                // Button clicks replace whatever move is in progress.
                if (piece === undefined || !piece.startsWith("_btn_")) {
                    return { move, valid: false, message: i18next.t("apgames:validation._general.UNKNOWN_CLICK") };
                }
                const newmove = this.buttonMove(piece.substring("_btn_".length), move);
                const result = this.validateMove(newmove) as IClickResult;
                result.move = result.valid ? newmove : move;
                return result;
            }
            const cell = this.coords2algebraic(col, row);
            const outcome = this.clickCell(move.toLowerCase().replace(/\s+/g, ""), cell);
            if ("error" in outcome) {
                return { move, valid: false, message: i18next.t(CLICK_ERROR_KEYS[outcome.error], { where: cell }) };
            }
            const newmove = outcome.move;
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    private parseTokens(move: string): string[] {
        return move.length === 0 ? [] : move.split(",");
    }

    /** Extend `move` with a click on `cell`, or say why the click means nothing now. */
    private clickCell(move: string, cell: string): IClickOutcome {
        const valueAt = (buttons: IPickerButton[]): string | undefined => buttons.find((btn) => btn.cell === cell)?.value.toString();
        const toggle = (list: string): string => {
            const cells = this.parseTokens(list);
            const next = cells.includes(cell) ? cells.filter((c) => c !== cell) : [...cells, cell];
            return next.join(",");
        };
        switch (this.phase) {
            case "hand-n": {
                const value = valueAt(this.killAllPicker());
                return value === undefined ? { error: "NOT_A_NUMBERED_STONE" } : { move: value };
            }
            case "alt-place":
                if (move.startsWith("attacker")) {
                    return { move: `attacker:${toggle(move.substring("attacker:".length))}` };
                }
                return { move: cell };
            case "play": {
                const tokens = this.parseTokens(move);
                if (this.declarationsPending()) {
                    return this.clickFirstMove(tokens, cell);
                }
                return { move: this.clickPlacements(tokens, cell, this.moveLength(this.placed) - this.forcedPasses()) };
            }
        }
    }

    /**
     * Player 2's first move with a reverse komi or handicap to choose: a numbered stone sets or
     * changes its value, in either order; a changed handicap drops the placements, as it decides
     * how many there are. Once every choice is made and a placement remains, the stones give way
     * to the board.
     */
    private clickFirstMove(tokens: string[], cell: string): IClickOutcome {
        const valueAt = (buttons: IPickerButton[]): string | undefined => buttons.find((btn) => btn.cell === cell)?.value.toString();
        const wantKomi = this.reverseKomi;
        const wantHandicap = this.handicapVariant;
        const length = this.moveLength(this.placed);
        const first = this.parseFirstMove(tokens);
        if (first.error !== undefined) {
            first.komi = undefined;
            first.handicap = undefined;
            first.placements = [];
        }
        const chosenAll = (!wantKomi || first.komi !== undefined) && (!wantHandicap || first.handicap !== undefined);
        const stonesShown = !(chosenAll && (!wantHandicap || first.handicap === "1"));
        const offsets = this.pickerOffsets();
        const komiHit = stonesShown && wantKomi ? valueAt(this.komiPicker(offsets.komi)) : undefined;
        const handicapHit = stonesShown && wantHandicap ? valueAt(this.handicapPicker(offsets.handicap)) : undefined;
        if (komiHit !== undefined) {
            first.komi = komiHit;
        } else if (handicapHit !== undefined) {
            first.handicap = handicapHit;
            first.placements = [];
        } else {
            const komiMissing = wantKomi && first.komi === undefined;
            const handicapMissing = wantHandicap && first.handicap === undefined;
            if (komiMissing && handicapMissing) {
                return { error: "CHOOSE_FIRST" };
            }
            if (komiMissing) {
                return { error: "KOMI_FIRST" };
            }
            if (handicapMissing) {
                return { error: "DECLARE_FIRST" };
            }
            const forced = first.handicap === undefined ? 0 : Math.min(parseInt(first.handicap, 10), length);
            if (length - forced === 0) {
                return { error: "NO_PLACEMENT_LEFT" };
            }
            first.placements = this.parseTokens(this.clickPlacements(first.placements, cell, length - forced));
        }
        return { move: [...this.declarationTokens(first), ...first.placements].join(",") };
    }

    /**
     * Extend the placement tokens of a move in progress with a click on `cell`, `free` placements
     * being the player's. A stone clicked marks its string dead only once the move passes (the
     * Pass button, a typed pass or a mark), never by itself: a stone placed first then a stone
     * clicked is a misclick, refused as occupied, so the player must pass first and then place.
     */
    private clickPlacements(tokens: string[], cell: string, free: number): string {
        const { placements, marked } = this.splitMarks(tokens);
        const passing = placements.includes("pass") || marked.length > 0;
        let placed = placements.filter((token) => token !== "pass");
        const board = this.boardAfter(placed);
        if (placed.includes(cell) && board.has(cell)) {
            // A placement clicked again is taken back, while its stone is still on the board; a
            // point emptied again by suicide or capture can take a second stone.
            placed = placed.filter((token) => token !== cell);
        } else if (board.has(cell) && !this.killAll && passing && placed.length < free) {
            // A stone clicked while the move passes: its string is marked dead, or unmarked
            // again, as the board stands after the move's placements.
            const marks = new Set(this.canonicalMarksOn(board, marked));
            const stones = this.stringOn(board, cell);
            if (stones.every((stone) => marks.has(stone))) {
                for (const stone of stones) { marks.delete(stone); }
            } else {
                for (const stone of stones) { marks.add(stone); }
            }
            const passes = Array<string>(free - placed.length).fill("pass");
            return [...placed, ...passes, ...this.markTokensOn(board, this.geo.cells.filter((c) => marks.has(c)))].join(",");
        } else if (placed.length < free) {
            placed = [...placed, cell];
        } else {
            // A click on a stone with no placement left to pass is left to fail as occupied.
            placed = [...placed.slice(0, -1), cell];
        }
        // The placements come first and the passes that fill the rest of the move after them, so
        // a stone placed after passing the move gives "e5,pass" rather than "pass,e5". Marks on
        // strings that survive the placements stay; a move that passes nothing carries none.
        const after = this.boardAfter(placed);
        const marks = placed.length < free ? this.canonicalMarksOn(after, marked) : [];
        const passes = passing || marks.length > 0 ? Array<string>(free - placed.length).fill("pass") : [];
        return [...placed, ...passes, ...this.markTokensOn(after, marks)].join(",");
    }

    /** The board after the current player's placements `stones` (cells or the button), as far as they are legal. */
    private boardAfter(stones: string[]): Board {
        const colour = this.colourOfSeat(this.currplayer)!;
        const sim = this.newSim(this.moveLength(this.placed), 0);
        this.serveForced(sim, this.forcedPasses());
        for (const token of stones) {
            if (this.applyToken(sim, token, colour) !== undefined) {
                break;
            }
        }
        return sim.board;
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (this.gameover) {
            return this.fail(result, i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        switch (this.phase) {
            case "hand-n":
                return this.validateHandicapStones(m, result);
            case "alt-place":
                return this.validateAltPlace(m, result);
            case "play":
                return this.validatePlay(m, result);
        }
    }

    private ok(result: IValidationResult, complete: -1 | 0 | 1, message: string, canrender = false): IValidationResult {
        result.valid = true;
        result.complete = complete;
        result.canrender = canrender;
        result.message = message;
        return result;
    }

    private fail(result: IValidationResult, message: string): IValidationResult {
        result.valid = false;
        result.message = message;
        return result;
    }

    private validateHandicapStones(m: string, result: IValidationResult): IValidationResult {
        const max = this.maxHandicap;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_HANDICAP", { max }));
        }
        if (!/^\d+$/.test(m)) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.HANDICAP_INVALID"));
        }
        const n = parseInt(m, 10);
        if (n < 1 || n > max) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.HANDICAP_RANGE", { max }));
        }
        return this.ok(result, 0, i18next.t("apgames:validation.thuemorsego.HANDICAP_OK", { count: n }), true);
    }

    /** Setup placements: known cells, empty, no duplicates (see `maxSetupStones` for why no superko check is needed). */
    private checkSetupCells(cells: string[], result: IValidationResult): IValidationResult | undefined {
        const named = new Set<string>();
        for (const cell of cells) {
            if (!this.isValidCell(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell }));
            }
            if (this.board.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.OCCUPIED", { where: cell }));
            }
            if (named.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DUPLICATE_CELL", { where: cell }));
            }
            named.add(cell);
        }
        return undefined;
    }

    private validateAltPlace(m: string, result: IValidationResult): IValidationResult {
        const owed = this.handicapOwed();
        if (m.length === 0) {
            if (owed > 0) {
                return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_ALT_HANDICAP", { count: owed }));
            }
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_ALT"));
        }
        if (m === "attacker" || m.startsWith("attacker:")) {
            const cells = this.parseTokens(m.substring("attacker:".length));
            if (owed === 0) {
                if (cells.length > 0) {
                    return this.fail(result, i18next.t("apgames:validation.thuemorsego.ATTACKER_NO_STONES"));
                }
                return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
            }
            const err = this.checkSetupCells(cells, result);
            if (err !== undefined) { return err; }
            if (cells.length > owed) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.BATCH_TOO_MANY", { count: owed }));
            }
            if (cells.length < owed) {
                return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.STONES_LEFT", { count: owed - cells.length }), cells.length > 0);
            }
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
        }
        if (m === "pass") {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.INVALID_PASS"));
        }
        if (this.board.size >= this.maxSetupStones()) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.SETUP_FULL", { max: this.maxSetupStones() }));
        }
        const err = this.checkSetupCells([m], result);
        if (err !== undefined) { return err; }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private instructions(length: number, free: number): string {
        if (this.killAll) {
            const key = this.currplayer === this.defenderSeat
                ? "apgames:validation.thuemorsego.INSTRUCTIONS_PLAY_DEFENDER"
                : "apgames:validation.thuemorsego.INSTRUCTIONS_PLAY_ATTACKER";
            return i18next.t(key, { count: length });
        }
        const button = this.buttonValue > 0 && this.button === undefined;
        if (free < length) {
            const key = button
                ? "apgames:validation.thuemorsego.INSTRUCTIONS_PLAY_FORCED_BUTTON"
                : "apgames:validation.thuemorsego.INSTRUCTIONS_PLAY_FORCED";
            return i18next.t(key, { points: this.buttonValue });
        }
        const key = button ? "apgames:validation.thuemorsego.INSTRUCTIONS_PLAY_BUTTON" : "apgames:validation.thuemorsego.INSTRUCTIONS_PLAY";
        return i18next.t(key, { count: free, points: this.buttonValue });
    }

    private validatePlay(m: string, result: IValidationResult): IValidationResult {
        if (!this.declarationsPending()) {
            return this.validatePlacements(m, result);
        }
        return this.validateFirstMove(m, result);
    }

    /**
     * Player 2's first move: the reverse komi and the handicap it declares, in either order, then
     * its placements. Neither declaration costs a placement; the handicap stones are the
     * placements passed, this declaration being the first.
     */
    private validateFirstMove(m: string, result: IValidationResult): IValidationResult {
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        const wantKomi = this.komiPending();
        const wantHandicap = this.declaring() && this.handicap === undefined;
        const max = this.maxKomi;
        const stones = this.maxHandicap;
        if (m.length === 0) {
            const key = wantKomi && wantHandicap
                ? "apgames:validation.thuemorsego.INSTRUCTIONS_BOTH"
                : wantKomi ? "apgames:validation.thuemorsego.INSTRUCTIONS_KOMI" : "apgames:validation.thuemorsego.INSTRUCTIONS_DECLARE";
            return this.ok(result, -1, i18next.t(key, { max: wantKomi ? max : stones, stones }));
        }
        const first = this.parseFirstMove(m.split(","));
        if (first.error !== undefined) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.BAD_DECLARATION"));
        }
        let komi: number | undefined;
        if (first.komi !== undefined) {
            komi = parseInt(first.komi, 10);
            if (!this.isKomi(komi)) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.KOMI_INVALID", { max }));
            }
        }
        let handicap: number | undefined;
        if (first.handicap !== undefined) {
            handicap = parseInt(first.handicap, 10);
            if (handicap < 1 || handicap > stones) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DECLARE_RANGE", { max: stones }));
            }
        }
        if (wantKomi && komi === undefined) {
            if (first.placements.length > 0) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.KOMI_MISSING"));
            }
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.HANDICAP_THEN_KOMI", { count: handicap }), true);
        }
        if (wantHandicap && handicap === undefined) {
            if (first.placements.length > 0) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DECLARE_MISSING"));
            }
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.KOMI_THEN_DECLARE", { count: komi }), true);
        }
        if (handicap !== undefined) {
            return this.validateDeclaration(handicap, first.placements, result, colour, length);
        }
        if (first.placements.length === 0) {
            return this.ok(result, 0, i18next.t("apgames:validation.thuemorsego.KOMI_THEN_PLACE", { count: komi }), true);
        }
        return this.validatePlacements(first.placements.join(","), result);
    }

    private validatePlacements(m: string, result: IValidationResult): IValidationResult {
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        const forced = this.forcedPasses();
        const free = length - forced;
        if (m.length === 0) {
            const note = this.markingPending() ? ` ${i18next.t("apgames:validation.thuemorsego.MARKING_PENDING", { count: this.marks.length })}` : "";
            return this.ok(result, -1, `${this.instructions(length, free)}${note}`);
        }
        const { placements: tokens, marked } = this.splitMarks(m.split(","));
        if (free === 0) {
            // The whole move is served automatically; accept the passes that spell it out.
            if (marked.length === 0 && tokens.length <= length && tokens.every((token) => token === "pass")) {
                return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
            }
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.FORCED_MOVE"));
        }
        if (tokens.length > free) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.TOO_MANY", { count: free }));
        }
        const sim = this.newSim(length, 0);
        this.serveForced(sim, forced);
        const err = this.applyTokens(sim, tokens, colour, result);
        if (err !== undefined) { return err; }
        // A move that passes at least one placement, as submitted now, stays open for strings to be
        // marked dead or a stone to be placed for a pass; it counts as a pass for ending the game.
        const passes = this.passesAny(tokens) || (!this.killAll && tokens.length < free);
        if (marked.length > 0) {
            const bad = this.checkMarks(passes, marked, sim.board);
            if (bad !== undefined) { return this.fail(result, bad); }
        }
        if (passes && !sim.over) {
            // With checked weak eyes the clearing that ends the move can leave a forbidden position.
            const finish = this.finishMove(this.copySim(sim), colour);
            if (finish !== undefined) {
                const key = finish.startsWith("SUICIDE_REPEAT")
                    ? "apgames:validation.thuemorsego.MUST_CONTINUE_SUICIDE"
                    : "apgames:validation.thuemorsego.MUST_CONTINUE";
                return this.ok(result, -1, i18next.t(key), true);
            }
            // Every placement passed, spelled out or (marks alone) implied, is a whole-move pass.
            const pure = tokens.every((token) => token === "pass");
            const explicit = this.passesAny(tokens) || marked.length > 0;
            return this.passVerdict(sim.board, marked, pure, explicit, free, result);
        }
        return this.warnMarkingEnds(this.completeness(sim, colour, result));
    }

    /**
     * The validation message when the mark tokens of a move are not allowed, if they are not.
     * `passes` is whether the move, as submitted now, passes at least one placement, and `board`
     * the board after its placements: a mark on a stone they captured is allowed and simply drops
     * out, while a mark on a point that never held a stone is a mistake.
     */
    private checkMarks(passes: boolean, marked: string[], board: Board): string | undefined {
        if (!passes) {
            return i18next.t("apgames:validation.thuemorsego.MARKS_NEED_PASS");
        }
        for (const cell of marked) {
            if (!this.isValidCell(cell)) {
                return i18next.t("apgames:validation._general.INVALIDCELL", { cell });
            }
            if (!board.has(cell) && !this.board.has(cell)) {
                return i18next.t("apgames:validation.thuemorsego.MARK_EMPTY", { where: cell });
            }
        }
        return undefined;
    }

    /**
     * The verdict on a move that passes at least one placement: what submitting it does to the
     * marking and to the game. The move is left open (`complete` 0) while strings can still be
     * clicked, or a stone placed for one of its passes; once marking has ended, a pass of a
     * single placement is finished. `board` is the board after the move's placements, `pure`
     * whether the move passes every placement, which alone can end the game, and `explicit`
     * whether its pass is spelled out (or a mark carried), which clicks on strings need.
     */
    private passVerdict(board: Board, marked: string[], pure: boolean, explicit: boolean, free: number, result: IValidationResult): IValidationResult {
        const marks = this.canonicalMarksOn(board, marked);
        const count = marks.length;
        const inherited = this.inheritedMarks();
        if (this.locked) {
            if (count > 0) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.MARKS_LOCKED"));
            }
            const key = !pure
                ? "apgames:validation.thuemorsego.PASS_LOCKED_PLACE"
                : inherited === undefined ? "apgames:validation.thuemorsego.PASS_LOCKED" : "apgames:validation.thuemorsego.PASS_LOCKED_ENDS";
            return this.ok(result, free > 1 ? 0 : 1, i18next.t(key), true);
        }
        let key: string;
        if (this.marks.length > 0 && count === 0) {
            // A pass that marks nothing dead after a marking ends marking for the rest of the game.
            key = pure ? "apgames:validation.thuemorsego.PASS_CLEARS" : "apgames:validation.thuemorsego.PASS_CLEARS_PLACE";
        } else if (!pure) {
            key = "apgames:validation.thuemorsego.PASS_PLACE";
        } else if (inherited === undefined) {
            key = "apgames:validation.thuemorsego.PASS_OPEN";
        } else if (this.sameMarks(marks, this.canonicalMarksOn(board, inherited))) {
            key = "apgames:validation.thuemorsego.PASS_AGREE";
        } else {
            key = "apgames:validation.thuemorsego.PASS_DISPUTE";
        }
        let message = i18next.t(key, { count });
        if (!pure) {
            // A stone placed first leaves no way to click a string: the move must pass first.
            const hint = explicit ? "apgames:validation.thuemorsego.MARK_CLICK" : "apgames:validation.thuemorsego.MARK_HINT";
            message = `${message} ${i18next.t(hint)}`;
        }
        return this.ok(result, 0, message, true);
    }

    /** The rest of a first move that declares a handicap of `n`: the placements `rest` after it. */
    private validateDeclaration(n: number, rest: string[], result: IValidationResult, colour: Stone, length: number): IValidationResult {
        // The declaration itself is the first pass served.
        const forced = Math.min(n, length);
        const free = length - forced;
        if (free === 0) {
            if (rest.length > 0) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DECLARE_NO_PLACEMENT", { count: n }));
            }
            return this.ok(result, 0, i18next.t("apgames:validation.thuemorsego.DECLARE_OK", { count: n }), true);
        }
        if (rest.length > free) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.TOO_MANY", { count: free }));
        }
        const sim = this.newSim(length, forced);
        const err = this.applyTokens(sim, rest, colour, result);
        if (err !== undefined) { return err; }
        if (rest.length === 0) {
            const button = this.buttonValue > 0 && this.button === undefined;
            const key = button ? "apgames:validation.thuemorsego.DECLARE_ONE_BUTTON" : "apgames:validation.thuemorsego.DECLARE_ONE";
            return this.ok(result, 0, i18next.t(key), true);
        }
        return this.completeness(sim, colour, result);
    }

    private applyTokens(sim: ISim, tokens: string[], colour: Stone, result: IValidationResult): IValidationResult | undefined {
        for (const token of tokens) {
            const err = this.applyToken(sim, token, colour);
            if (err !== undefined) {
                return this.fail(result, this.tokenMessage(err, token));
            }
        }
        return undefined;
    }

    /**
     * The verdict on a move that places every placement it controls, or whose placements have
     * ended the game: it is complete. In Kill-All, where nothing is passed, a move with
     * placements left must go on, and must be able to.
     */
    private completeness(sim: ISim, colour: Stone, result: IValidationResult): IValidationResult {
        if (sim.over || sim.placed === sim.length) {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
        }
        if (!this.hasContinuation(sim, colour)) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.DEAD_END"));
        }
        return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.PLACE_MORE", { count: sim.length - sim.placed }), true);
    }

    // -----------------------------------------------------------------------
    // Moves
    // -----------------------------------------------------------------------

    public move(m: string, { partial = false, trusted = false } = {}): ThueMorseGoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INCOMPLETE_MOVE"));
            }
        }
        if (m.length === 0) { return this; }

        this.results = [];
        this.interim = [];
        this.novel = false;
        this.alive = undefined;

        let committed: boolean;
        switch (this.phase) {
            case "hand-n":
                committed = this.moveHandicapStones(m, partial);
                break;
            case "alt-place":
                committed = this.moveAltPlace(m, partial);
                break;
            case "play":
                committed = this.movePlay(m, partial);
                break;
        }
        if (!committed) {
            return this;
        }
        // Every move that leaves the board in play, the claim included, may have settled a
        // Kill-All game or left the next player without a legal move.
        if (this.killAll && this.phase === "play") {
            this.checkLifeAndDeath();
            this.checkStalemate();
        }
        this.saveState();
        this.serveForcedMoves();
        return this;
    }

    private moveHandicapStones(m: string, partial: boolean): boolean {
        const n = parseInt(m, 10);
        this.handicap = n;
        this.results.push({ type: "declare", count: n });
        if (partial) { return false; }
        this.phase = "alt-place";
        this.currplayer = 2;
        this.lastmove = m;
        return true;
    }

    /** Opening stones for the Attacker (no captures are possible before the Defender has moved). */
    private placeSetupStones(cells: string[]): void {
        const created: string[] = [];
        for (const cell of cells) {
            this.board.set(cell, 2);
            this.results.push({ type: "place", where: cell, what: "setup" });
            created.push(signature(this.board, this.geo));
        }
        this.interim = created.slice(0, -1);
        this.novel = created.length > 0;
    }

    private moveAltPlace(m: string, partial: boolean): boolean {
        if (m === "attacker" || m.startsWith("attacker:")) {
            this.results.push({ type: "claim", how: "attacker" });
            this.placeSetupStones(this.parseTokens(m.substring("attacker:".length)));
            if (partial) { return false; }
            this.defenderSeat = this.otherSeat(this.currplayer);
            this.phase = "play";
            this.placed = 0;
            this.currplayer = this.defenderSeat;
        } else {
            this.placeSetupStones([m]);
            if (partial) { return false; }
            this.currplayer = this.otherSeat(this.currplayer);
        }
        this.lastmove = m;
        return true;
    }

    private movePlay(m: string, partial: boolean): boolean {
        const seat = this.currplayer;
        const colour = this.colourOfSeat(seat)!;
        const length = this.moveLength(this.placed);
        const prefix: string[] = [];
        let komiResult: APMoveResult | undefined;
        let declared: number | undefined;
        let raw = m.length === 0 ? [] : m.split(",");
        if (this.declarationsPending()) {
            // The reverse komi and the handicap lead Player 2's first move; the komi costs no placement.
            const first = this.parseFirstMove(raw);
            if (first.komi !== undefined) {
                const n = parseInt(first.komi, 10);
                this.komi = n;
                komiResult = { type: "komi", value: n };
                prefix.push(`${n}p`);
            }
            if (first.handicap !== undefined) {
                declared = parseInt(first.handicap, 10);
            }
            raw = first.placements;
        }
        const split = this.splitMarks(raw);
        const marked = split.marked;
        let tokens = split.placements;
        let forced: number;
        if (declared !== undefined) {
            forced = Math.min(declared, length);
        } else {
            forced = this.forcedPasses();
            if (forced === length) {
                // The passes that spell out a move served entirely by the handicap.
                tokens = [];
            }
        }
        const sim = this.newSim(length, 0);
        if (declared !== undefined) {
            sim.results.push({ type: "declare", count: declared });
            sim.placed++;
            this.serveForced(sim, forced - 1);
        } else {
            this.serveForced(sim, forced);
        }
        for (const token of tokens) {
            const err = this.applyToken(sim, token, colour);
            if (err !== undefined) {
                throw new UserFacingError("VALIDATION_GENERAL", this.tokenMessage(err, token));
            }
        }
        if (partial) {
            this.commitSim(sim, seat, declared, forced);
            if (komiResult !== undefined) {
                this.results.unshift(komiResult);
            }
            // Show the marking the move would leave: its own when it passes any placement (judged
            // on the board after its placements), none when it places every one.
            const rest = Array<string>(Math.max(0, length - forced - tokens.length)).fill("pass");
            if (declared === undefined && this.passesAny([...tokens, ...rest])) {
                this.marks = this.locked ? [] : this.canonicalMarks(marked);
            } else if (tokens.some((token) => token !== "pass")) {
                this.marks = [];
            }
            return false;
        }
        const err = this.finishMove(sim, colour);
        if (err !== undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", this.tokenMessage(err, "pass"));
        }
        const spelled = [...tokens, ...Array<string>(sim.placed - forced - tokens.length).fill("pass")];
        this.commitSim(sim, seat, declared, forced);
        if (komiResult !== undefined) {
            this.results.unshift(komiResult);
        }
        this.interim = sim.created.slice(0, -1);
        this.novel = sim.created.length > 0;
        let agreed = false;
        if (declared !== undefined && forced === length) {
            // The declaration alone: every placement of the move given away as a handicap stone,
            // which answers a marking like a move that passes nothing.
            this.lastmove = `${declared}s`;
            this.passes = [];
            if (this.markingPending()) {
                this.endMarking();
            }
            this.clearMarks();
        } else if (forced === length) {
            // Automatic passes neither count towards ending the game nor interrupt a run of
            // passes, and leave the pending marking as it is.
            this.lastmove = Array<string>(length).fill("pass").join(",");
        } else if (this.passesAny(spelled)) {
            agreed = this.recordPass(seat, spelled, marked);
        } else {
            // A move that places every placement: it answers no marking, and ends marking for the
            // rest of the game when one is pending.
            this.lastmove = spelled.join(",");
            this.passes = [];
            if (this.markingPending()) {
                this.endMarking();
            }
            this.clearMarks();
        }
        if (declared !== undefined && forced < length) {
            this.lastmove = [`${declared}s`, this.lastmove].join(",");
        }
        if (prefix.length > 0) {
            this.lastmove = [...prefix, this.lastmove].join(",");
        }
        this.currplayer = this.otherSeat(seat);

        if (sim.over) {
            this.endGame([1, 2], "repetition");
        } else if (agreed) {
            this.endByAgreement();
        }
        return true;
    }

    /**
     * Record a move that passes at least one placement, and the marking it carries, judged on the
     * board after its placements: a mark on a stone they captured drops out. When the opponent's
     * last move was such a pass, this one answers its marking: a whole-move pass keeping it ends
     * the game, which is what the result reports; a move that places a stone or changes the
     * marking never does, and the players may change it back and forth for as long as their
     * passes follow one another. A pass that marks nothing dead after a marking ends marking for
     * the rest of the game; it still counts as a pass, so the opponent's next whole-move pass ends
     * the game with every stone alive.
     */
    private recordPass(seat: playerid, spelled: string[], marked: string[]): boolean {
        const pure = this.passesWholeMove(spelled);
        const marks = this.canonicalMarks(marked);
        const pending = this.inheritedMarks();
        const inherited = pending === undefined ? undefined : this.canonicalMarks(pending);
        const changed = inherited !== undefined && !this.sameMarks(marks, inherited);
        if (changed || (inherited === undefined && marks.length > 0)) {
            // Marks after a pass that carried none are a marking, not a change of one.
            const how = inherited === undefined || inherited.length === 0 ? "marked" : marks.length > 0 ? "changed" : "cleared";
            this.results.push({ type: "select", what: "dead", how, ...(marks.length > 0 ? { where: marks.join(",") } : {}) });
        }
        this.lastmove = [...spelled, ...this.markTokens(marks)].join(",");
        if (this.markingPending() && marks.length === 0) {
            this.endMarking();
        }
        this.marks = marks;
        this.passes = [...this.passes, seat];
        return pure && inherited !== undefined && !changed;
    }

    /** Copy the outcome of a move in progress into the game. */
    private commitSim(sim: ISim, seat: playerid, declared: number | undefined, forced: number): void {
        this.board = sim.board;
        this.results = sim.results;
        this.placed += sim.placed;
        if (sim.buttonTaken) {
            this.button = seat;
        }
        if (declared !== undefined) {
            this.handicap = declared;
            this.passesOwed = declared - forced;
        } else {
            this.passesOwed -= forced;
        }
    }

    /** Standard handicap: serve every following move of Player 2 that the handicap passes cover. */
    private serveForcedMoves(): void {
        while (!this.gameover && this.phase === "play" && !this.killAll && this.currplayer === 2 && this.passesOwed > 0) {
            const length = this.moveLength(this.placed);
            if (this.passesOwed < length) {
                return;
            }
            this.results = [];
            for (let i = 0; i < length; i++) {
                this.results.push({ type: "pass", why: "handicap" });
            }
            this.interim = [];
            this.novel = false;
            this.alive = undefined;
            this.passesOwed -= length;
            this.placed += length;
            this.lastmove = Array<string>(length).fill("pass").join(",");
            this.currplayer = 1;
            this.saveState();
        }
    }

    // -----------------------------------------------------------------------
    // Ends of games
    // -----------------------------------------------------------------------

    private endGame(winners: playerid[], reason: string, alive?: string[]): void {
        this.gameover = true;
        this.winner = [...winners];
        this.alive = alive;
        this.results.push(
            { type: "eog", reason },
            { type: "winners", players: [...winners] },
        );
    }

    /**
     * The standard game ends when a player passes their whole move keeping the marking the
     * opponent's whole-move pass left: the marked strings are removed and the board is scored.
     */
    private endByAgreement(): void {
        if (this.marks.length > 0) {
            for (const cell of this.marks) {
                this.board.delete(cell);
            }
            this.results.push({ type: "remove", where: this.marks.join(","), num: this.marks.length, how: "dead" });
            this.marks = [];
        }
        const scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
        let winners: playerid[] = [1, 2];
        if (scores[0] !== scores[1]) {
            winners = scores[0] > scores[1] ? [1] : [2];
        }
        this.endGame(winners, "consecutive-passes");
    }

    /**
     * Kill-All: the Defender wins once a Red string is pass-alive, and the Attacker wins once that
     * can never happen, because the Attacker's own pass-alive stones leave no room for the eyes
     * such a string needs. The two cannot coincide, as a pass-alive Red string has that room.
     */
    private checkLifeAndDeath(): void {
        if (this.gameover) {
            return;
        }
        const minVital = this.minVital;
        const alive = passAliveStrings(this.board, this.geo, 1, { suicideAllowed: true, minVital });
        if (alive.length > 0) {
            this.endGame([this.defenderSeat!], "pass-alive", alive.flat());
            return;
        }
        const permanent = passAliveStrings(this.board, this.geo, 2, { suicideAllowed: true, minVital }).flat();
        if (!this.roomForEyes(new Set(permanent), minVital)) {
            this.endGame([this.attackerSeat!], "no-room", permanent);
        }
    }

    /** Kill-All: passing is not allowed, so a player with no legal move loses. */
    private checkStalemate(): void {
        if (this.gameover) {
            return;
        }
        if (!this.hasLegalMove(this.currplayer)) {
            this.endGame([this.otherSeat(this.currplayer)], "no-moves");
        }
    }

    /**
     * Whether the board still has room for the `eyes` vital regions a pass-alive Defender string
     * needs, given the Attacker's pass-alive stones `permanent`. Those can never be captured, and
     * a point next to one of them can never lie in a vital region of a pass-alive Defender string,
     * so the regions lie among the points touching no permanent stone, in one component of the
     * board minus those stones, and are pairwise non-adjacent. The test is sound but not complete:
     * it never gives up on a Defender who could still live, but does not recognise every hopeless
     * position.
     */
    private roomForEyes(permanent: Set<string>, eyes: number): boolean {
        if (permanent.size === 0) {
            return true;
        }
        const seen = new Set<string>();
        for (const start of this.geo.cells) {
            if (permanent.has(start) || seen.has(start)) {
                continue;
            }
            const eyePoints: string[] = [];
            const todo = [start];
            seen.add(start);
            while (todo.length > 0) {
                const cur = todo.pop()!;
                const adj = this.geo.neighbours.get(cur)!;
                if (!adj.some((n) => permanent.has(n))) {
                    eyePoints.push(cur);
                }
                for (const n of adj) {
                    if (!permanent.has(n) && !seen.has(n)) {
                        seen.add(n);
                        todo.push(n);
                    }
                }
            }
            if (this.hasIndependentPoints(eyePoints, eyes)) {
                return true;
            }
        }
        return false;
    }

    /** Whether `points` include `count` that are pairwise non-adjacent. */
    private hasIndependentPoints(points: string[], count: number): boolean {
        // The board graph is planar, so (four colours) any n points include n/4 non-adjacent ones.
        if (points.length >= 4 * count) {
            return true;
        }
        const adjacent = (a: string, b: string): boolean => this.geo.neighbours.get(a)!.includes(b);
        const search = (from: number, chosen: string[]): boolean => {
            if (chosen.length === count) {
                return true;
            }
            for (let i = from; i < points.length; i++) {
                if (chosen.some((c) => adjacent(c, points[i]))) {
                    continue;
                }
                if (search(i + 1, [...chosen, points[i]])) {
                    return true;
                }
            }
            return false;
        };
        return search(0, []);
    }

    // -----------------------------------------------------------------------
    // Scores
    // -----------------------------------------------------------------------

    /** The empty regions of `board`, each with the colour it reaches when that is a single one. */
    private regions(board: Board): IRegion[] {
        const regions: IRegion[] = [];
        const seen = new Set<string>();
        for (const cell of this.geo.cells) {
            if (board.has(cell) || seen.has(cell)) {
                continue;
            }
            const cells: string[] = [];
            const reached = new Set<Stone>();
            const todo = [cell];
            seen.add(cell);
            while (todo.length > 0) {
                const cur = todo.pop()!;
                cells.push(cur);
                for (const n of this.geo.neighbours.get(cur)!) {
                    const occupant = board.get(n);
                    if (occupant === undefined) {
                        if (!seen.has(n)) {
                            seen.add(n);
                            todo.push(n);
                        }
                    } else {
                        reached.add(occupant);
                    }
                }
            }
            const region: IRegion = { cells };
            if (reached.size === 1) {
                region.owner = [...reached][0];
            }
            regions.push(region);
        }
        return regions;
    }

    /** Tromp-Taylor area on `board`: stones of `colour` plus the empty points reaching only them. */
    private area(colour: Stone, board: Board): number {
        let score = 0;
        for (const stone of board.values()) {
            if (stone === colour) {
                score++;
            }
        }
        for (const region of this.regions(board)) {
            if (region.owner === colour) {
                score += region.cells.length;
            }
        }
        return score;
    }

    /** Tromp-Taylor area, with the strings marked dead removed, plus the button, plus Player 1's reverse komi. */
    public getPlayerScore(player: playerid): number {
        const colour = this.colourOfSeat(player);
        if (colour === undefined) {
            return 0;
        }
        const komi = player === 1 ? this.komi ?? 0 : 0;
        return this.area(colour, this.effectiveBoard()) + (this.button === player ? this.buttonValue : 0) + komi;
    }

    public sidebarScores(): IScores[] {
        if (this.killAll) {
            return [];
        }
        return [{
            name: this.neutralAreaLabel("apgames:status.SCORES"),
            scores: [this.getPlayerScore(1), this.getPlayerScore(2)],
        }];
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    public state(): IThueMorseGoState {
        return {
            game: ThueMorseGoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const state: IMoveState = {
            _version: ThueMorseGoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            phase: this.phase,
            placed: this.placed,
            passes: [...this.passes],
            interim: [...this.interim],
            novel: this.novel,
            marks: [...this.marks],
            locked: this.locked,
        };
        if (this.button !== undefined) { state.button = this.button; }
        if (this.handicap !== undefined) { state.handicap = this.handicap; }
        if (this.passesOwed > 0) { state.passesOwed = this.passesOwed; }
        if (this.komi !== undefined) { state.komi = this.komi; }
        if (this.defenderSeat !== undefined) { state.defenderSeat = this.defenderSeat; }
        if (this.alive !== undefined) { state.alive = [...this.alive]; }
        return state;
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    /**
     * The numbered stones of the current picker, added to `legend` and returned as a cell map,
     * along with the cell of the value chosen so far. The stones are Attacker stones in Kill-All
     * games and neutral when they stand for passes.
     */
    private pickerOverlay(legend: ILegend, paletteBorders: boolean): { overlay: Map<string, string>; chosen: string[] } {
        const overlay = new Map<string, string>();
        const picker = this.picker();
        if (picker === undefined) {
            return { overlay, chosen: [] };
        }
        const paint = this.killAll ? this.stonePaint(2, paletteBorders) : { fill: UNDECIDED_COLOUR };
        for (const btn of picker.buttons) {
            if (this.board.has(btn.cell)) {
                // The stone shows; the point still answers to a click with this value.
                continue;
            }
            const key = `n${btn.value}`;
            legend[key] = [{ name: "piece", paint }, { text: btn.value.toString(), scale: 0.75, rotate: null }];
            overlay.set(btn.cell, key);
        }
        return { overlay, chosen: [...picker.chosen] };
    }

    /**
     * The star points of the board: those the renderer draws on a square board of this size, except
     * that the 11x11 board takes the 4-4 points and no centre.
     */
    private starPoints(): RowCol[] {
        const size = this.boardSize;
        const d = size === 11 || size > 12 ? 4 : 3;
        const lo = d - 1;
        const hi = size - d;
        const points: RowCol[] = [{ row: lo, col: lo }, { row: lo, col: hi }, { row: hi, col: hi }, { row: hi, col: lo }];
        if (size % 2 === 1 && size !== 11) {
            const mid = Math.floor(size / 2);
            points.push({ row: mid, col: mid });
            if (size >= 15) {
                points.push({ row: lo, col: mid }, { row: mid, col: hi }, { row: hi, col: mid }, { row: mid, col: lo });
            }
        }
        return points;
    }

    /**
     * Kill-All: the pass-alive stones of both sides, drawn faded in the position that ended the
     * game, or in every position under the display option, as in Kill-All Go. The final position
     * is known by its own `eog` result, since `gameover` holds for every position of a finished
     * game once loaded, and the stones fade at any end, a stalemate or a repetition included.
     */
    private passAliveOverlay(legend: ILegend, throughout: boolean, paletteBorders: boolean): Map<string, string> {
        const alive = new Map<string, string>();
        if (!this.killAll || !(throughout || this.results.some((r) => r.type === "eog"))) {
            return alive;
        }
        for (const colour of [1, 2] as const) {
            const cells = passAliveStrings(this.board, this.geo, colour, { suicideAllowed: true, minVital: this.minVital }).flat();
            if (cells.length > 0) {
                const key = `L${colour}`;
                legend[key] = [{ name: "piece", paint: this.stonePaint(colour, paletteBorders), opacity: ALIVE_OPACITY }];
                for (const cell of cells) {
                    alive.set(cell, key);
                }
            }
        }
        return alive;
    }

    /**
     * The territory the board scores as it stands, with the strings marked dead removed: a dot on
     * every empty point that reaches only one colour, and the marked stones faded, each with a dot
     * of the colour the point under it counts for, so a lone first stone claims the whole board.
     * Shown in the standard game unless the display hides it; the marked stones are faded regardless.
     * Returns the legend keys of the marked stones by cell and the dots for the empty points.
     */
    private territoryOverlay(legend: ILegend, hide: boolean, paletteBorders: boolean): { dead: Map<string, string>; dots: MarkerDots[] } {
        const dead = new Map<string, string>();
        const dots: MarkerDots[] = [];
        if (this.killAll) {
            return { dead, dots };
        }
        const owner = new Map<string, Stone>();
        if (!hide) {
            for (const region of this.regions(this.effectiveBoard())) {
                if (region.owner !== undefined) {
                    for (const cell of region.cells) {
                        owner.set(cell, region.owner);
                    }
                }
            }
        }
        // Colours are seats in the standard game, so they name their palette slots directly.
        for (const cell of this.marks) {
            const stone = this.board.get(cell);
            if (stone === undefined) {
                continue;
            }
            const under = owner.get(cell);
            const key = under === undefined ? `D${stone}` : `D${stone}T${under}`;
            if (!(key in legend)) {
                const faded: Glyph = { name: "piece", paint: this.stonePaint(stone, paletteBorders), opacity: DEAD_OPACITY };
                legend[key] = under === undefined ? [faded] : [faded, { name: "piece-borderless", paint: { fill: under }, scale: DOT_SIZE }];
            }
            dead.set(cell, key);
        }
        const points: [RowCol[], RowCol[]] = [[], []];
        for (const [cell, colour] of owner) {
            if (!this.board.has(cell)) {
                const [x, y] = this.algebraic2coords(cell);
                points[colour - 1].push({ row: y, col: x });
            }
        }
        for (const colour of [1, 2] as const) {
            const pts = points[colour - 1];
            if (pts.length > 0) {
                dots.push({ type: "dots", colour, size: DOT_SIZE, points: pts as [RowCol, ...RowCol[]] });
            }
        }
        return { dead, dots };
    }

    /**
     * The Thue-Morse tracker, a column of 16 cells per hexadecimal digit of the index of the next
     * placement, least significant on the right, with the rows running 0 to f up (or down) each
     * column and a marker on each digit's current value. A column shows, for each value of its
     * digit, the colour of the placement with that value there, the current values above it and
     * zeros below: the rightmost column is the colours of the placements still to come before the
     * next carry, and every other column is the colour of the 0 row of the column to its right.
     * The rolling display shows one column of the next 16 placements instead, marking those of the
     * next move. The tint behind the columns is the colour of the next placement. Blank columns
     * separate the columns and keep the last one clear of the board's row labels. A repeating
     * protocol needs no tracker. The digit tracker has three columns; once the index needs more,
     * it shows only grey stones, with no markers, tint or border, rather than digits it cannot show.
     */
    private trackArea(legend: ILegend, downward: boolean, rolling: boolean, paletteBorders: boolean): AreaTrack | undefined {
        if (this.period > 0) {
            return undefined;
        }
        const next = this.placed;
        const overflow = !rolling && next > MAX_TRACK_INDEX;
        const nextFill = this.fillOfColour(this.colourAt(next));
        const tint: Glyph = { name: "piece-square", paint: { fill: overflow ? UNDECIDED_COLOUR : nextFill }, opacity: TRACK_TINT };
        // Keys that differ only in case would be confused by a page in quirks mode, where id lookups
        // ignore case, so the small glyphs are s1/s2, the plain markers m1/m2, and the digit
        // markers m1d0 to m2df, by their digit.
        const small = (colour: Stone): string => {
            const key = `s${colour}`;
            if (!(key in legend)) {
                legend[key] = [tint, { name: "piece", paint: this.stonePaint(colour, paletteBorders), scale: SMALL_SCALE }];
            }
            return key;
        };
        // A full-size stone; the TMS tracker writes the digit it stands for on it.
        const marker = (colour: Stone, digit?: number): string => {
            const key = digit === undefined ? `m${colour}` : `m${colour}d${digit.toString(16)}`;
            if (!(key in legend)) {
                const stone: Glyph = { name: "piece", paint: this.stonePaint(colour, paletteBorders) };
                legend[key] = digit === undefined
                    ? [tint, stone]
                    : [tint, stone, { text: digit.toString(16), scale: DIGIT_SCALE, rotate: null }];
            }
            return key;
        };

        // Each column top to bottom, as legend keys.
        const columns: string[][] = [];
        if (rolling) {
            const length = this.moveLength(next);
            const column: string[] = [];
            for (let row = 0; row < TRACK_ROWS; row++) {
                const i = downward ? row : TRACK_ROWS - 1 - row;
                const colour = this.colourAt(next + i);
                column.push(i < length ? marker(colour) : small(colour));
            }
            columns.push(column);
        } else if (overflow) {
            const key = "s0";
            legend[key] = [tint, { name: "piece", paint: { fill: UNDECIDED_COLOUR }, scale: SMALL_SCALE }];
            for (let d = 0; d < TRACK_DIGITS; d++) {
                columns.push(Array<string>(TRACK_ROWS).fill(key));
            }
        } else {
            const digits = TRACK_DIGITS;
            for (let d = 0; d < digits; d++) {
                const unit = Math.pow(16, digits - 1 - d);
                const above = Math.floor(next / (unit * 16));
                const current = Math.floor(next / unit) % 16;
                const column: string[] = [];
                for (let row = 0; row < TRACK_ROWS; row++) {
                    const digit = downward ? row : TRACK_ROWS - 1 - row;
                    const colour = this.colourAt((above * 16 + digit) * unit);
                    column.push(digit === current ? marker(colour, digit) : small(colour));
                }
                columns.push(column);
            }
        }

        // A blank frame surrounds the columns, with a blank column between digits. The frame makes
        // room for the border and keeps the tracker clear of the board's row labels.
        const width = 2 * columns.length + 1;
        const height = TRACK_ROWS + 2;
        const blocked: RowCol[] = [];
        const rows: string[] = [];
        for (let row = 0; row < height; row++) {
            const cells: string[] = [];
            for (let col = 0; col < width; col++) {
                if (row >= 1 && row <= TRACK_ROWS && col % 2 === 1) {
                    cells.push(columns[(col - 1) / 2][row - 1]);
                } else {
                    cells.push("-");
                    blocked.push({ row, col });
                }
            }
            // Multi-character keys need the comma-delimited form.
            rows.push(cells.join(","));
        }
        // A thick border around the columns in the colour of the next placement, unless the tracker
        // has gone grey; the line points of a squares board are cell corners.
        const corners: RowCol[] = [
            { row: 1, col: 1 },
            { row: 1, col: width - 1 },
            { row: height - 1, col: width - 1 },
            { row: height - 1, col: 1 },
        ];
        const border: MarkerLine[] = corners.map((from, i) => ({
            type: "line",
            points: [from, corners[(i + 1) % corners.length]],
            colour: nextFill,
            width: TRACK_BORDER_WIDTH,
        }));
        return {
            type: "track",
            position: "left",
            board: {
                style: "squares",
                width,
                height,
                blocked: blocked as [RowCol, ...RowCol[]],
                ...(overflow ? {} : { markers: border }),
            },
            pieces: rows.join("\n"),
        };
    }

    /**
     * The results the board annotates: the loaded state's own, unless that state is a move served
     * automatically by the handicap, which changed nothing on the board; the last placements are
     * then those of the move before it.
     */
    private annotationResults(): APMoveResult[] {
        if (this.results.length === 0 || !this.results.every((r) => r.type === "pass" && r.why === "handicap")) {
            return this.results;
        }
        const idx = this.stack.findIndex((state) => state.placed === this.placed && state.currplayer === this.currplayer);
        return idx > 0 ? this.stack[idx - 1]._results : this.results;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const downward = this.hasDisplay(opts, "digits-down");
        const rolling = !this.hasDisplay(opts, "tms-tracker");
        const hideDots = this.hasDisplay(opts, "hide-territory");
        const paletteBorders = this.hasDisplay(opts, "palette-borders");
        const legend: ILegend = {
            A: [{ name: "piece", paint: this.stonePaint(1, paletteBorders) }],
            B: [{ name: "piece", paint: this.stonePaint(2, paletteBorders) }],
        };
        const { overlay, chosen } = this.pickerOverlay(legend, paletteBorders);
        const { dead, dots } = this.territoryOverlay(legend, hideDots, paletteBorders);
        const alive = this.passAliveOverlay(legend, this.hasDisplay(opts, "pass-alive-throughout"), paletteBorders);

        const rows: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            const cells: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = this.board.get(cell);
                cells.push(overlay.get(cell) ?? dead.get(cell) ?? alive.get(cell) ?? (contents === 1 ? "A" : contents === 2 ? "B" : "-"));
            }
            if (cells.every((c) => c === "-")) {
                rows.push("_");
            } else {
                // Multi-character keys need the comma-delimited form.
                rows.push(overlay.size > 0 || dead.size > 0 || alive.size > 0 ? cells.join(",") : cells.join(""));
            }
        }

        const rep: APRenderRep = {
            board: {
                style: this.variants.includes("snub") ? "snubsquare" : "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend,
            pieces: rows.join("\n"),
        };
        // The renderer's own star points serve every square board but the 11x11, which takes the
        // 4-4 points without a centre; snub square boards get those of the square board of their size.
        const snub = this.variants.includes("snub");
        const markers: MarkerDots[] = [];
        if (snub || this.boardSize === 11) {
            markers.push({ type: "dots", size: STAR_SIZE, points: this.starPoints() as [RowCol, ...RowCol[]] });
        }
        markers.push(...dots);
        if (markers.length > 0) {
            (rep.board as BoardBasic).markers = markers;
        }
        if (!snub && this.boardSize === 11) {
            rep.options = ["hide-star-points"];
        }
        const track = this.trackArea(legend, downward, rolling, paletteBorders);
        if (track !== undefined) {
            rep.areas = [track];
        }

        const toRowCol = (cell: string): RowCol => {
            const [x, y] = this.algebraic2coords(cell);
            return { row: y, col: x };
        };
        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        for (const r of this.annotationResults()) {
            if (r.type === "place") {
                annotations.push({ type: "enter", targets: [toRowCol(r.where!)] });
            } else if (r.type === "capture" || r.type === "remove") {
                const targets = r.where!.split(",").map(toRowCol);
                annotations.push({ type: "exit", targets: targets as [RowCol, ...RowCol[]] });
            }
        }
        for (const cell of chosen) {
            annotations.push({ type: "enter", targets: [toRowCol(cell)] });
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }
        return rep;
    }

    public sidebarStatuses(): IStatus[] {
        const statuses: IStatus[] = [];
        // Every placement of the next move, so that a two-placement move shows both indices.
        const placements = Array.from({ length: this.moveLength(this.placed) }, (_, i) => (this.placed + i).toString(16));
        statuses.push({
            key: this.neutralAreaLabel("apgames:status.thuemorsego.NEXT_PLACEMENT"),
            value: [placements.join(", ")],
        });
        if (this.killAll) {
            const undecided = this.neutralAreaLabel("apgames:status.thuemorsego.UNDECIDED");
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.DEFENDER"),
                value: [this.defenderSeat === undefined ? undecided : this.seatStatusValue(this.defenderSeat)],
            });
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.ATTACKER"),
                value: [this.attackerSeat === undefined ? undecided : this.seatStatusValue(this.attackerSeat)],
            });
            if (this.handicap !== undefined) {
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.thuemorsego.HANDICAP"),
                    value: [this.handicap.toString()],
                });
            }
            if (this.phase !== "play" && !this.gameover) {
                const phaseKey = this.phase === "hand-n" ? "apgames:status.thuemorsego.PHASE_HAND_N" : "apgames:status.thuemorsego.PHASE_ALT_PLACE";
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.PHASE"),
                    value: [this.seatAreaLabel(this.currplayer, phaseKey)],
                });
            }
            return statuses;
        }
        if (this.buttonValue > 0) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.BUTTON"),
                value: [this.button === undefined ? this.neutralAreaLabel("apgames:status.thuemorsego.BUTTON_AVAILABLE") : this.seatStatusValue(this.button)],
            });
        }
        if (this.reverseKomi) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.KOMI"),
                value: [this.komi === undefined ? this.neutralAreaLabel("apgames:status.thuemorsego.UNDECIDED") : this.komi.toString()],
            });
        }
        if (this.komiPending()) {
            const key = this.declaring() && this.handicap === undefined
                ? "apgames:status.thuemorsego.PHASE_KOMI_DECLARE"
                : "apgames:status.thuemorsego.PHASE_KOMI";
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.PHASE"),
                value: [this.seatAreaLabel(this.currplayer, key)],
            });
        }
        if (!this.gameover && (this.marks.length > 0 || this.locked)) {
            const value = [];
            if (this.marks.length > 0) {
                value.push(this.neutralAreaLabel("apgames:status.thuemorsego.MARKING_COUNT", { count: this.marks.length }));
            }
            if (this.locked) {
                value.push(this.neutralAreaLabel("apgames:status.thuemorsego.MARKING_LOCKED"));
            }
            statuses.push({ key: this.neutralAreaLabel("apgames:status.thuemorsego.MARKING"), value });
        }
        if (this.handicapVariant && !this.gameover && !this.komiPending()) {
            if (this.declaring() && this.handicap === undefined) {
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.PHASE"),
                    value: [this.seatAreaLabel(this.currplayer, "apgames:status.thuemorsego.PHASE_DECLARE")],
                });
            } else if (this.passesOwed > 0) {
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.thuemorsego.PASSES_OWED"),
                    value: [this.passesOwed.toString()],
                });
            }
        }
        return statuses;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                if (r.what === "setup") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:thuemorsego.PLACE.setup", { where: r.where! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PLACE.nowhat", { where: r.where! });
                }
                return true;
            case "capture":
                if (r.how === "suicide") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:thuemorsego.CAPTURE.suicide", { count: r.count! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.CAPTURE.noperson.group_nowhere", { count: r.count! });
                }
                return true;
            case "pass":
                if (r.why === "handicap") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:thuemorsego.PASS.handicap");
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PASS.simple");
                }
                return true;
            case "declare":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:thuemorsego.DECLARE.stones", { count: r.count! });
                return true;
            case "claim":
                if (r.how === "attacker") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:thuemorsego.CLAIM.attacker");
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "select":
                if (r.what === "dead") {
                    if (r.how === "locked") {
                        this.pushNeutralChatLine(lines, "apresults:thuemorsego.SELECT.locked");
                        return true;
                    }
                    const count = r.where === undefined ? 0 : r.where.split(",").length;
                    const key = r.how === "marked"
                        ? "apresults:thuemorsego.SELECT.marked"
                        : r.how === "changed" ? "apresults:thuemorsego.SELECT.changed" : "apresults:thuemorsego.SELECT.cleared";
                    this.pushSeatChatLine(lines, ctx.defaultSeat, key, { count });
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "remove":
                if (r.how === "dead") {
                    this.pushNeutralChatLine(lines, "apresults:thuemorsego.REMOVE.dead", { count: r.num! });
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "komi":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:thuemorsego.DECLARE.komi", { count: r.value });
                return true;
            case "eog":
                switch (r.reason) {
                    case "consecutive-passes":
                        this.pushNeutralChatLine(lines, "apresults:_general.EOG.consecutive_passes");
                        break;
                    case "repetition":
                        this.pushNeutralChatLine(lines, "apresults:thuemorsego.EOG.repetition");
                        break;
                    case "pass-alive":
                        this.pushNeutralChatLine(lines, "apresults:thuemorsego.EOG.pass_alive");
                        break;
                    case "no-room":
                        this.pushNeutralChatLine(lines, "apresults:thuemorsego.EOG.no_room");
                        break;
                    case "no-moves":
                        this.pushNeutralChatLine(lines, "apresults:thuemorsego.EOG.no_moves");
                        break;
                    default:
                        this.pushNeutralChatLine(lines, "apresults:_general.EOG.default");
                }
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): ThueMorseGoGame {
        return new ThueMorseGoGame(this.serialize());
    }
}
