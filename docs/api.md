# Games Library API

All of Abstract Play's internal games exist within this single Node project. This document describes the public-facing API that can be used by the browser and the API to interact with the game code. For concrete examples, see `playground/index.html`.

This document only looks at the public interface&mdash;the relatively small selection of variables and functions exported by the root module. Documentation for games developers will come later.

The AI code in this library is for testing only. It is not ready for release and is not documented here yet.

## Usage

In the browser, simply load `APGames.js` via a `<script>` tag. From within Node, simply import the variables and functions you need. Both methods give you access to the same API.

## API

The API currently consists of only one variable and two functions:

* `gameinfo`: This variable contains the full details on all implemented games.
* `GameFactory`: This function accepts a game's `uid` an optional list of constructor arguments and returns an instance of that game object.
* `addResource`: This incorporates the library's i18next translations into the client environment.

### `gameinfo`

The games are self-documenting. The variable itself is an ES6 `Map` of game uid to object matching the `gameinfo.json` schema in the `/schemas` folder. See the schema for details. In summary, the following information is provided:

* unique id (the "primary key" used throughout the system)
* full name
* a Markdown-encoded description of the game, including any relevant implementation notes and sometimes a rules summary
* a list of URLs related to the game
* a list of people involved in the game
* a list of supported player counts
* a list of supported variants
* a list of flags, the presence of absence of which signal features that may require special handling

Current flags are the following:

* `aiai`: Tells the front and back ends that this game supports the AiAi bot. That means it correctly implements `state2aiai() => string[]` (which generates a full list of moves understandable by AiAi) and `translateAiai(move: string) => string` (which translates the moves from AiAi back into AP notation).
* `automove`: signals that it is possible or even common for a player to only have one movement choice (most usually "pass"). The processor should consider checking for that possibility and making that single move automatically, to keep things moving quickly.
* `check`: This tells the front end that this game should signal to players when someone is "in check," which usually means if nothing specific is done, the noted player will lose at their next turn. Flagged games must provide a `inCheck() => number[]` function that returns the player numbers of any players in check.
* `custom-buttons`: Tells the front end to call `getButtons() => ICustomButton[]` to get a list of possible custom move buttons to add to the interface.
* `custom-colours`: Mutually exclusive with `shared-pieces`. Tells the front end to *not* automatically assign player colour swatches. Instead, it must call `getPlayerColour(n) => number|string`. Use should be rare. For example, in Alien City, players are black and white.
* `custom-randomization`: Requires that `no-moves` be set. Tells the playground that the `randomMove()` function can still be called to algorithmically generate a random move.
* `experimental`: Flags new games still in development. Production-stage front and back ends should ignore requests to display or process these games. Dev server should process them as usual.
* `limited-pieces`: signals that players have a limited number of pieces, the number of which should be displayed to the players. Use `getPlayerPieces(playerid: number) => number` to fetch the number of pieces the given player has at the moment. Mutually exclusive with `player-stashes`.
* `no-moves`: signals that the game cannot produce a list of possible moves. In all other games, you can use `moves(player?: number) => string[]` to get a list of valid moves.
* `perspective`: signals that the game can adjust the rendered image for a player's perspective. The front end should set the default rotation for the different players accordingly. By increments of 180, or 90 if `rotate90` is set.
* `pie-even`: Same as `pie` but the back end will automatically insert a "pass" move after the invocation.
* `pie`: The front end should give the second player a chance to switch seats after the first move.
* `player-stashes`: signals that players have their own piece stashes. Use `getPlayerStash(playerid: number) => IPlayerStash` to fetch a player's current stash. `IPlayerStash` contains the properties `small`, `medium`, and `large`, each containing a number. Mutually exclusive with `limited-pieces`;
* `random-start`: Tells the game record generator to insert the starting position into the game record. It does this by calling `getStartingPosition() => string`.
* `rotate90`: Whether the board can be rotated by 90 degree increments. If not set, only 180 degree increments are assumed.
* `scores`: signals that players have scores. The front end can use `getPlayerScore(playerid: number) => number` to fetch scores.
* `shared-pieces`: signals that players don't own any pieces, so the front end can omit any display that links players to colours.
* `shared-stash`: signals that players share a stash of pieces. Use `getSharedStash() => IPlayerStash` to fetch the current shared stash.
* `simultaneous`: signals that moves for all players must be submitted at once. The front-end will need to store partial moves until all players have submitted.
* `stacking-expanding`: signals that the game uses the `stacking-expanding` renderer. Pass the clicked-upon column and row to `render()` to display the expanded stack in the rendered image. Or call `renderColumn()` with the column and row to receive a separate render JSON just representing the expanded stack.

### `GameFactory`

This function is how you instantiate a particular game. Pass it the game's `uid` and any constructor parameters to receive the game instance. Passing it an existing state object (described more below) is how you load a game in progress. Otherwise you'll get a brand new game.

