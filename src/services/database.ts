import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { Team, Game, Odds, Prediction } from '@/types';

// Collection references (v2 to avoid legacy data)
const teamsCollection = collection(db, 'teams_v2');
const gamesCollection = collection(db, 'games_v2');
const oddsCollection = collection(db, 'odds_v2');
const predictionsCollection = collection(db, 'predictions_v2');

// Helper to convert Firestore timestamps
function convertTimestamps<T>(data: Record<string, unknown>): T {
  const result = { ...data };
  for (const key of Object.keys(result)) {
    if (result[key] instanceof Timestamp) {
      result[key] = (result[key] as Timestamp).toDate();
    }
  }
  return result as T;
}

// Helper to remove undefined values (Firestore doesn't accept undefined)
function sanitizeForFirestore<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

// Teams
export async function getTeam(teamId: string): Promise<Team | null> {
  const docRef = doc(teamsCollection, teamId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  return convertTimestamps<Team>({ id: docSnap.id, ...docSnap.data() });
}

export async function getAllTeams(sport?: string): Promise<Team[]> {
  let q = query(teamsCollection);
  if (sport) {
    q = query(teamsCollection, where('sport', '==', sport));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => convertTimestamps<Team>({ id: d.id, ...d.data() }));
}

export async function saveTeam(team: Partial<Team> & { id: string }): Promise<void> {
  const docRef = doc(teamsCollection, team.id);
  await setDoc(docRef, { ...team, updatedAt: new Date() }, { merge: true });
}

export async function updateTeamElo(teamId: string, newElo: number): Promise<void> {
  const docRef = doc(teamsCollection, teamId);
  await updateDoc(docRef, { eloRating: newElo, updatedAt: new Date() });
}

export async function saveTeamsBatch(teams: Array<Partial<Team> & { id: string }>): Promise<void> {
  const batch = writeBatch(db);
  for (const team of teams) {
    const docRef = doc(teamsCollection, team.id);
    const sanitized = sanitizeForFirestore({ ...team, createdAt: new Date(), updatedAt: new Date() });
    batch.set(docRef, sanitized, { merge: true });
  }
  await batch.commit();
}

// Games
export async function getGame(gameId: string): Promise<Game | null> {
  const docRef = doc(gamesCollection, gameId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  return convertTimestamps<Game>({ id: docSnap.id, ...docSnap.data() });
}

// Simple query - fetch all games for a sport and filter client-side to avoid index requirements
export async function getAllGames(sport: string): Promise<Game[]> {
  const q = query(gamesCollection, where('sport', '==', sport));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => convertTimestamps<Game>({ id: d.id, ...d.data() }));
}

export async function getUpcomingGames(sport: string, limitCount = 20): Promise<Game[]> {
  const allGames = await getAllGames(sport);
  const now = new Date();
  return allGames
    .filter(g => g.status === 'scheduled' && new Date(g.gameTime) >= now)
    .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime())
    .slice(0, limitCount);
}

export async function getGamesByWeek(sport: string, week: number, season: number): Promise<Game[]> {
  const allGames = await getAllGames(sport);
  return allGames
    .filter(g => g.week === week && g.season === season)
    .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
}

export async function saveGame(game: Partial<Game> & { id: string }): Promise<void> {
  const docRef = doc(gamesCollection, game.id);
  await setDoc(docRef, { ...game, updatedAt: new Date() }, { merge: true });
}

export async function saveGamesBatch(games: Array<Partial<Game> & { id: string }>): Promise<void> {
  const batch = writeBatch(db);
  for (const game of games) {
    const docRef = doc(gamesCollection, game.id);
    const sanitized = sanitizeForFirestore({ ...game, updatedAt: new Date() });
    batch.set(docRef, sanitized, { merge: true });
  }
  await batch.commit();
}

export async function getCompletedGames(sport: string, limitCount = 50): Promise<Game[]> {
  const allGames = await getAllGames(sport);
  return allGames
    .filter(g => g.status === 'final')
    .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
    .slice(0, limitCount);
}

