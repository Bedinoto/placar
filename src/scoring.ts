export type Score = 0 | 15 | 30 | 40 | 'AD';

export interface SetScore {
  t1: number;
  t2: number;
}

export interface MatchState {
  points: [Score, Score];
  games: [number, number];
  sets: [number, number];
  setHistory: SetScore[];
  server: 0 | 1;
  isGameOver: boolean;
  winner: 0 | 1 | null;
  gameMode: 'padel' | 'beach';
  bestOf: number;
  goldenPoint: boolean;
  teamNames: [string, string];
  undoStack?: Omit<MatchState, 'undoStack'>[];
}

export function getPointCount(point: Score): number {
  switch (point) {
    case 15: return 1;
    case 30: return 2;
    case 40: return 3;
    case 'AD': return 4;
    default: return 0;
  }
}

// Pure function to handle winning/updating a single point
export function processPoint(state: MatchState, teamIndex: 0 | 1): MatchState {
  if (state.isGameOver) return state;

  const otherIndex = teamIndex === 0 ? 1 : 0;
  
  // Clone current state deep enough so we don't mutate parameters
  const nextPoints = [...state.points] as [Score, Score];
  const nextGames = [...state.games] as [number, number];
  const nextSets = [...state.sets] as [number, number];
  const nextSetHistory = [...(state.setHistory || [])];
  
  const currentPoint = state.points[teamIndex];
  const otherPoint = state.points[otherIndex];

  // Prepare standard newState template
  const newState: MatchState = {
    ...state,
    points: nextPoints,
    games: nextGames,
    sets: nextSets,
    setHistory: nextSetHistory,
  };

  // 1. Scoring rules logic
  if (currentPoint === 0) {
    newState.points[teamIndex] = 15;
  } else if (currentPoint === 15) {
    newState.points[teamIndex] = 30;
  } else if (currentPoint === 30) {
    newState.points[teamIndex] = 40;
  } else if (currentPoint === 40) {
    if (state.goldenPoint || state.gameMode === 'beach') {
      // Golden Point Rule: Whoever wins this point wins the game immediately
      return processGameWin(newState, teamIndex);
    } else {
      // Standard Deuce / Advantage Rule
      if (otherPoint === 40) {
        newState.points[teamIndex] = 'AD';
      } else if (otherPoint === 'AD') {
        newState.points[otherIndex] = 40;
      } else {
        return processGameWin(newState, teamIndex);
      }
    }
  } else if (currentPoint === 'AD') {
    return processGameWin(newState, teamIndex);
  }

  return newState;
}

// Internal function to process winning a game
function processGameWin(state: MatchState, teamIndex: 0 | 1): MatchState {
  const otherIndex = teamIndex === 0 ? 1 : 0;
  
  const newState: MatchState = {
    ...state,
    points: [0, 0] as [Score, Score],
    games: [...state.games] as [number, number],
    server: state.server === 0 ? 1 : 0, // Switch server every game
  };

  newState.games[teamIndex]++;

  const gamesTeam = newState.games[teamIndex];
  const gamesOther = newState.games[otherIndex];

  // Check for Set Win (unless in infinite / training mode: bestOf === 0)
  if (state.bestOf !== 0) {
    if ((gamesTeam >= 6 && gamesTeam - gamesOther >= 2) || (gamesTeam === 7 && gamesOther === 6)) {
      return processSetWin(newState, teamIndex);
    }
  }

  return newState;
}

// Internal function to process winning a set
function processSetWin(state: MatchState, teamIndex: 0 | 1): MatchState {
  const newState: MatchState = {
    ...state,
    games: [0, 0] as [number, number],
    sets: [...state.sets] as [number, number],
    setHistory: [
      ...(state.setHistory || []),
      { t1: state.games[0], t2: state.games[1] }
    ],
  };

  newState.sets[teamIndex]++;

  // Check for Match Win
  const setsToWin = Math.ceil(state.bestOf / 2);
  if (newState.sets[teamIndex] >= setsToWin) {
    newState.isGameOver = true;
    newState.winner = teamIndex;
  }

  return newState;
}