### `addResource`

This is how to get long-form, localized messages from the games library. A list of supported locales is available in the exported variable `supportedLocales: string[]`.

* If you're using i18next on your front end, do the following after initializing: `const i18n = APGames.addResource(lang); const { t } = i18n;`. This will merge the library's translations with yours under the `apgames` and `apresults` namespaces.
* If you're not using i18next yourself, then simply call `APGames.addResource(lang)` at the beginning and every time the user changes their language. The library will use its own i18next instance.

The only errors that are translated are those that could realistically be triggered by player input. They are captured using a specific error class, which inherits from `Error`, with the name `UserFacingError`. The `message` property is just an error code used internally by the library. The property `client` contains the localized string.

All other errors are just standard `Error` objects with a `message` suitable for the developers.

## The Game Object

All games implement a core set of features, which make up the public API.

### State

Functions:

* `serialize() => string`
* `state() => IAPGameState`
* `load(idx?: number = -1) => GameBase`
* `render() => APRenderRep`

The `serialize()` function is how to persist states. It produces a simple string that can be stored. It abstracts away any nuances of the internal representation (e.g., "replacer" or "reviver" helpers). The resulting string can then be passed to the constructor to rehydrate.

The `state()` function will return an object of type `IAPGameState`, described below:

```ts
export interface IAPGameState {
    game: string;
    numplayers: number;
    variants?: string[];
    gameover: boolean;
    winner: any[];
    stack: Array<IIndividualState>;
}

export interface IIndividualState {
    _version: string;
    _results: APMoveResult[];
    [key: string]: any;
}
```

Editing the state object should never be done except for manipulating the stack. Changing the `variants`, for example, would fully corrupt the game record.

* `game` is the uid of the game the state represents. Trying to load a saved state into the wrong game code will throw an error.
* `numplayers` tells you how many players are involved in this particular game instance.
* `variants` is an optional list of variant uids in effect for this game.
* `gameover` indicates whether one of the end-of-game triggers have been met.
* `winner` is an array of numbers indicating the player numbers of those who won. Usually it's an array of length one, but in draws or ties, the list may be longer.
* `stack` is the list of individual game states after each move. You should never edit individual game states, but you could step backwards and forwards through the stack, and could pop the top element off for a quick "undo."

The individual state objects can be loaded using the `load(idx?: number = -1)` instance method. By default it loads the most recent state in the stack, but providing an index value (0 being the initial game state, 1 being after the first move, and so on) will let you interact with that state. You can use a negative index to load states from the most recent (-1 is the latest state, -2 the move before that, etc.).

You can get a graphical representation of the loaded state using the `render()` method. It returns an object ready to pass to the Abstract Play renderer module that matches the schema described there.

### Game Play

Functions:

* `move(m: string) => GameBase`
* `undo() => GameBase`
* `resign(player: number) => GameBase`

The `move` function is the primary method of changing game state. Pass it a string representing a valid move and it will either throw an error or return the modified game state.

The method `undo` removes the latest state of the stack and returns the game object. The engine persisting game states can do this itself by simply modifying the saved state as well.

The `resign` function accepts a player number and removes that person from the game. This will usually result in the game ending. The modified game state is returned.

### Game History

Functions:

* `moveHistory() => string[][]`
* `resultsHistory() => APMoveResult[][]`
* `chatLog(players: string[]) => string[][]`
* `genRecord(data: IRecordDetails) => APGameRecord | undefined`

At any point during a game, you can request a compilation of all the moves made using `moveHistory()`. It returns a list of moves grouped by "round," meaning in a two player game, each array will contain the first and second player's moves together. **This is not the same as a formal game report (described further below).**

Sometimes things happen in a game that are not easily rendered on a static graphical representation. To make it easier to report to players what happened during a move, and to make future analysis of games easier, each move generates one more more "results," described in the schema `moveresults.json` in the `/schemas` folder. the `resultsHistory()` method returns a complete list of results for each move of the game.

Results are things like `place` (for placing a piece), `deltaScore` (representing a change in the current player's score), and `eog` (signalling the game ended in this move). This sort of structured data can then be translated into localized written descriptions of state changes that make up a written game log.

A localized chat log can also be generated. Optionally pass the function `chatLog()` the names of the players, in play order, and a narrative, translated record of the game results will be returned.

Formal game reports that match the RecRanks schema can be generated once the game has concluded through the `genRecord()` method. Because of the separation between the API logic and the game logic, there is a fair bit of metadata the server needs to give the game object to complete the report:

* the game's unique ID
* identifying information on each player (name, unique ID, and whether they are an AI)
* dates the game started and ended
* any event information

Yes, it would be just as simple to generate the reports on the API server and just request the pieces it needs from the game code. That may yet happen. For now, though, record generation lives here.