// Odds
export async function getOddsForGame(gameId: string): Promise<Odds[]> {
  const q = query(oddsCollection, where('gameId', '==', gameId));
  const snapshot = await getDocs(q);
  const odds = snapshot.docs.map(d => convertTimestamps<Odds>({ id: d.id, ...d.data() }));
  return odds.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function saveOdds(odds: Partial<Odds>): Promise<void> {
  const id = `${odds.gameId}_${odds.bookmaker}_${Date.now()}`;
  const docRef = doc(oddsCollection, id);
  await setDoc(docRef, { ...odds, id });
}

export async function saveOddsBatch(oddsArray: Array<Partial<Odds> & { gameId: string }>): Promise<void> {
  const batch = writeBatch(db);
  for (const odds of oddsArray) {
    const id = `${odds.gameId}_${odds.bookmaker}_${Date.now()}`;
    const docRef = doc(oddsCollection, id);
    batch.set(docRef, { ...odds, id });
  }
  await batch.commit();
}

// Predictions
export async function getPredictionForGame(gameId: string): Promise<Prediction | null> {
  const q = query(predictionsCollection, where('gameId', '==', gameId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const predictions = snapshot.docs
    .map(d => convertTimestamps<Prediction>({ id: d.id, ...d.data() }))
    // Filter to only predictions with our schema (has predictedHomeScore)
    .filter(p => p.predictedHomeScore !== undefined)
    .sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
  return predictions[0] || null;
}

export async function savePrediction(prediction: Partial<Prediction>): Promise<void> {
  const id = `${prediction.gameId}_${Date.now()}`;
  const docRef = doc(predictionsCollection, id);
  await setDoc(docRef, { ...prediction, id, createdAt: new Date() });
}

export async function savePredictionsBatch(predictions: Array<Partial<Prediction> & { gameId: string }>): Promise<void> {
  const batch = writeBatch(db);
  for (const prediction of predictions) {
    const id = `${prediction.gameId}_${Date.now()}`;
    const docRef = doc(predictionsCollection, id);
    batch.set(docRef, { ...prediction, id, createdAt: new Date() });
  }
  await batch.commit();
}

// Elo Processing Helpers

// Get all completed games that haven't been processed for Elo yet
export async function getUnprocessedCompletedGames(sport: string): Promise<Game[]> {
  const allGames = await getAllGames(sport);
  return allGames
    .filter(g => g.status === 'final' && !g.eloProcessed)
    .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());
}

// Mark a single game as processed for Elo
export async function markGameEloProcessed(gameId: string): Promise<void> {
  const docRef = doc(gamesCollection, gameId);
  await updateDoc(docRef, { eloProcessed: true, updatedAt: new Date() });
}

// Mark multiple games as processed for Elo (batch)
export async function markGamesEloProcessedBatch(gameIds: string[]): Promise<void> {
  const batch = writeBatch(db);
  for (const gameId of gameIds) {
    const docRef = doc(gamesCollection, gameId);
    batch.update(docRef, { eloProcessed: true, updatedAt: new Date() });
  }
  await batch.commit();
}

// Reset all games' eloProcessed flag to false
export async function resetAllGamesEloProcessed(sport: string): Promise<void> {
  const allGames = await getAllGames(sport);
  const batch = writeBatch(db);
  for (const game of allGames) {
    const docRef = doc(gamesCollection, game.id);
    batch.update(docRef, { eloProcessed: false, updatedAt: new Date() });
  }
  await batch.commit();
}

// Update team Elo and stats
export async function updateTeamStats(
  teamId: string,
  stats: { eloRating?: number; ppg?: number; ppgAllowed?: number; gamesPlayed?: number }
): Promise<void> {
  const docRef = doc(teamsCollection, teamId);
  await updateDoc(docRef, { ...stats, updatedAt: new Date() });
}

// Batch update team Elos
export async function updateTeamElosBatch(teamElos: Array<{ id: string; eloRating: number }>): Promise<void> {
  const batch = writeBatch(db);
  for (const { id, eloRating } of teamElos) {
    const docRef = doc(teamsCollection, id);
    batch.update(docRef, { eloRating, updatedAt: new Date() });
  }
  await batch.commit();
}

// Reset all team Elos to initial value
export async function resetAllTeamElos(sport: string, initialElo: number = 1500): Promise<void> {
  const allTeams = await getAllTeams(sport);
  const batch = writeBatch(db);
  for (const team of allTeams) {
    const docRef = doc(teamsCollection, team.id);
    batch.update(docRef, { eloRating: initialElo, updatedAt: new Date() });
  }
  await batch.commit();
}
